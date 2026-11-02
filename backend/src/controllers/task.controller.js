const { z } = require("zod");
const prisma = require("../config/database");
const { logActivity } = require("../services/activity.service");
const { emitToTenant } = require("../sockets");
const { bad } = require("../utils/http");

const uuid = z.string().uuid();
const priority = z.enum(["LOW", "MEDIUM", "HIGH"]);

const createSchema = z.object({
  boardId: uuid,
  columnId: uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: priority.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assignedTo: uuid.nullable().optional(),
});

const updateSchema = z.object({
  version: z.number().int(), // the version the client last saw
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: priority.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  assignedTo: uuid.nullable().optional(),
});

const moveSchema = z.object({
  version: z.number().int(),
  columnId: uuid,
  prevTaskId: uuid.nullable().optional(), // task just above the drop spot
  nextTaskId: uuid.nullable().optional(), // task just below the drop spot
});

// Fractional ordering: new position sits between its neighbours,
// so only ONE row is written per drag.
async function calcPosition(db, tenantId, columnId, prevId, nextId) {
  const find = (id) =>
    id
      ? db.task.findFirst({
          where: { id, tenantId, columnId },
          select: { position: true },
        })
      : null;
  const [prev, next] = await Promise.all([find(prevId), find(nextId)]);

  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1000;
  if (next) return next.position / 2;

  const last = await db.task.findFirst({
    where: { tenantId, columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1000 : 1000;
}

// Assignee must belong to this tenant (directly or as Org Admin of its org)
async function assigneeAllowed(userId, tenant) {
  if (!userId) return true;
  const m = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId: tenant.organizationId,
      OR: [{ tenantId: tenant.id }, { tenantId: null }],
    },
  });
  return !!m;
}

async function conflict(res, id, tenantId) {
  const current = await prisma.task.findFirst({ where: { id, tenantId } });
  if (!current) return res.status(404).json({ error: "Task not found" });
  return res
    .status(409)
    .json({ error: "Task was changed by someone else", current });
}

async function list(req, res) {
  const { boardId } = req.query;
  const validBoard = boardId && uuid.safeParse(boardId).success;
  const tasks = await prisma.task.findMany({
    where: { tenantId: req.tenant.id, ...(validBoard ? { boardId } : {}) },
    orderBy: [{ columnId: "asc" }, { position: "asc" }],
  });
  res.json(tasks);
}

async function getOne(req, res) {
  const task = await prisma.task.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id }, // always scoped by tenant
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const d = parsed.data;
  const { tenant, user } = req;

  const column = await prisma.column.findFirst({
    where: { id: d.columnId, boardId: d.boardId, tenantId: tenant.id },
  });
  if (!column) return res.status(404).json({ error: "Column not found" });
  if (!(await assigneeAllowed(d.assignedTo, tenant))) {
    return res
      .status(400)
      .json({ error: "Assignee does not belong to this tenant" });
  }

  const task = await prisma.$transaction(async (tx) => {
    const position = await calcPosition(tx, tenant.id, d.columnId, null, null);
    const t = await tx.task.create({
      data: {
        boardId: d.boardId,
        columnId: d.columnId,
        tenantId: tenant.id,
        title: d.title,
        description: d.description,
        priority: d.priority,
        dueDate: d.dueDate,
        assignedTo: d.assignedTo,
        position,
      },
    });
    await logActivity(tx, {
      tenantId: tenant.id,
      userId: user.id,
      entityType: "TASK",
      entityId: t.id,
      action: "CREATED",
      details: { title: t.title, column: column.name },
    });
    return t;
  });

  emitToTenant(tenant.id, "task:created", { task, by: user.id });
  res.status(201).json(task);
}

async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const { version, ...changes } = parsed.data;
  const { tenant, user } = req;
  const id = req.params.id;

  if (
    changes.assignedTo &&
    !(await assigneeAllowed(changes.assignedTo, tenant))
  ) {
    return res
      .status(400)
      .json({ error: "Assignee does not belong to this tenant" });
  }

  const task = await prisma.$transaction(async (tx) => {
    // Optimistic locking: only updates if the version still matches
    const r = await tx.task.updateMany({
      where: { id, tenantId: tenant.id, version },
      data: { ...changes, version: { increment: 1 } },
    });
    if (r.count === 0) return null;

    const t = await tx.task.findUnique({ where: { id } });
    await logActivity(tx, {
      tenantId: tenant.id,
      userId: user.id,
      entityType: "TASK",
      entityId: id,
      action: "UPDATED",
      details: { title: t.title, fields: Object.keys(changes) },
    });
    return t;
  });

  if (!task) return conflict(res, id, tenant.id);

  emitToTenant(tenant.id, "task:updated", { task, by: user.id });
  res.json(task);
}

async function move(req, res) {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const d = parsed.data;
  const { tenant, user } = req;
  const id = req.params.id;

  const existing = await prisma.task.findFirst({
    where: { id, tenantId: tenant.id },
    include: { column: { select: { name: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Task not found" });

  // Target column must be on the same board and tenant
  const target = await prisma.column.findFirst({
    where: { id: d.columnId, boardId: existing.boardId, tenantId: tenant.id },
  });
  if (!target)
    return res.status(404).json({ error: "Target column not found" });

  const prevId = d.prevTaskId && d.prevTaskId !== id ? d.prevTaskId : null;
  const nextId = d.nextTaskId && d.nextTaskId !== id ? d.nextTaskId : null;

  const task = await prisma.$transaction(async (tx) => {
    const position = await calcPosition(
      tx,
      tenant.id,
      d.columnId,
      prevId,
      nextId,
    );
    const r = await tx.task.updateMany({
      where: { id, tenantId: tenant.id, version: d.version },
      data: { columnId: d.columnId, position, version: { increment: 1 } },
    });
    if (r.count === 0) return null;

    await logActivity(tx, {
      tenantId: tenant.id,
      userId: user.id,
      entityType: "TASK",
      entityId: id,
      action: "MOVED",
      details: {
        title: existing.title,
        from: existing.column.name,
        to: target.name,
      },
    });
    return tx.task.findUnique({ where: { id } });
  });

  if (!task) return conflict(res, id, tenant.id);

  emitToTenant(tenant.id, "task:moved", {
    task,
    fromColumnId: existing.columnId,
    by: user.id,
  });
  res.json(task);
}

async function remove(req, res) {
  const { tenant, user } = req;
  const id = req.params.id;

  const existing = await prisma.task.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!existing) return res.status(404).json({ error: "Task not found" });

  await prisma.$transaction(async (tx) => {
    await tx.task.deleteMany({ where: { id, tenantId: tenant.id } });
    await logActivity(tx, {
      tenantId: tenant.id,
      userId: user.id,
      entityType: "TASK",
      entityId: id,
      action: "DELETED",
      details: { title: existing.title },
    });
  });

  emitToTenant(tenant.id, "task:deleted", {
    taskId: id,
    columnId: existing.columnId,
    by: user.id,
  });
  res.json({ success: true });
}

module.exports = { list, getOne, create, update, move, remove };
