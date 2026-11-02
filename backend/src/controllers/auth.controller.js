const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../config/database");

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1d" });
}

async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { name, email, password } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists)
    return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  res.status(201).json({
    token: signToken(user.id),
    user: { id: user.id, name: user.name, email: user.email },
  });
}

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  res.json({
    token: signToken(user.id),
    user: { id: user.id, name: user.name, email: user.email },
  });
}

// Returns the user plus the organizations and tenants they may access
async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: "User not found" });

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { organization: true, tenant: true },
  });

  const orgMap = {};
  for (const m of memberships) {
    const org = (orgMap[m.organizationId] ||= {
      id: m.organization.id,
      name: m.organization.name,
      role: m.role,
      tenants: [],
    });

    if (m.tenantId === null) {
      // Org Admin: all tenants of this organization
      org.role = "ORG_ADMIN";
      const all = await prisma.tenant.findMany({
        where: { organizationId: m.organizationId },
      });
      all.forEach((t) => {
        if (!org.tenants.find((x) => x.id === t.id)) {
          org.tenants.push({ id: t.id, name: t.name, role: "ORG_ADMIN" });
        }
      });
    } else if (!org.tenants.find((x) => x.id === m.tenantId)) {
      org.tenants.push({ id: m.tenant.id, name: m.tenant.name, role: m.role });
    }
  }

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    organizations: Object.values(orgMap),
  });
}

module.exports = { register, login, me };
