const { z } = require("zod");
const prisma = require("../config/database");
const { orgAccess } = require("../services/access.service");
const { getTenantAccess } = require("../middleware/tenant.middleware");
const { logActivity } = require("../services/activity.service");
const { bad } = require("../utils/http");

const uuid = z.string().uuid();
const createSchema = z.object({
  organizationId: uuid,
  name: z.string().trim().min(1).max(100),
});
const renameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const memberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["TENANT_ADMIN", "MEMBER"]),
});

const ADMINS = ["ORG_ADMIN", "TENANT_ADMIN"];

// ---------- tenants ----------

// Only tenants this user can access (Org Admin: all in that org)
async function list(req, res) {
  const { organizationId } = req.query;
  const filter =
    organizationId && uuid.safeParse(organizationId).success
      ? { organizationId }
      : {};

  const memberships = await prisma.membership.findMany({
    where: { userId: req.user.id, ...filter },
  });
  const adminOrgs = memberships
    .filter((m) => m.tenantId === null && m.role === "ORG_ADMIN")
    .map((m) => m.organizationId);
  const direct = memberships.filter((m) => m.tenantId !== null);

  const tenants = await prisma.tenant.findMany({
    where: {
      OR: [
        { organizationId: { in: adminOrgs } },
        { id: { in: direct.map((m) => m.tenantId) } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  res.json(
    tenants.map((t) => ({
      ...t,
      role: adminOrgs.includes(t.organizationId)
        ? "ORG_ADMIN"
        : direct.find((m) => m.tenantId === t.id).role,
    })),
  );
}

async function getOne(req, res) {
  const access = await getTenantAccess(req.user.id, req.params.id);
  if (!access) return res.status(404).json({ error: "Tenant not found" });
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
  });
  res.json({ ...tenant, role: access.role });
}

async function create(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);

  const access = await orgAccess(req.user.id, parsed.data.organizationId);
  if (!access.isMember)
    return res.status(404).json({ error: "Organization not found" });
  if (!access.isAdmin)
    return res.status(403).json({ error: "Only Org Admins can do this" });

  const tenant = await prisma.tenant.create({
    data: {
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
    },
  });
  res.status(201).json(tenant);
}

// Update and delete are Org Admin only, checked against the tenant's own organization
async function loadForOrgAdmin(req, res) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
  });
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return null;
  }
  const access = await orgAccess(req.user.id, tenant.organizationId);
  if (!access.isMember) {
    res.status(404).json({ error: "Tenant not found" });
    return null;
  }
  if (!access.isAdmin) {
    res.status(403).json({ error: "Only Org Admins can do this" });
    return null;
  }
  return tenant;
}

async function update(req, res) {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const tenant = await loadForOrgAdmin(req, res);
  if (!tenant) return;

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { name: parsed.data.name },
  });
  res.json(updated);
}

// Policy: a branch that still has boards cannot be deleted
async function remove(req, res) {
  const tenant = await loadForOrgAdmin(req, res);
  if (!tenant) return;

  const boards = await prisma.board.count({ where: { tenantId: tenant.id } });
  if (boards > 0)
    return res.status(409).json({ error: "Delete its boards first" });

  await prisma.tenant.delete({ where: { id: tenant.id } });
  res.json({ success: true });
}

// ---------- members of a tenant ----------

async function listMembers(req, res) {
  const access = await getTenantAccess(req.user.id, req.params.id);
  if (!access) return res.status(404).json({ error: "Tenant not found" });

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: access.organizationId,
      OR: [{ tenantId: access.id }, { tenantId: null }],
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(
    memberships.map((m) => ({
      ...m.user,
      role: m.role,
      scope: m.tenantId === null ? "ORGANIZATION" : "TENANT",
    })),
  );
}

// Org Admin: can assign any role. Tenant Admin: can only add Members.
async function addMember(req, res) {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);

  const access = await getTenantAccess(req.user.id, req.params.id);
  if (!access) return res.status(404).json({ error: "Tenant not found" });
  if (!ADMINS.includes(access.role))
    return res.status(403).json({ error: "Insufficient permissions" });
  if (parsed.data.role === "TENANT_ADMIN" && access.role !== "ORG_ADMIN") {
    return res
      .status(403)
      .json({ error: "Only Org Admins can assign tenant admins" });
  }

  const target = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (!target)
    return res.status(404).json({ error: "No user with that email" });

  const existing = await prisma.membership.findFirst({
    where: {
      userId: target.id,
      organizationId: access.organizationId,
      tenantId: access.id,
    },
  });
  if (existing) {
    await prisma.membership.update({
      where: { id: existing.id },
      data: { role: parsed.data.role },
    });
  } else {
    await prisma.membership.create({
      data: {
        userId: target.id,
        organizationId: access.organizationId,
        tenantId: access.id,
        role: parsed.data.role,
      },
    });
  }

  await logActivity(prisma, {
    tenantId: access.id,
    userId: req.user.id,
    entityType: "MEMBERSHIP",
    entityId: target.id,
    action: "CREATED",
    details: { name: target.name, role: parsed.data.role },
  });
  res
    .status(201)
    .json({
      id: target.id,
      name: target.name,
      email: target.email,
      role: parsed.data.role,
    });
}

async function removeMember(req, res) {
  const access = await getTenantAccess(req.user.id, req.params.id);
  if (!access) return res.status(404).json({ error: "Tenant not found" });
  if (!ADMINS.includes(access.role))
    return res.status(403).json({ error: "Insufficient permissions" });

  const membership = await prisma.membership.findFirst({
    where: {
      userId: req.params.userId,
      organizationId: access.organizationId,
      tenantId: access.id,
    },
    include: { user: { select: { name: true } } },
  });
  if (!membership) return res.status(404).json({ error: "Member not found" });
  if (membership.role === "TENANT_ADMIN" && access.role !== "ORG_ADMIN") {
    return res
      .status(403)
      .json({ error: "Only Org Admins can remove tenant admins" });
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  await logActivity(prisma, {
    tenantId: access.id,
    userId: req.user.id,
    entityType: "MEMBERSHIP",
    entityId: req.params.userId,
    action: "DELETED",
    details: { name: membership.user.name },
  });
  res.json({ success: true });
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  listMembers,
  addMember,
  removeMember,
};
