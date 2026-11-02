const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const prisma = require("../config/database");
const { getTenantAccess } = require("../middleware/tenant.middleware");

let io = null;

// Presence: tenantId -> Map(userId -> { name, count })
// count = number of open connections (tabs), so closing one tab does not show "offline"
const presence = new Map();

function presenceList(tenantId) {
  const users = presence.get(tenantId);
  return users ? [...users].map(([id, v]) => ({ id, name: v.name })) : [];
}

function addPresence(tenantId, user) {
  if (!presence.has(tenantId)) presence.set(tenantId, new Map());
  const users = presence.get(tenantId);
  const entry = users.get(user.id) || { name: user.name, count: 0 };
  entry.count += 1;
  users.set(user.id, entry);
}

function removePresence(tenantId, userId) {
  const users = presence.get(tenantId);
  if (!users || !users.has(userId)) return;
  const entry = users.get(userId);
  entry.count -= 1;
  if (entry.count <= 0) users.delete(userId);
  if (users.size === 0) presence.delete(tenantId);
}

// Broadcast only to the room of one tenant
function emitToTenant(tenantId, event, payload) {
  if (io) io.to(`tenant:${tenantId}`).emit(event, payload);
}

function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "http://localhost:5173" },
  });

  // 1) Authenticate every connection with the JWT
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true },
      });
      if (!user) return next(new Error("Unauthorized"));
      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const leaveCurrent = () => {
      const tenantId = socket.data.tenantId;
      if (!tenantId) return;
      socket.leave(`tenant:${tenantId}`);
      removePresence(tenantId, socket.data.user.id);
      socket.data.tenantId = null;
      io.to(`tenant:${tenantId}`).emit("presence:update", {
        users: presenceList(tenantId),
      });
    };

    // 2) Joining a room is never automatic: membership is verified every time
    socket.on("tenant:join", async (data, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const tenantId = data && data.tenantId;
        const access = await getTenantAccess(socket.data.user.id, tenantId);
        if (!access)
          return reply({ ok: false, error: "No access to this tenant" });

        if (socket.data.tenantId !== tenantId) {
          leaveCurrent(); // a socket is in only ONE tenant room at a time
          socket.join(`tenant:${tenantId}`);
          socket.data.tenantId = tenantId;
          addPresence(tenantId, socket.data.user);
          io.to(`tenant:${tenantId}`).emit("presence:update", {
            users: presenceList(tenantId),
          });
        }
        reply({ ok: true, role: access.role, users: presenceList(tenantId) });
      } catch (err) {
        reply({ ok: false, error: "No access to this tenant" });
      }
    });

    socket.on("tenant:leave", leaveCurrent);
    socket.on("disconnect", leaveCurrent);
  });

  return io;
}

module.exports = { initSockets, emitToTenant };
