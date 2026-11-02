const router = require("express").Router();
const c = require("../controllers/task.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireTenant } = require("../middleware/tenant.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { wrap, uuidParam } = require("../utils/http");

router.param("id", uuidParam);
router.use(requireAuth, requireTenant);

router.get("/", wrap(c.list));
router.post("/", wrap(c.create));
router.get("/:id", wrap(c.getOne));
router.put("/:id", wrap(c.update));
router.patch("/:id/move", wrap(c.move));
// Only admins can delete tasks
router.delete("/:id", requireRole("ORG_ADMIN", "TENANT_ADMIN"), wrap(c.remove));

module.exports = router;
