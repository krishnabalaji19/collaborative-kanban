const prisma = require("../config/database");

// Finds the user's role for a tenant, or null if no access.
// Org Admin (membership with tenantId = null) can access every tenant in that org.
async function getTenantAccess(userId, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;

  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId: tenant.organizationId,
      OR: [{ tenantId: tenant.id }, { tenantId: null }],
    },
    orderBy: { role: "asc" }, // ORG_ADMIN is listed first in the enum
  });
  if (!membership) return null;

  return {
    id: tenant.id,
    organizationId: tenant.organizationId,
    role: membership.role,
  };
}

// Reads the tenant from the x-tenant-id header and VERIFIES membership.
// Never trust the header alone: this check is what blocks cross-tenant access.
async function requireTenant(req, res, next) {
  try {
    const tenantId = req.headers["x-tenant-id"];
    if (!tenantId)
      return res.status(400).json({ error: "x-tenant-id header is required" });

    const access = await getTenantAccess(req.user.id, tenantId);
    if (!access)
      return res.status(403).json({ error: "No access to this tenant" });

    req.tenant = access; // { id, organizationId, role }
    next();
  } catch (err) {
    // invalid UUID format etc.
    return res.status(403).json({ error: "No access to this tenant" });
  }
}

module.exports = { requireTenant, getTenantAccess };
