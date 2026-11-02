const { z } = require("zod");
const prisma = require("../config/database");
const { orgAccess } = require("../services/access.service");
const { bad } = require("../utils/http");

const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });

// The creator automatically becomes Org Admin of the new organization
async function create(req, res) {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);

  const org = await prisma.$transaction(async (tx) => {
    const o = await tx.organization.create({
      data: { name: parsed.data.name },
    });
    await tx.membership.create({
      data: {
        userId: req.user.id,
        organizationId: o.id,
        tenantId: null,
        role: "ORG_ADMIN",
      },
    });
    return o;
  });
  res.status(201).json(org);
}

// Only organizations the user belongs to
async function list(req, res) {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.id },
    include: { organization: true },
  });
  const map = new Map();
  for (const m of memberships) {
    if (!map.has(m.organizationId) || m.role === "ORG_ADMIN") {
      map.set(m.organizationId, { ...m.organization, role: m.role });
    }
  }
  res.json([...map.values()]);
}

async function getOne(req, res) {
  const access = await orgAccess(req.user.id, req.params.id);
  if (!access.isMember)
    return res.status(404).json({ error: "Organization not found" }); // do not reveal it exists
  const org = await prisma.organization.findUnique({
    where: { id: req.params.id },
  });
  res.json(org);
}

async function update(req, res) {
  const parsed = nameSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);

  const access = await orgAccess(req.user.id, req.params.id);
  if (!access.isMember)
    return res.status(404).json({ error: "Organization not found" });
  if (!access.isAdmin)
    return res.status(403).json({ error: "Only Org Admins can do this" });

  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data: { name: parsed.data.name },
  });
  res.json(org);
}

// Policy: an organization that still has branches cannot be deleted
async function remove(req, res) {
  const id = req.params.id;
  const access = await orgAccess(req.user.id, id);
  if (!access.isMember)
    return res.status(404).json({ error: "Organization not found" });
  if (!access.isAdmin)
    return res.status(403).json({ error: "Only Org Admins can do this" });

  const tenants = await prisma.tenant.count({ where: { organizationId: id } });
  if (tenants > 0) {
    return res.status(409).json({ error: "Delete or move its branches first" });
  }
  await prisma.organization.delete({ where: { id } });
  res.json({ success: true });
}

module.exports = { create, list, getOne, update, remove };
