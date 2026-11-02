const router = require("express").Router();
const { register, login, me } = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth.middleware");

// Express 4 does not catch async errors, so wrap handlers
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.post("/register", wrap(register));
router.post("/login", wrap(login));
router.get("/me", requireAuth, wrap(me));

module.exports = router;
