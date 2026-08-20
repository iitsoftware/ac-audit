// Smoke test für die Fußzeile des Audit-Line-PDFs
// (authorityFooterLabel() in routes/audit-plan-lines.js).
//
// Geprüft wird genau die Regel: die Einzelroute eines Behördenberichts benennt in
// der Fußzeile den Besuch — `Behördenaudit <Behörde> am <Datum>` —, ohne Datum
// endet das Label bei der Behörde, und beides gilt NUR dort: die Batch-Route hat
// keinen einen Besuch und behält den Default, interne Pläne ohnehin.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich vor dem Laden der
// Routen einen Spy auf addPdfFooter: die Routen destrukturieren die Funktion beim
// Require, ein späteres Patchen käme zu spät. Der Spy ruft die echte Fußzeile auf,
// damit ein PDF-Fehler nicht unbemerkt bleibt — der Text selbst ist im fertigen
// Dokument komprimiert und dort nicht mehr zu lesen, geprüft wird deshalb, was
// wirklich im Aufruf steht.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8399;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const pdfCommon = require('../pdf/common');
const realFooter = pdfCommon.addPdfFooter;
let footerCalls = [];
pdfCommon.addPdfFooter = (doc, opts = {}) => {
  footerCalls.push(opts);
  return realFooter(doc, opts);
};

require('../server');

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

const pdf = async (url) => {
  footerCalls = [];
  const res = await fetch(BASE + url, { headers: { Cookie: cookie }, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  // Ein Wurf mitten im Renderer liefert trotzdem 200 mit gültigem %PDF-Kopf —
  // doc.pipe(res) läuft, bevor gezeichnet wird. Erst %%EOF zeigt den Abschluss.
  const text = buf.toString('latin1');
  return {
    status: res.status,
    isPdf: buf.slice(0, 4).toString() === '%PDF',
    bytes: buf.length,
    tail: text.slice(-40),
    label: (footerCalls[0] || {}).label,
    footerCalls,
  };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

(async () => {
  await new Promise(r => setTimeout(r, 400));

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', regulation: 'Part-CAMO' })).payload;
  await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', department_id: dept.id, first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org' });

  // ── 1. Behördenbericht MIT Datum ──
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const lineId = plan.authority_line_id;
  const line = (await req('GET', `/api/audit-plan-lines/${lineId}`)).payload;
  await req('PUT', `/api/audit-plan-lines/${lineId}`, { ...line, audit_end_date: '2026-03-12' });
  await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Werkzeugkontrolle unvollständig', evaluation: 'L2' });

  const dated = await pdf(`/api/audit-plan-lines/${lineId}/pdf`);
  check('Einzel-PDF eines Behördenberichts rendert vollständig',
    dated.status === 200 && dated.isPdf && dated.tail.includes('%%EOF'),
    `${dated.status}, ${dated.bytes} bytes`);
  check('  → Fußzeile benennt Besuch: Behördenaudit <Behörde> am <Datum>',
    dated.label === 'Behördenaudit LBA am 12.03.2026', String(dated.label));
  check('  → genau EIN addPdfFooter()-Aufruf für den ganzen Bogen (CM-002-Seiten inklusive)',
    dated.footerCalls.length === 1, `${dated.footerCalls.length} Aufruf(e)`);

  // ── 2. Behördenbericht OHNE Datum, mit eigener Behörde ──
  const undatedPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const undatedLine = (await req('GET', `/api/audit-plan-lines/${undatedPlan.authority_line_id}`)).payload;
  await req('PUT', `/api/audit-plan-lines/${undatedLine.id}`,
    { ...undatedLine, auditor_team: 'Luftfahrt-Bundesamt', audit_end_date: '' });

  const undated = await pdf(`/api/audit-plan-lines/${undatedLine.id}/pdf`);
  check('ein Besuch ohne Datum endet bei der Behörde, statt ein leeres "am" zu drucken',
    undated.label === 'Behördenaudit Luftfahrt-Bundesamt', String(undated.label));

  // ── 3. Interner Auditplan behält den Default ──
  const intPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  const intLine = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`,
    { subject: 'Themenbereich Technik' })).payload;
  await req('POST', `/api/audit-plan-lines/${intLine.id}/checklist-items`,
    { section: 'THEORETICAL', compliance_check: 'Interner Prüfpunkt', evaluation: 'L1' });

  const internal = await pdf(`/api/audit-plan-lines/${intLine.id}/pdf`);
  check('ein interner Auditplan behält die Default-Fußzeile',
    internal.label === undefined, String(internal.label));

  // ── 4. Batch-Route: kein EINER Besuch, also der Default ──
  const batch = await pdf(`/api/audit-plan-lines/pdf?ids=${lineId},${intLine.id}`);
  check('die Batch-Route behält den Default, auch wenn ein Behördenbericht dabei ist',
    batch.status === 200 && batch.isPdf && batch.label === undefined, String(batch.label));

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
