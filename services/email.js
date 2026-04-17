const nodemailer = require('nodemailer');
const { stmts } = require('../db');
const { logAction } = require('./audit-log');

function getSmtpConfig(module) {
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  const prefix = module === 'change' ? 'change_' : '';
  const host = s[prefix + 'smtp_host'];
  const port = parseInt(s[prefix + 'smtp_port']) || 587;
  const user = s[prefix + 'smtp_user'];
  const pass = s[prefix + 'smtp_pass'];
  const auth = s[prefix + 'smtp_auth'] !== 'false';
  if (!host || !user) return null;
  return { host, port, user, pass, auth };
}

function createTransporter(smtpConfig) {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: smtpConfig.auth ? { user: smtpConfig.user, pass: smtpConfig.pass } : undefined,
  });
}

function getQmForDepartment(companyId, deptId) {
  const personsAll = stmts.getPersonsByCompany.all(companyId);
  return personsAll.find(p => p.role === 'QM' && p.department_id === deptId) || null;
}

function buildAuthoritySalutation(dept) {
  if (dept && dept.authority_salutation) {
    return `Sehr geehrte${dept.authority_salutation === 'Herr' ? 'r' : ''} ${dept.authority_salutation} ${dept.authority_name || ''}`;
  }
  return 'Sehr geehrte Damen und Herren';
}

async function sendDocumentEmail({ module, to, subject, text, filename, buffer, qm, logParams }) {
  const label = module === 'change' ? 'AC-Change' : 'AC-Audit';
  const smtp = getSmtpConfig(module);
  if (!smtp) throw Object.assign(new Error(`SMTP-Einstellungen (${label}) unvollständig`), { statusCode: 400 });
  const transporter = createTransporter(smtp);
  const replyTo = qm && qm.email ? qm.email : undefined;
  const mailOpts = { from: smtp.user, to, replyTo, subject, text, attachments: [{ filename, content: buffer, contentType: 'application/pdf' }] };
  if (qm && qm.email && qm.email !== to) mailOpts.bcc = qm.email;
  await transporter.sendMail(mailOpts);
  logAction(...logParams);
}

module.exports = {
  getSmtpConfig,
  createTransporter,
  getQmForDepartment,
  buildAuthoritySalutation,
  sendDocumentEmail,
};
