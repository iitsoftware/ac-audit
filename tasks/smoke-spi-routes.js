// Smoke test for the CM-006 PDF/email routes. Boots the real server against a
// throwaway DATA_DIR, seeds a company/department/year/objective/evaluations and
// exercises every new route. A minimal in-process SMTP stub catches the mails so
// the email routes run end to end (attachment included).
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8397;
const SMTP_PORT = 8398;
const BASE = `http://127.0.0.1:${PORT}`;

// ── SMTP stub: enough of the protocol for nodemailer's plain 587 session ──
const received = [];
const smtp = net.createServer(sock => {
  let data = '', inData = false, body = '';
  sock.write('220 smoke ESMTP\r\n');
  sock.on('data', chunk => {
    data += chunk.toString();
    let idx;
    while ((idx = data.indexOf('\r\n')) >= 0) {
      const line = data.slice(0, idx);
      data = data.slice(idx + 2);
      if (inData) {
        if (line === '.') { inData = false; received.push(body); body = ''; sock.write('250 OK\r\n'); }
        else body += line + '\n';
        continue;
      }
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write(`250-smoke\r\n250 AUTH PLAIN LOGIN\r\n`);
      else if (cmd === 'AUTH') sock.write('235 ok\r\n');
      else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});

let cookie = '';
const req = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('application/pdf')
    ? Buffer.from(await res.arrayBuffer())
    : (type.includes('json') ? await res.json() : await res.text());
  return { status: res.status, payload };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

(async () => {
  await new Promise(r => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  const server = spawn('node', ['server.js'], {
    env: { ...process.env, DATA_DIR, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise(resolve => server.stdout.on('data', d => {
    if (d.toString().includes('running on')) resolve();
  }));

  // login
  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // ── seed ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', easa_permission_number: 'DE.MG.0001', regulation: 'Part-CAMO' })).payload;
  await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org', department_id: dept.id });
  const year = (await req('POST', `/api/departments/${dept.id}/safety-years`, { year: 2026 })).payload;
  const objectives = (await req('GET', `/api/safety-years/${year.id}/objectives`)).payload;
  const obj = objectives[0];
  const evA = (await req('POST', `/api/safety-objectives/${obj.id}/spi-evaluations`,
    { eval_date: '2026-03-31', spi_value: '12', result_text: 'Erfüllt', rating: 'POSITIV',
      cause_analysis: 'Ursache', measures: 'Maßnahmen', decision: 'Entscheidung',
      decision_place: 'Bremen', decided_at: '2026-04-02', copy_to: 'MM, ACC' })).payload;
  const evB = (await req('POST', `/api/safety-objectives/${objectives[1].id}/spi-evaluations`,
    { eval_date: '2026-06-30', spi_value: '-2', result_text: 'Nicht erfüllt' })).payload;

  // SMTP settings for the AC-Change route used by AC-SMS
  await req('PUT', '/api/settings', {
    change_smtp_host: '127.0.0.1', change_smtp_port: String(SMTP_PORT),
    change_smtp_user: 'ac-change@example.org', change_smtp_pass: 'x', change_smtp_auth: 'false'
  });

  // ── 1. catalogue PDF ──
  let r = await req('GET', `/api/safety-years/${year.id}/objectives/pdf`);
  check('GET /api/safety-years/:yearId/objectives/pdf',
    r.status === 200 && Buffer.isBuffer(r.payload) && r.payload.slice(0, 4).toString() === '%PDF',
    `${r.status}, ${r.payload.length} bytes`);
  r = await req('GET', '/api/safety-years/does-not-exist/objectives/pdf');
  check('  → 404 for an unknown year', r.status === 404, String(r.status));

  // ── 2. batch PDF (route ordering: /pdf must not be eaten by :id) ──
  r = await req('GET', `/api/spi-evaluations/pdf?ids=${evA.id},${evB.id}`);
  check('GET /api/spi-evaluations/pdf?ids=…',
    r.status === 200 && Buffer.isBuffer(r.payload) && r.payload.slice(0, 4).toString() === '%PDF',
    `${r.status}, ${r.payload.length} bytes`);
  const pages = (r.payload.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('  → one page per evaluation', pages === 2, `${pages} pages`);
  r = await req('GET', '/api/spi-evaluations/pdf?ids=nope');
  check('  → 400 when nothing of the selection exists', r.status === 400, String(r.status));

  // ── 3. single PDF ──
  r = await req('GET', `/api/spi-evaluations/${evA.id}/pdf`);
  check('GET /api/spi-evaluations/:id/pdf',
    r.status === 200 && r.payload.slice(0, 4).toString() === '%PDF', `${r.status}, ${r.payload.length} bytes`);
  r = await req('GET', '/api/spi-evaluations/does-not-exist/pdf');
  check('  → 404 for an unknown evaluation', r.status === 404, String(r.status));

  // ── 4. batch email ──
  r = await req('POST', '/api/spi-evaluations/send-email', { ids: [evA.id, evB.id], to: 'srb@example.org' });
  check('POST /api/spi-evaluations/send-email', r.status === 200, JSON.stringify(r.payload));
  check('  → mail delivered with PDF attachment',
    received.length === 1 && /Content-Type: application\/pdf/.test(received[0]),
    `${received.length} mail(s)`);
  const subjectOf = mail => {
    const lines = (mail || '').split('\n');
    const start = lines.findIndex(l => l.startsWith('Subject:'));
    if (start < 0) return '';
    let raw = lines[start].slice(8).trim();
    for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++) raw += lines[i].trim();
    // decode the RFC 2047 =?UTF-8?Q?…?= words the transport folds the subject into
    return Buffer.from(
      raw.replace(/\?=\s*=\?UTF-8\?Q\?/gi, '').replace(/^=\?UTF-8\?Q\?/i, '').replace(/\?=$/, '')
        .replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
      'latin1').toString('utf8');
  };
  check('  → subject carries the safety year',
    /Safety Year 2026/.test(subjectOf(received[0])), subjectOf(received[0]));
  check('  → BCC to the QM', /qm@example.org/.test(received[0] || ''), '');
  r = await req('POST', '/api/spi-evaluations/send-email', { ids: [evA.id] });
  check('  → 400 without a recipient', r.status === 400, JSON.stringify(r.payload));
  r = await req('POST', '/api/spi-evaluations/send-email', { ids: [], to: 'x@example.org' });
  check('  → 400 on an empty selection', r.status === 400, JSON.stringify(r.payload));

  // ── 5. single email, formal authority letter ──
  await req('PUT', `/api/departments/${dept.id}`, {
    name: 'CAMO', easa_permission_number: 'DE.MG.0001', regulation: 'Part-CAMO',
    authority_salutation: 'Frau', authority_name: 'Muster', authority_email: 'lba@example.org'
  });
  r = await req('POST', `/api/spi-evaluations/${evA.id}/send-email`, { to: 'lba@example.org', authority: true });
  check('POST /api/spi-evaluations/:id/send-email (authority)', r.status === 200, JSON.stringify(r.payload));
  check('  → formal salutation in the body',
    /Sehr geehrte Frau Muster/.test(received[1] || ''), '');
  check('  → signed "Safety Manager"', /Safety Manager/.test(received[1] || ''), '');
  r = await req('POST', '/api/spi-evaluations/does-not-exist/send-email', { to: 'x@example.org' });
  check('  → 404 for an unknown evaluation', r.status === 404, String(r.status));

  // ── 6. audit log entries ──
  const logs = (await req('GET', '/api/logs?limit=50')).payload;
  const actions = (logs.items || logs).map(l => l.action);
  check('audit log records both send actions',
    actions.includes('SPI-Bewertungen gesendet') && actions.includes('SPI-Bewertung gesendet'),
    actions.filter(a => a.startsWith('SPI')).join(', '));

  server.kill();
  smtp.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
