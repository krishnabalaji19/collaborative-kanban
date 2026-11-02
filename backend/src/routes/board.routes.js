const router = require("express").Router();
const c = require("../controllers/board.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireTenant } = require("../middleware/tenant.middleware");
const { requireRole } = require("../middleware/role.middleware");
const { wrap, uuidParam } = require("../utils/http");

router.param("id", uuidParam);
router.use(requireAuth, requireTenant);

const admin = requireRole("ORG_ADMIN", "TENANT_ADMIN");

router.get("/", wrap(c.list));
router.post("/", admin, wrap(c.create));
router.get("/:id", wrap(c.getOne));
router.get("/:id/columns", wrap(c.getColumns));
router.put("/:id", admin, wrap(c.update));
router.delete("/:id", admin, wrap(c.remove));

module.exports = router;
