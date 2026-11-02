const router = require("express").Router();
const c = require("../controllers/tenant.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrap, uuidParam } = require("../utils/http");

router.param("id", uuidParam);
router.param("userId", uuidParam);
router.use(requireAuth);

router.get("/", wrap(c.list));
router.post("/", wrap(c.create));
router.get("/:id", wrap(c.getOne));
router.put("/:id", wrap(c.update));
router.delete("/:id", wrap(c.remove));

router.get("/:id/members", wrap(c.listMembers));
router.post("/:id/members", wrap(c.addMember));
router.delete("/:id/members/:userId", wrap(c.removeMember));

module.exports = router;
