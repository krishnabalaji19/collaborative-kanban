const { z } = require("zod");
const prisma = require("../config/database");

// `db` can be prisma or a transaction client (tx)
function logActivity(
  db,
  { tenantId, userId, entityType, entityId, action, details },
) {
  return db.activityLog.create({
    data: {
      tenantId,
      userId,
      entityType,
      entityId,
      action,
      details: details || {},
    },
  });
}

async function listActivity(tenantId, { entityId, limit }) {
  const validEntity = entityId && z.string().uuid().safeParse(entityId).success;

  const logs = await prisma.activityLog.findMany({
    where: { tenantId, ...(validEntity ? { entityId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(parseInt(limit, 10) || 50, 200),
  });

  const ids = [...new Set(logs.map((l) => l.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));

  return logs.map((l) => ({ ...l, userName: names[l.userId] || "Unknown" }));
}

module.exports = { logActivity, listActivity };
