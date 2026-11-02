const router = require("express").Router();
const { requireAuth } = require("../middleware/auth.middleware");
const { requireTenant } = require("../middleware/tenant.middleware");
const { listActivity } = require("../services/activity.service");
const { wrap } = require("../utils/http");

router.use(requireAuth, requireTenant);

// GET /api/activity?limit=50&entityId=<taskId>
router.get(
  "/",
  wrap(async (req, res) => {
    const logs = await listActivity(req.tenant.id, {
      entityId: req.query.entityId,
      limit: req.query.limit,
    });
    res.json(logs);
  }),
);

module.exports = router;
