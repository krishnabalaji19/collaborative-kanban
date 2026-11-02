const router = require("express").Router();
const c = require("../controllers/column.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireTenant } = require("../middleware/tenant.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { wrap, uuidParam } = require("../utils/http");

router.param("id", uuidParam);
router.use(
  requireAuth,
  requireTenant,
  requireRole("ORG_ADMIN", "TENANT_ADMIN"),
);

router.post("/", wrap(c.create));
router.put("/:id", wrap(c.update));
router.delete("/:id", wrap(c.remove));

module.exports = router;
