// Smoke test für die Enddatum-Grenze des internen Unterschriftenblocks im
// Audit-Line-PDF (renderAuditLinePdf() in pdf/audit.js) — die Audit-Hälfte der
// Regel, deren Schwester `tasks/smoke-risk-signature-gate.js` abdeckt.
//
// Geprüft wird genau die Regel: der vierspaltige Kasten
// `Date | Auditor | <Abteilungsleiter-Rolle> | Accountable Manager` behauptet
// eine Freigabe und wird deshalb nur mit gesetztem `audit_end_date` gezeichnet.
// Ohne Enddatum entfällt er ersatzlos — samt seiner bis zu drei
// getPersonSignature-BLOB-Reads —, während die `Recommendation for Management`
// darüber ausdrücklich stehen bleibt: sie ist das Urteil des Auditors und kein
// Freigabeakt. Der Behördenbericht hat ohnehin keine Unterschriftenzeile und ist
// von der Änderung nicht betroffen.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich vor dem Laden der
// Routen einen Spy auf renderAuditLinePdf: die Routen destrukturieren die
// Funktion beim Require, ein späteres Patchen käme zu spät. Der Spy ruft den
// echten Renderer auf und spiegelt doc.text() und doc.image() — im fertigen PDF
// ist beides komprimiert, geprüft wird also, was wirklich gezeichnet wird.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8402;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const pdfAudit = require('../pdf/audit');
const realRender = pdfAudit.renderAuditLinePdf;
let renderCalls = [];
pdfAudit.renderAuditLinePdf = (doc, args) => {
  const call = { args, texts: [], images: [] };
  const realText = doc.text.bind(doc);
  doc.text = (txt, ...rest) => {
    call.texts.push(String(txt));
    return realText(txt, ...rest);
  };
  // Die Signaturbilder sind das einzige, was der Kasten zeichnet statt zu
  // schreiben — ohne diesen Spy bliebe der entfallene Kasten von einem mit
  // lauter leeren Zellen ununterscheidbar.
  const realImage = doc.image.bind(doc);
  doc.image = (src, x, y, ...rest) => {
    call.images.push({ x, y });
    return realImage(src, x, y, ...rest);
  };
  renderCalls.push(call);
  const out = realRender(doc, args);
  doc.text = realText;
  doc.image = realImage;
  return out;
};

require('../server');

// Die gesparten BLOB-Reads sind am Statement zu sehen, nicht am Blatt.
const { stmts } = require('../db');
const realSigStmt = stmts.getPersonSignature;
let sigReads = [];
stmts.getPersonSignature = {
  get: (id) => { sigReads.push(id); return realSigStmt.get(id); },
};

const { departmentLeaderLabel } = require('../pdf/common');

// 1x1-PNG, damit doc.image() wirklich etwas zu zeichnen bekommt.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let cookie = '';
const req = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, payload: type.includes('json') ? await res.json() : await res.text() };
};

