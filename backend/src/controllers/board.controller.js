const { z } = require("zod");
const prisma = require("../config/database");
const { logActivity } = require("../services/activity.service");
const { emitToTenant } = require("../sockets");
const { bad } = require("../utils/http");

const boardSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).nullable().optional(),
});

const DEFAULT_COLUMNS = ["To Do", "In Progress", "Testing", "Done"];

async function list(req, res) {
  const boards = await prisma.board.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { tasks: true } } },
  });
  res.json(boards);
}

// Full board: columns + tasks in order. Also used to resync after reconnect.
async function getOne(req, res) {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: {
      columns: {
        orderBy: { position: "asc" },
        include: { tasks: { orderBy: { position: "asc" } } },
      },
    },
  });
  if (!board) return res.status(404).json({ error: "Board not found" });
  res.json(board);
}

async function getColumns(req, res) {
  const board = await prisma.board.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    select: { id: true },
  });
  if (!board) return res.status(404).json({ error: "Board not found" });

  const columns = await prisma.column.findMany({
    where: { boardId: board.id, tenantId: req.tenant.id },
    orderBy: { position: "asc" },
  });
  res.json(columns);
}

async function create(req, res) {
  const parsed = boardSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const { tenant, user } = req;

  const board = await prisma.$transaction(async (tx) => {
    const b = await tx.board.create({
      data: {
        organizationId: tenant.organizationId,
        tenantId: tenant.id,
        name: parsed.data.name,
        description: parsed.data.description,
        createdBy: user.id,
      },
    });
    await tx.column.createMany({
      data: DEFAULT_COLUMNS.map((name, i) => ({
        boardId: b.id,
        tenantId: tenant.id,
        name,
        position: i + 1,
      })),
    });
    await logActivity(tx, {
      tenantId: tenant.id,
      userId: user.id,
      entityType: "BOARD",
      entityId: b.id,
      action: "CREATED",
      details: { name: b.name },
    });
    return b;
  });

  emitToTenant(tenant.id, "board:updated", { boardId: board.id, by: user.id });
  res.status(201).json(board);
}

async function update(req, res) {
  const parsed = boardSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const { tenant, user } = req;
  const id = req.params.id;

  const r = await prisma.board.updateMany({
    where: { id, tenantId: tenant.id },
    data: { name: parsed.data.name, description: parsed.data.description },
  });
  if (r.count === 0) return res.status(404).json({ error: "Board not found" });

  await logActivity(prisma, {
    tenantId: tenant.id,
    userId: user.id,
    entityType: "BOARD",
    entityId: id,
    action: "UPDATED",
    details: { name: parsed.data.name },
  });

  emitToTenant(tenant.id, "board:updated", { boardId: id, by: user.id });
  res.json(await prisma.board.findUnique({ where: { id } }));
}

async function remove(req, res) {
  const { tenant, user } = req;
  const id = req.params.id;

  const board = await prisma.board.findFirst({
    where: { id, tenantId: tenant.id },
  });
  if (!board) return res.status(404).json({ error: "Board not found" });

  await prisma.$transaction(async (tx) => {
    await tx.board.deleteMany({ where: { id, tenantId: tenant.id } }); // columns + tasks cascade
    await logActivity(tx, {
      tenantId: tenant.id,
      userId: user.id,
      entityType: "BOARD",
      entityId: id,
      action: "DELETED",
      details: { name: board.name },
    });
  });

  emitToTenant(tenant.id, "board:updated", {
    boardId: id,
    deleted: true,
    by: user.id,
  });
  res.json({ success: true });
}

module.exports = { list, getOne, getColumns, create, update, remove };
