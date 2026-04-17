const { stmts } = require('../db');

function startLogCleanupScheduler() {
  try { stmts.deleteOldLogs.run(); } catch {}
  setInterval(() => {
    try { stmts.deleteOldLogs.run(); } catch {}
  }, 24 * 60 * 60 * 1000);
}

module.exports = { startLogCleanupScheduler };
