// Smoke test for audit_plan_line.authority_report_date — die sechste Zeile des
// Behörden-Kopfblocks. Bootet den echten Server gegen ein Wegwerf-DATA_DIR und
// prüft jeden Schreibweg, den die Spalte hat (Anlage, manuelle Zeile, PUT,
// Revision, Vorlage, Papierkorb-Restore), dazu die eine Regel, die sie von der
// Zeile darüber trennt: das Berichtsdatum datiert den Bericht, NICHT den Besuch —
// es speist das abgeleitete authority_date der Kachel bewusst nicht.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8402;
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
const dates = line => `Besuch ${line.audit_end_date} | Bericht ${line.authority_report_date}`;

// Genau der Body, den saveLineFields() des Kopfblocks schickt: die fünf
// gerenderten Felder plus die internen, die der Screen unverändert durchreicht.
const headBlockBody = over => ({
  subject: '', regulations: '', location: 'Braunschweig', planned_window: '',
  auditor_team: 'LBA', authority_auditor: 'Muster', auditee: 'Petra Prüfer',
  audit_start_date: null, audit_end_date: '2026-03-04',
  audit_location: '', document_ref: '', document_iss_rev: '',
  document_rev_date: null, recommendation: '',
  ...over
});

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

  // ── seed ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`, {
    name: 'CAMO', easa_permission_number: 'DE.MG.0001', regulation: 'Part-CAMO',
    authority_salutation: 'Frau', authority_name: 'Muster', authority_email: 'lba@example.org'
  })).payload;
  await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org', department_id: dept.id });

  // ── 1. Anlage: die Spalte kommt leer dazu ──
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const line = (await req('GET', `/api/audit-plan-lines/${plan.authority_line_id}`)).payload;
  check('POST audit-plans (AUTHORITY) legt den Bericht ohne Berichtsdatum an',
    line.authority_report_date === null, dates(line));

  // ── 2. PUT der Berichtsebene schreibt beide Daten getrennt ──
  const saved = (await req('PUT', `/api/audit-plan-lines/${line.id}`,
    headBlockBody({ authority_report_date: '2026-04-17' }))).payload;
  check('PUT schreibt Besuchs- und Berichtsdatum nebeneinander',
    saved.audit_end_date === '2026-03-04' && saved.authority_report_date === '2026-04-17', dates(saved));

  // Die eine Regel, die die zwei Zeilen trennt: das abgeleitete Besuchsdatum der
  // Kachel (COALESCE performed_date → audit_end_date → audit_start_date) liest
  // das Berichtsdatum nicht — sonst datierte ein Bericht vom April einen Besuch
  // im März um.
  const tiles = (await req('GET', `/api/departments/${dept.id}/audit-plans`)).payload;
  const tile = tiles.find(p => p.id === plan.id);
  check('  → das abgeleitete authority_date der Kachel bleibt das Besuchsdatum',
    tile.authority_date === '2026-03-04', String(tile.authority_date));

  // Ein geleertes Feld schickt null und räumt die Spalte — genau das soll ein
  // gelöschtes Datum tun.
  const cleared = (await req('PUT', `/api/audit-plan-lines/${line.id}`,
    headBlockBody({ authority_report_date: null }))).payload;
  check('  → ein geleertes Feld räumt das Berichtsdatum ab',
    cleared.authority_report_date === null && cleared.audit_end_date === '2026-03-04', dates(cleared));
  await req('PUT', `/api/audit-plan-lines/${line.id}`, headBlockBody({ authority_report_date: '2026-04-17' }));

  // ── 3. manuelle Zeile nimmt das Feld aus dem Body entgegen ──
  const manual = (await req('POST', `/api/audit-plans/${plan.id}/lines`,
    { authority_report_date: '2026-05-02' })).payload;
  check('POST lines übernimmt ein mitgeschicktes Berichtsdatum',
    manual.authority_report_date === '2026-05-02', dates(manual));

  // ── 4. interner Plan bleibt leer ──
  const internal = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  const internalLine = (await req('POST', `/api/audit-plans/${internal.id}/lines`,
    { subject: 'Themenbereich', audit_end_date: '2026-06-01' })).payload;
  check('POST lines (AUDIT) lässt das Berichtsdatum leer',
    internalLine.authority_report_date === null, dates(internalLine));
  const internalSaved = (await req('PUT', `/api/audit-plan-lines/${internalLine.id}`,
    { subject: 'Themenbereich', audit_end_date: '2026-06-02' })).payload;
  check('  → und der interne PUT ändert daran nichts',
    internalSaved.authority_report_date === null && internalSaved.audit_end_date === '2026-06-02',
    dates(internalSaved));

  // ── 5. Kopie: Revision nimmt es mit, Vorlage räumt es ab ──
  const revision = (await req('POST', `/api/audit-plans/${plan.id}/copy`, { mode: 'revision' })).payload;
  const revLine = (await req('GET', `/api/audit-plans/${revision.id}/lines`)).payload
    .find(l => l.authority_report_date === '2026-04-17');
  check('copy (revision) nimmt das Berichtsdatum mit', !!revLine, revLine ? dates(revLine) : 'nicht gefunden');
  const template = (await req('POST', `/api/audit-plans/${plan.id}/copy`, { mode: 'template' })).payload;
  const tplLine = (await req('GET', `/api/audit-plans/${template.id}/lines`)).payload[0];
  check('copy (template) räumt das Berichtsdatum mit den Auditdaten ab',
    tplLine.authority_report_date === null, dates(tplLine));

  // ── 6. Papierkorb ──
  await req('DELETE', `/api/audit-plan-lines/${manual.id}`);
  const trash = (await req('GET', '/api/trash?limit=50')).payload;
  const entry = (trash.items || trash).find(t => t.entity_id === manual.id);
  check('DELETE line landet im Papierkorb', !!entry, entry ? entry.entity_type : 'nicht gefunden');
  await req('POST', `/api/trash/${entry.id}/restore`);
  const restored = (await req('GET', `/api/audit-plan-lines/${manual.id}`)).payload;
  check('  → restore schreibt das Berichtsdatum zurück',
    restored.authority_report_date === '2026-05-02', dates(restored));

  // ── 7. der Bogen zeichnet noch: die Spalte sitzt im Kopfblock des PDFs ──
  // Der Text ist im fertigen PDF komprimiert, prüfbar ist der saubere Abschluss —
  // die Stelligkeit der Statements ist genau das, was ein Bogen ohne %%EOF
  // verriete (siehe das qmPerson-Pattern in CLAUDE.md).
  const pdf = await fetch(`${BASE}/api/audit-plan-lines/${line.id}/pdf`, { headers: { Cookie: cookie } });
  const body = Buffer.from(await pdf.arrayBuffer());
  check('GET line/pdf zeichnet den Bogen vollständig',
    pdf.status === 200 && body.subarray(0, 4).toString() === '%PDF' && body.includes('%%EOF'),
    `${pdf.status}, ${body.length} bytes`);

  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
