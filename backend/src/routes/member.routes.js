const router = require("express").Router();
const prisma = require("../config/database");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireTenant } = require("../middleware/tenant.middleware");
const { wrap } = require("../utils/http");

router.use(requireAuth, requireTenant);

// GET /api/members: people who can access the current tenant
// (tenant members + Org Admins of its organization)
router.get(
  "/",
  wrap(async (req, res) => {
    const memberships = await prisma.membership.findMany({
      where: {
        organizationId: req.tenant.organizationId,
        OR: [{ tenantId: req.tenant.id }, { tenantId: null }],
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const seen = new Map();
    for (const m of memberships) {
      if (!seen.has(m.userId)) seen.set(m.userId, { ...m.user, role: m.role });
    }
    res.json([...seen.values()]);
  }),
);

module.exports = router;