const pdf = async (url) => {
  renderCalls = [];
  sigReads = [];
  const res = await fetch(BASE + url, { headers: { Cookie: cookie }, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  // Ein Wurf mitten im Renderer liefert trotzdem 200 mit gültigem %PDF-Kopf —
  // doc.pipe(res) läuft, bevor gezeichnet wird. Erst %%EOF zeigt den Abschluss.
  const tail = buf.toString('latin1').slice(-40);
  return {
    status: res.status,
    isPdf: buf.slice(0, 4).toString() === '%PDF',
    complete: tail.includes('%%EOF'),
    call: renderCalls[0] || { texts: [], images: [] },
    sigReads: sigReads.slice(),
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
  const alLabel = departmentLeaderLabel(dept);

  // Alle drei Unterzeichner mit hinterlegter Unterschrift: nur so ist das
  // Fehlen der Bilder ein Befund und nicht bloß ein fehlender Datensatz.
  const persons = [
    { role: 'QM', department_id: dept.id, first_name: 'Petra', last_name: 'Prüfer' },
    { role: 'ABTEILUNGSLEITER', department_id: dept.id, first_name: 'Lars', last_name: 'Leiter' },
    { role: 'ACCOUNTABLE', first_name: 'Anna', last_name: 'Accountable' },
  ];
  for (const p of persons) {
    const created = (await req('POST', `/api/companies/${company.id}/persons`,
      { ...p, email: `${p.role.toLowerCase()}@example.org` })).payload;
    await req('PUT', `/api/persons/${created.id}/signature`, { signature: PNG_1X1 });
  }

  const intPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;

  const makeInternalLine = async (fields) => {
    const line = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`,
      { subject: 'Themenbereich Technik' })).payload;
    await req('PUT', `/api/audit-plan-lines/${line.id}`,
      { ...line, recommendation: 'Werkzeugverwaltung nachschärfen', ...fields });
    await req('POST', `/api/audit-plan-lines/${line.id}/checklist-items`,
      { section: 'THEORETICAL', compliance_check: 'Interner Prüfpunkt', evaluation: 'L1' });
    return line;
  };

  const SIG_HEADERS = ['Date', 'Auditor', alLabel, 'Accountable Manager'];
  const headersDrawn = (call) => SIG_HEADERS.filter(h => call.texts.includes(h));
  // Auf einem Behördenbogen sind zwei dieser vier Köpfe mehrdeutig: der Kopfblock
  // des Besuchs beschriftet eine Zeile mit 'Auditor', und die CM-003-Tabelle am
  // Schluss trägt eine Spalte 'Date'. Unverwechselbar bleiben die beiden Rollen —
  // der Unterschriftenblock des CM-003 schreibt `Copy to: …` davor.
  const AUTHORITY_SAFE = [alLabel, 'Accountable Manager'];
  const sigHeadersDrawn = (call) => AUTHORITY_SAFE.filter(h => call.texts.includes(h));

  // ── 1. Abgeschlossenes internes Audit: der Kasten steht ──
  const done = await makeInternalLine({ audit_end_date: '2026-06-15' });
  const withDate = await pdf(`/api/audit-plan-lines/${done.id}/pdf`);
  check('internes PDF mit Enddatum rendert vollständig',
    withDate.status === 200 && withDate.isPdf && withDate.complete, String(withDate.status));
  check('  → die vier Spaltenköpfe der Unterschriftenzeile stehen auf dem Blatt',
    headersDrawn(withDate.call).length === 4, headersDrawn(withDate.call).join(' | '));
  check('  → die drei Signaturbilder werden gezeichnet',
    withDate.call.images.length === 3, `${withDate.call.images.length} Bild(er)`);
  check('  → die drei getPersonSignature-Reads laufen',
    withDate.sigReads.length === 3, `${withDate.sigReads.length} Read(s)`);
  check('  → Recommendation for Management steht darüber',
    withDate.call.texts.includes('Recommendation for Management'));

  // ── 2. Laufendes internes Audit: der Kasten entfällt, die Empfehlung bleibt ──
  const running = await makeInternalLine({ audit_end_date: '' });
  const noDate = await pdf(`/api/audit-plan-lines/${running.id}/pdf`);
  check('internes PDF ohne Enddatum rendert vollständig',
    noDate.status === 200 && noDate.isPdf && noDate.complete, String(noDate.status));
  check('  → KEIN Spaltenkopf der Unterschriftenzeile wird gedruckt',
    headersDrawn(noDate.call).length === 0, headersDrawn(noDate.call).join(' | ') || 'keiner');
  check('  → kein Signaturbild wird gezeichnet',
    noDate.call.images.length === 0, `${noDate.call.images.length} Bild(er)`);
  check('  → und damit auch kein getPersonSignature-BLOB-Read',
    noDate.sigReads.length === 0, `${noDate.sigReads.length} Read(s)`);
  check('  → Recommendation for Management bleibt ausdrücklich stehen',
    noDate.call.texts.includes('Recommendation for Management')
    && noDate.call.texts.includes('Werkzeugverwaltung nachschärfen'));
  check('  → Summary und Legend bleiben ebenfalls stehen',
    noDate.call.texts.includes('Summary') && noDate.call.texts.includes('Legend'));

  // ── 3. Behördenbericht: hatte nie eine Unterschriftenzeile, mit Datum wie ohne ──
  const authPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const authLine = (await req('GET', `/api/audit-plan-lines/${authPlan.authority_line_id}`)).payload;
  await req('PUT', `/api/audit-plan-lines/${authLine.id}`, { ...authLine, audit_end_date: '2026-03-12' });
  await req('POST', `/api/audit-plan-lines/${authLine.id}/checklist-items`,
    { compliance_check: 'Werkzeugkontrolle unvollständig', evaluation: 'L2' });

  const authority = await pdf(`/api/audit-plan-lines/${authLine.id}/pdf`);
  check('der Behördenbericht rendert vollständig',
    authority.status === 200 && authority.isPdf && authority.complete, String(authority.status));
  check('  → er zeichnet trotz Enddatum keine Unterschriftenzeile und keine Empfehlung',
    sigHeadersDrawn(authority.call).length === 0
    && !authority.call.texts.includes('Recommendation for Management'),
    sigHeadersDrawn(authority.call).join(' | ') || 'keiner');

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
