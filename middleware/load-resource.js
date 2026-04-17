const { stmts } = require('../db');

// Middleware factory: loads a resource by id from a stmt key into req.resource
// Sends 404 with errorMsg if not found.
function loadResource(stmtKey, paramKey, errorMsg) {
  return (req, res, next) => {
    const stmt = stmts[stmtKey];
    if (!stmt) return res.status(500).json({ error: `Unknown stmt: ${stmtKey}` });
    const row = stmt.get(req.params[paramKey]);
    if (!row) return res.status(404).json({ error: errorMsg });
    req.resource = row;
    next();
  };
}

module.exports = { loadResource };
