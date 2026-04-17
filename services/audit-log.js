const { stmts } = require('../db');

function logAction(action, entityType, entityId, entityName, details = '', companyName = '', departmentName = '') {
  try {
    stmts.insertLog.run(action, entityType, entityId || '', entityName || '', companyName, departmentName, details);
  } catch {}
}

function formatDateDE(isoStr) {
  if (!isoStr) return '';
  const d = isoStr.substring(0, 10).split('-');
  if (d.length !== 3) return isoStr;
  return `${d[2]}.${d[1]}.${d[0]}`;
}

module.exports = { logAction, formatDateDE };
