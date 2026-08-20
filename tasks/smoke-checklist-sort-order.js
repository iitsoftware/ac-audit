// Smoke test für die vergebene laufende Nummer eines Findings
// (audit_checklist_item.sort_order). Bootet den echten Server gegen ein
// Wegwerf-DATA_DIR und prüft die beiden Schreibwege: das Anlegen zählt die Line
// mit max+1 weiter, das Speichern behält eine ausgelassene Nummer und schreibt
// eine ausdrücklich gesendete durch — inklusive der bewussten Folge, dass nach
// dem Löschen der 2 die Sequenz 1, 3 bleibt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8398;
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
const orders = items => items.map(i => i.sort_order).join(', ');

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

  // ── seed: Abteilung + Behördenaudit mit seinem einen Bericht ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', regulation: 'Part-CAMO' })).payload;
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const lineId = plan.authority_line_id;

  // ── 1. Anlegen ohne sort_order zählt die Line weiter ──
  const add = async body => (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`, body)).payload;
  const f1 = await add({ regulation_ref: '145.A.30', compliance_check: 'Erstes Finding' });
  const f2 = await add({ regulation_ref: '145.A.35', compliance_check: 'Zweites Finding' });
  const f3 = await add({ regulation_ref: '145.A.40', compliance_check: 'Drittes Finding' });
  check('POST ohne sort_order vergibt 0, 1, 2',
    f1.sort_order === 0 && f2.sort_order === 1 && f3.sort_order === 2,
    orders([f1, f2, f3]));

  // ── 2. Löschen der 2: die Sequenz bleibt, das nächste Finding zählt weiter ──
  await req('DELETE', `/api/checklist-items/${f2.id}`);
  const f4 = await add({ regulation_ref: '145.A.42', compliance_check: 'Viertes Finding' });
  check('nach dem Löschen der 2 zählt max+1 weiter (0, 2, 3)', f4.sort_order === 3, String(f4.sort_order));
  let items = (await req('GET', `/api/audit-plan-lines/${lineId}/checklist-items`)).payload;
  check('  → die Liste bleibt nach der vergebenen Nummer sortiert',
    orders(items) === '0, 2, 3', orders(items));

  // ── 3. Ein ausdrücklich gesendeter Wert gewinnt (interne Audits) ──
  const explicit = await add({ sort_order: 42, compliance_check: 'Eigene Nummer' });
  check('POST mit sort_order übernimmt den Wert', explicit.sort_order === 42, String(explicit.sort_order));
  const zero = await add({ sort_order: 0, compliance_check: 'Ausdrückliche Null' });
  check('  → auch die ausdrückliche 0', zero.sort_order === 0, String(zero.sort_order));

  // ── 4. PUT: ausgelassene Nummer bleibt, gesendete schreibt durch ──
  const kept = (await req('PUT', `/api/checklist-items/${f4.id}`, {
    section: 'THEORETICAL', regulation_ref: '145.A.42',
    compliance_check: 'Viertes Finding, bearbeitet', evaluation: '',
    auditor_comment: '', document_ref: ''
  })).payload;
  check('PUT ohne sort_order behält die vergebene Nummer',
    kept.sort_order === 3 && kept.compliance_check === 'Viertes Finding, bearbeitet', String(kept.sort_order));

  const renumbered = (await req('PUT', `/api/checklist-items/${f4.id}`, {
    section: 'THEORETICAL', sort_order: 1, regulation_ref: '145.A.42',
    compliance_check: 'Viertes Finding, bearbeitet', evaluation: '',
    auditor_comment: '', document_ref: ''
  })).payload;
  check('  → eine mitgeschickte Nummer schreibt durch', renumbered.sort_order === 1, String(renumbered.sort_order));

  const cleared = (await req('PUT', `/api/checklist-items/${f4.id}`, {
    section: 'THEORETICAL', sort_order: 0, regulation_ref: '145.A.42',
    compliance_check: 'Viertes Finding, bearbeitet', evaluation: '',
    auditor_comment: '', document_ref: ''
  })).payload;
  check('  → die ausdrückliche 0 ebenfalls', cleared.sort_order === 0, String(cleared.sort_order));

  // ── 5. Interne Audits: der Dialog schickt seine Sortierung, nichts ändert sich ──
  const internal = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  const internalLine = (await req('POST', `/api/audit-plans/${internal.id}/lines`,
    { subject: 'Themenbereich' })).payload;
  const i1 = (await req('POST', `/api/audit-plan-lines/${internalLine.id}/checklist-items`,
    { section: 'PRACTICAL', sort_order: 1, compliance_check: 'Prüfpunkt' })).payload;
  const i2 = (await req('POST', `/api/audit-plan-lines/${internalLine.id}/checklist-items`,
    { section: 'PRACTICAL', sort_order: 2, compliance_check: 'Prüfpunkt' })).payload;
  check('interner Plan: der Dialogwert bleibt unverändert',
    i1.sort_order === 1 && i2.sort_order === 2, orders([i1, i2]));

  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
