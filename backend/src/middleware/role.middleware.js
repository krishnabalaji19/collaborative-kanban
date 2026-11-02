// Usage: requireRole('ORG_ADMIN', 'TENANT_ADMIN')
// Must run after requireTenant (uses req.tenant.role)
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.tenant || !allowed.includes(req.tenant.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { requireRole };
