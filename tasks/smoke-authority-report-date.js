// Smoke test for the authority_report_date guard of PUT /api/audit-plan-lines/:id.
// Boots the real server against a throwaway DATA_DIR and checks the same contract
// tasks/smoke-authority-line-defaults.js checks for authority_auditor: an omitted
// field keeps the stored Berichtsdatum, an explicitly sent one — the empty string
// included — writes through, and no other write path of the line loses it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8397;
const BASE = `http://127.0.0.1:${PORT}`;

let cookie = '';
const req = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, payload };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

(async () => {
  const server = spawn('node', ['server.js'], {
    env: { ...process.env, DATA_DIR, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise(resolve => server.stdout.on('data', d => {
    if (d.toString().includes('running on')) resolve();
  }));

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`, {
    name: 'CAMO', easa_permission_number: 'DE.MG.0001', regulation: 'Part-CAMO',
    authority_salutation: 'Frau', authority_name: 'Muster', authority_email: 'lba@example.org'
  })).payload;

  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const line = (await req('GET', `/api/audit-plan-lines/${plan.authority_line_id}`)).payload;

  // ── 1. Die Anlage hat keine Vorbelegung: das Berichtsdatum steht im Schreiben
  //       der Behörde und ist erst bekannt, wenn das Schreiben da ist. ──
  check('Anlage lässt das Berichtsdatum leer', !line.authority_report_date,
    String(line.authority_report_date));

  // ── 2. Der Kopfblock der Berichtsebene schreibt es ──
  const written = (await req('PUT', `/api/audit-plan-lines/${line.id}`, {
    subject: '', regulations: '', location: 'Braunschweig', planned_window: '',
    auditor_team: 'LBA', authority_auditor: 'Muster', auditee: 'Petra Prüfer',
    authority_report_date: '2026-07-27',
    audit_start_date: null, audit_end_date: '2026-03-04', audit_location: '',
    document_ref: '', document_iss_rev: '', document_rev_date: null, recommendation: ''
  })).payload;
  check('PUT schreibt das Berichtsdatum', written.authority_report_date === '2026-07-27',
    String(written.authority_report_date));

  // Die eine Regel, die die beiden Datumszeilen des Kopfblocks trennt: das
  // abgeleitete Besuchsdatum der Kachel (COALESCE performed_date →
  // audit_end_date → audit_start_date) liest das Berichtsdatum NICHT. Sonst
  // datierte ein Bericht vom Juli den Besuch im März um, und Kachel,
  // Kachelsortierung und jede Überschrift zeigten den falschen Tag.
  const tile = (await req('GET', `/api/departments/${dept.id}/audit-plans`)).payload
    .find(p => p.id === plan.id);
  check('  → das abgeleitete authority_date bleibt das Besuchsdatum',
    tile.authority_date === '2026-03-04', String(tile.authority_date));

  // ── 3. Ein Aufrufer, der das Feld nicht kennt, löscht es nicht ──
  const kept = (await req('PUT', `/api/audit-plan-lines/${line.id}`, {
    auditor_team: 'LBA', auditee: 'Petra Prüfer', location: 'Bremen'
  })).payload;
  check('PUT ohne das Feld behält das Berichtsdatum',
    kept.authority_report_date === '2026-07-27' && kept.location === 'Bremen',
    `${kept.authority_report_date} | ${kept.location}`);

  // ── 4. Ein ausdrücklich gesendeter leerer String räumt es ab ──
  const cleared = (await req('PUT', `/api/audit-plan-lines/${line.id}`, {
    auditor_team: 'LBA', auditee: 'Petra Prüfer', authority_report_date: ''
  })).payload;
  check('  → ein ausdrücklich leeres Feld schreibt durch', cleared.authority_report_date === '',
    String(cleared.authority_report_date));

  // ── 5. Die manuelle Zeilenanlage kann es mitschicken ──
  const manual = (await req('POST', `/api/audit-plans/${plan.id}/lines`,
    { authority_report_date: '2026-08-01' })).payload;
  check('POST lines nimmt das Berichtsdatum entgegen', manual.authority_report_date === '2026-08-01',
    String(manual.authority_report_date));

  // ── 6. Papierkorb: löschen und wiederherstellen verliert es nicht ──
  await req('DELETE', `/api/audit-plan-lines/${manual.id}`);
  const trash = (await req('GET', '/api/trash?limit=50')).payload;
  const entry = (trash.items || trash).find(t => t.entity_id === manual.id);
  check('DELETE line landet im Papierkorb', !!entry, entry ? entry.entity_type : 'nicht gefunden');
  if (entry) {
    await req('POST', `/api/trash/${entry.id}/restore`);
    const restored = (await req('GET', `/api/audit-plan-lines/${manual.id}`)).payload;
    check('  → restore schreibt das Berichtsdatum zurück',
      restored.authority_report_date === '2026-08-01', String(restored.authority_report_date));
  }

  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
