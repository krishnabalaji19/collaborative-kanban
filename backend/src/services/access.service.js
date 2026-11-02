const prisma = require("../config/database");

// What can this user do inside an organization?
// isAdmin = has an organization-level ORG_ADMIN membership (tenantId = null)
async function orgAccess(userId, organizationId) {
  const ms = await prisma.membership.findMany({
    where: { userId, organizationId },
    select: { role: true, tenantId: true },
  });
  return {
    isMember: ms.length > 0,
    isAdmin: ms.some((m) => m.tenantId === null && m.role === "ORG_ADMIN"),
  };
}

module.exports = { orgAccess };
