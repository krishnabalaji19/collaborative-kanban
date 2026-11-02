const { z } = require("zod");

// Express 4 does not catch errors from async handlers
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Use with router.param('id', uuidParam): bad ids return 404 instead of crashing
function uuidParam(req, res, next, id) {
  if (!z.string().uuid().safeParse(id).success) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

const bad = (res, parsed) =>
  res
    .status(400)
    .json({ error: "Invalid input", details: parsed.error.flatten() });

module.exports = { wrap, uuidParam, bad };
