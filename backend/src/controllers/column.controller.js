const { z } = require("zod");
const prisma = require("../config/database");
const { logActivity } = require("../services/activity.service");
const { emitToTenant } = require("../sockets");
const { bad } = require("../utils/http");

const createSchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
});
const renameSchema = z.object({ name: z.string().trim().min(1).max(50) });

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const { tenant, user } = req;
  const { boardId, name } = parsed.data;

  const board = await prisma.board.findFirst({
    where: { id: boardId, tenantId: tenant.id },
  });
  if (!board) return res.status(404).json({ error: "Board not found" });

  const last = await prisma.column.findFirst({
    where: { boardId, tenantId: tenant.id },
    orderBy: { position: "desc" },
  });

  const column = await prisma.column.create({
    data: {
      boardId,
      tenantId: tenant.id,
      name,
      position: last ? last.position + 1 : 1,
    },
  });
  await logActivity(prisma, {
    tenantId: tenant.id,
    userId: user.id,
    entityType: "COLUMN",
    entityId: column.id,
    action: "CREATED",
    details: { name },
  });

  emitToTenant(tenant.id, "board:updated", { boardId, by: user.id });
  res.status(201).json(column);
}

async function update(req, res) {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const { tenant, user } = req;
  const id = req.params.id;

  const column = await prisma.column.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!column) return res.status(404).json({ error: "Column not found" });

  await prisma.column.updateMany({
    where: { id, tenantId: tenant.id },
    data: { name: parsed.data.name },
  });
  await logActivity(prisma, {
    tenantId: tenant.id,
    userId: user.id,
    entityType: "COLUMN",
    entityId: id,
    action: "UPDATED",
    details: { from: column.name, to: parsed.data.name },
  });

  emitToTenant(tenant.id, "board:updated", {
    boardId: column.boardId,
    by: user.id,
  });
  res.json({ ...column, name: parsed.data.name });
}

async function remove(req, res) {
  const { tenant, user } = req;
  const id = req.params.id;

  const column = await prisma.column.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!column) return res.status(404).json({ error: "Column not found" });

  // Edge case: never silently delete tasks
  const taskCount = await prisma.task.count({
    where: { columnId: id, tenantId: tenant.id },
  });
  if (taskCount > 0) {
    return res
      .status(409)
      .json({ error: "Column still has tasks. Move or delete them first." });
  }

  await prisma.column.deleteMany({ where: { id, tenantId: tenant.id } });
  await logActivity(prisma, {
    tenantId: tenant.id,
    userId: user.id,
    entityType: "COLUMN",
    entityId: id,
    action: "DELETED",
    details: { name: column.name },
  });

  emitToTenant(tenant.id, "board:updated", {
    boardId: column.boardId,
    by: user.id,
  });
  res.json({ success: true });
}

module.exports = { create, update, remove };
