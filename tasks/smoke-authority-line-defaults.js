// Smoke test for authorityLineDefaults() and every write path that carries
// audit_plan_line.authority_auditor. Boots the real server against a throwaway
// DATA_DIR and checks the three roles of the Behörden-Kopfblocks:
// auditor_team = Behörde ('LBA'), authority_auditor = zuständiger Bearbeiter
// (department.authority_name), auditee = QM der Abteilung.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8399;
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
const roles = line => `${line.auditor_team} | ${line.authority_auditor} | ${line.auditee}`;

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

  // ── seed: Abteilung mit Aufsichtsperson + QM ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`, {
    name: 'CAMO', easa_permission_number: 'DE.MG.0001', regulation: 'Part-CAMO',
    authority_salutation: 'Frau', authority_name: 'Muster', authority_email: 'lba@example.org'
  })).payload;
  await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org', department_id: dept.id });

  // ── 1. Plan-Anlage legt den Bericht mit an ──
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  let line = (await req('GET', `/api/audit-plan-lines/${plan.authority_line_id}`)).payload;
  check('POST audit-plans (AUTHORITY) belegt Behörde | Bearbeiter | Auditee vor',
    line.auditor_team === 'LBA' && line.authority_auditor === 'Muster' && line.auditee === 'Petra Prüfer',
    roles(line));

  // ── 2. manuelles Anlegen einer Zeile liest denselben Helfer ──
  const manual = (await req('POST', `/api/audit-plans/${plan.id}/lines`, {})).payload;
  check('POST lines (AUTHORITY, leerer Body) belegt genauso vor',
    manual.auditor_team === 'LBA' && manual.authority_auditor === 'Muster' && manual.auditee === 'Petra Prüfer',
    roles(manual));

  const explicit = (await req('POST', `/api/audit-plans/${plan.id}/lines`,
    { authority_auditor: 'Selbst eingetragen' })).payload;
  check('  → eine Eingabe im Body schaltet die Vorbelegung ab',
    explicit.auditor_team === '' && explicit.authority_auditor === 'Selbst eingetragen' && explicit.auditee === '',
    roles(explicit));

  // ── 3. interner Plan bleibt unberührt ──
  const internal = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  check('  → interner Plan legt keinen Bericht an', internal.authority_line_id === null,
    String(internal.authority_line_id));
  const internalLine = (await req('POST', `/api/audit-plans/${internal.id}/lines`,
    { subject: 'Themenbereich' })).payload;
  check('POST lines (AUDIT) belegt nichts vor',
    internalLine.auditor_team === '' && internalLine.authority_auditor === '' && internalLine.auditee === '',
    roles(internalLine));

  // ── 4. Kopie: Revision übernimmt den Bearbeiter, Vorlage räumt ihn ab ──
  const revision = (await req('POST', `/api/audit-plans/${plan.id}/copy`, { mode: 'revision' })).payload;
  const revLine = (await req('GET', `/api/audit-plans/${revision.id}/lines`)).payload
    .find(l => l.auditee === 'Petra Prüfer');
  check('copy (revision) nimmt authority_auditor mit',
    revLine && revLine.auditor_team === 'LBA' && revLine.authority_auditor === 'Muster', roles(revLine || {}));
  const template = (await req('POST', `/api/audit-plans/${internal.id}/copy`, { mode: 'template' })).payload;
  const tplLine = (await req('GET', `/api/audit-plans/${template.id}/lines`)).payload[0];
  check('copy (template) räumt die Auditdaten ab',
    tplLine.subject === 'Themenbereich' && tplLine.auditor_team === '' && tplLine.authority_auditor === '',
    roles(tplLine));

  // ── 5. PUT der Berichtsebene: der Bearbeiter überlebt jedes Speichern ──
  // Genau der Body, den saveLineFields() des Kopfblocks schickt — Behörde, Datum
  // und Ort, kein authority_auditor, weil dafür kein Feld existiert.
  const saved = (await req('PUT', `/api/audit-plan-lines/${line.id}`, {
    subject: '', regulations: '', location: 'Braunschweig', planned_window: '',
    auditor_team: 'LBA', auditee: 'Petra Prüfer',
    audit_start_date: null, audit_end_date: '2026-03-04', audit_location: '',
    document_ref: '', document_iss_rev: '', document_rev_date: null, recommendation: ''
  })).payload;
  check('PUT ohne authority_auditor behält den Bearbeiter',
    saved.authority_auditor === 'Muster' && saved.location === 'Braunschweig', roles(saved));

  const overwritten = (await req('PUT', `/api/audit-plan-lines/${line.id}`,
    { auditor_team: 'LBA', authority_auditor: 'Neuer Bearbeiter', auditee: 'Petra Prüfer' })).payload;
  check('  → ein mitgeschickter Bearbeiter schreibt durch',
    overwritten.authority_auditor === 'Neuer Bearbeiter', roles(overwritten));

  // ── 6. Papierkorb: löschen und wiederherstellen verliert den Bearbeiter nicht ──
  await req('DELETE', `/api/audit-plan-lines/${manual.id}`);
  const trash = (await req('GET', '/api/trash?limit=50')).payload;
  const entry = (trash.items || trash).find(t => t.entity_id === manual.id);
  check('DELETE line landet im Papierkorb', !!entry, entry ? entry.entity_type : 'nicht gefunden');
  await req('POST', `/api/trash/${entry.id}/restore`);
  const restored = (await req('GET', `/api/audit-plan-lines/${manual.id}`)).payload;
  check('  → restore schreibt authority_auditor zurück',
    restored.auditor_team === 'LBA' && restored.authority_auditor === 'Muster' && restored.auditee === 'Petra Prüfer',
    roles(restored));

  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
