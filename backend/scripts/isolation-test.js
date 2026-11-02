// Automated checks for tenant isolation, RBAC, concurrency and WebSocket scoping.
// Run with the server running:  node scripts/isolation-test.js
const { io } = require("socket.io-client");

const BASE = process.env.API_URL || "http://localhost:5001";
let passed = 0;
let failed = 0;

async function call(method, path, { token, tenant, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }
  return { status: res.status, data };
}

function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   (got: ${detail})`}`,
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
const join = (socket, tenantId) =>
  new Promise((resolve) => socket.emit("tenant:join", { tenantId }, resolve));

async function main() {
  console.log(`Testing against ${BASE}\n`);

  // ---------- setup ----------
  const accounts = {
    rahul: "rahul@abc.com", // Org Admin, ABC
    priya: "priya@abc.com", // Tenant Admin, Hyderabad
    arjun: "arjun@abc.com", // Member, Hyderabad
    sneha: "sneha@abc.com", // Tenant Admin, Bangalore
    kiran: "kiran@xyz.com", // Member, Mumbai (other organization)
  };
  const u = {};
  for (const [key, email] of Object.entries(accounts)) {
    const login = await call("POST", "/auth/login", {
      body: { email, password: "password123" },
    });
    if (!login.data || !login.data.token) {
      console.log(`Cannot log in as ${email}. Did you run the seed script?`);
      process.exit(1);
    }
    const me = await call("GET", "/auth/me", { token: login.data.token });
    u[key] = { token: login.data.token, orgs: me.data.organizations };
  }
  const tenantOf = (key, name) =>
    u[key].orgs.flatMap((o) => o.tenants).find((t) => t.name === name).id;

  const HYD = tenantOf("priya", "Hyderabad");
  const BLR = tenantOf("sneha", "Bangalore");
  const MUM = tenantOf("kiran", "Mumbai");

  const loadFirstBoard = async (key, tenant) => {
    const list = await call("GET", "/boards", { token: u[key].token, tenant });
    const full = await call("GET", `/boards/${list.data[0].id}`, {
      token: u[key].token,
      tenant,
    });
    return full.data;
  };
  const hydBoard = await loadFirstBoard("priya", HYD);
  const blrBoard = await loadFirstBoard("sneha", BLR);
  const hydTask = hydBoard.columns.flatMap((c) => c.tasks)[0];
  const blrTask = blrBoard.columns.flatMap((c) => c.tasks)[0];
  const blrColumn = blrBoard.columns[0];

  // ---------- cross-tenant isolation (same organization) ----------
  console.log("Cross-tenant isolation (Hyderabad user vs Bangalore data)");
  let r = await call("GET", "/boards", { token: u.priya.token, tenant: BLR });
  check(
    "Hyderabad user cannot list Bangalore boards (403)",
    r.status === 403,
    r.status,
  );

  r = await call("GET", `/tasks/${blrTask.id}`, {
    token: u.priya.token,
    tenant: HYD,
  });
  check(
    "Guessing a Bangalore task id from Hyderabad returns 404",
    r.status === 404,
    r.status,
  );

  r = await call("GET", `/boards/${blrBoard.id}`, {
    token: u.priya.token,
    tenant: HYD,
  });
  check(
    "Guessing a Bangalore board id from Hyderabad returns 404",
    r.status === 404,
    r.status,
  );

  r = await call("PUT", `/tasks/${blrTask.id}`, {
    token: u.priya.token,
    tenant: HYD,
    body: { version: blrTask.version, title: "hacked" },
  });
  check(
    "Cannot edit a Bangalore task from Hyderabad (404)",
    r.status === 404,
    r.status,
  );

  r = await call("PATCH", `/tasks/${blrTask.id}/move`, {
    token: u.priya.token,
    tenant: HYD,
    body: { version: blrTask.version, columnId: blrColumn.id },
  });
  check(
    "Cannot move a Bangalore task from Hyderabad (404)",
    r.status === 404,
    r.status,
  );

  r = await call("DELETE", `/tasks/${blrTask.id}`, {
    token: u.priya.token,
    tenant: HYD,
  });
  check(
    "Cannot delete a Bangalore task from Hyderabad (404)",
    r.status === 404,
    r.status,
  );

  r = await call("POST", "/tasks", {
    token: u.priya.token,
    tenant: HYD,
    body: { boardId: blrBoard.id, columnId: blrColumn.id, title: "injected" },
  });
  check(
    "Cannot create a task in a Bangalore column from Hyderabad (404)",
    r.status === 404,
    r.status,
  );

  r = await call("GET", "/activity?limit=100", {
    token: u.priya.token,
    tenant: HYD,
  });
  check(
    "Activity log only contains Hyderabad entries",
    r.status === 200 && r.data.every((l) => l.tenantId === HYD),
    r.status,
  );

  // ---------- cross-organization isolation ----------
  console.log("\nCross-organization isolation");
  r = await call("GET", "/boards", { token: u.rahul.token, tenant: MUM });
  check(
    "ABC Org Admin cannot access XYZ branch Mumbai (403)",
    r.status === 403,
    r.status,
  );

  r = await call("GET", "/boards", { token: u.kiran.token, tenant: HYD });
  check(
    "XYZ user cannot access ABC branch Hyderabad (403)",
    r.status === 403,
    r.status,
  );

  // ---------- authentication ----------
  console.log("\nAuthentication");
  r = await call("GET", "/boards", { tenant: HYD });
  check("No token returns 401", r.status === 401, r.status);

  r = await call("GET", "/boards", {
    token: u.priya.token,
    tenant: "not-a-uuid",
  });
  check("Garbage tenant header is rejected (403)", r.status === 403, r.status);

  let rejected = false;
  try {
    const bad = await connect("invalid-token");
    bad.close();
  } catch (e) {
    rejected = true;
  }
  check("WebSocket connection with an invalid token is rejected", rejected);

  // ---------- RBAC ----------
  console.log("\nRole-based access control");
  r = await call("POST", "/boards", {
    token: u.arjun.token,
    tenant: HYD,
    body: { name: "Nope" },
  });
  check("Member cannot create a board (403)", r.status === 403, r.status);

  r = await call("DELETE", `/tasks/${hydTask.id}`, {
    token: u.arjun.token,
    tenant: HYD,
  });
  check("Member cannot delete a task (403)", r.status === 403, r.status);

  r = await call("POST", "/tenants", {
    token: u.priya.token,
    body: { organizationId: hydBoard.organizationId, name: "Nope" },
  });
  check(
    "Tenant Admin cannot create a tenant (403)",
    r.status === 403,
    r.status,
  );

  r = await call("POST", `/tenants/${HYD}/members`, {
    token: u.priya.token,
    body: { email: "kiran@xyz.com", role: "TENANT_ADMIN" },
  });
  check(
    "Tenant Admin cannot assign a Tenant Admin (403)",
    r.status === 403,
    r.status,
  );

  // ---------- concurrency ----------
  console.log("\nConcurrency");
  const original = (
    await call("GET", `/tasks/${hydTask.id}`, {
      token: u.priya.token,
      tenant: HYD,
    })
  ).data;

  r = await call("PUT", `/tasks/${original.id}`, {
    token: u.priya.token,
    tenant: HYD,
    body: { version: original.version, title: original.title },
  });
  check(
    "Update with the current version succeeds (200)",
    r.status === 200,
    r.status,
  );

  r = await call("PUT", `/tasks/${original.id}`, {
    token: u.arjun.token,
    tenant: HYD,
    body: { version: original.version, title: "stale edit" },
  });
  check(
    "Update with a stale version is rejected (409)",
    r.status === 409,
    r.status,
  );
  check(
    "409 response includes the latest task state",
    !!(r.data && r.data.current),
  );

  const fresh = (
    await call("GET", `/tasks/${original.id}`, {
      token: u.priya.token,
      tenant: HYD,
    })
  ).data;
  const targets = hydBoard.columns
    .filter((c) => c.id !== fresh.columnId)
    .slice(0, 2);
  const [m1, m2] = await Promise.all(
    targets.map((c) =>
      call("PATCH", `/tasks/${fresh.id}/move`, {
        token: u.priya.token,
        tenant: HYD,
        body: { version: fresh.version, columnId: c.id },
      }),
    ),
  );
  const statuses = [m1.status, m2.status].sort();
  check(
    "Two simultaneous moves with the same version: one wins, one gets 409",
    statuses[0] === 200 && statuses[1] === 409,
    statuses.join(","),
  );

  // put the task back where it was
  const afterRace = (
    await call("GET", `/tasks/${fresh.id}`, {
      token: u.priya.token,
      tenant: HYD,
    })
  ).data;
  await call("PATCH", `/tasks/${fresh.id}/move`, {
    token: u.priya.token,
    tenant: HYD,
    body: { version: afterRace.version, columnId: fresh.columnId },
  });

  // ---------- WebSocket scoping ----------
  console.log("\nWebSocket tenant rooms");
  const sPriya = await connect(u.priya.token);
  const sArjun = await connect(u.arjun.token);
  const sSneha = await connect(u.sneha.token);

  const denied = await join(sPriya, BLR);
  check(
    "Hyderabad user cannot join the Bangalore room",
    denied && denied.ok === false,
    JSON.stringify(denied),
  );

  const okPriya = await join(sPriya, HYD);
  const okArjun = await join(sArjun, HYD);
  const okSneha = await join(sSneha, BLR);
  check(
    "Users can join their own tenant rooms",
    okPriya.ok && okArjun.ok && okSneha.ok,
  );
  check(
    "Presence lists both Hyderabad users",
    okArjun.users.length === 2,
    okArjun.users.length,
  );

  let arjunGot = false;
  let snehaGot = false;
  sArjun.on("task:created", () => {
    arjunGot = true;
  });
  sSneha.on("task:created", () => {
    snehaGot = true;
  });

  const firstColumn = hydBoard.columns[0];
  const created = await call("POST", "/tasks", {
    token: u.priya.token,
    tenant: HYD,
    body: {
      boardId: hydBoard.id,
      columnId: firstColumn.id,
      title: "ws-test-task",
    },
  });
  await sleep(800);
  check("Hyderabad colleague receives the live task event", arjunGot);
  check("Bangalore user does NOT receive the Hyderabad event", !snehaGot);

  if (created.data && created.data.id) {
    await call("DELETE", `/tasks/${created.data.id}`, {
      token: u.priya.token,
      tenant: HYD,
    });
  }
  [sPriya, sArjun, sSneha].forEach((s) => s.close());

  // ---------- summary ----------
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run crashed:", err.message);
  process.exit(1);
});
