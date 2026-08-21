// Smoke test für das Gate des internen Unterschriftenblocks im Audit-Line-PDF
// (renderAuditLinePdf() in pdf/audit.js).
//
// Geprüft wird genau die Grenze: die vierspaltige Unterschriftenzeile
// Date | Auditor | <Abteilungsleiter-Rolle> | Accountable Manager hängt am
// `audit_end_date` der Zeile — ohne Enddatum ist das Audit noch nicht
// durchgeführt, das Blatt ist die leere Checkliste, und drei Unterschriftenkästen
// unter einem leeren Datum behaupteten eine Freigabe, die niemand erteilt hat.
// Die `Recommendation for Management` darüber ist ausdrücklich NICHT mitgegatet:
// sie ist das Feld, das der Auditor auf genau diesem leeren Blatt von Hand füllt.
// Ein späterer Umbau, der sie mit ins Gate zieht oder das Gate an
// `performed_date` / `audit_start_date` hängt, fällt hier auf.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich vor dem Laden der
// Routen einen Spy auf renderAuditLinePdf: die Routen destrukturieren die Funktion
// beim Require, ein späteres Patchen käme zu spät. Der Spy ruft den echten Renderer
// auf und spiegelt zusätzlich doc.text() und doc.image() — im fertigen PDF ist der
// Text komprimiert und nicht mehr zu lesen, geprüft wird also, was wirklich
// gezeichnet wird.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8402;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const auditPdf = require('../pdf/audit');
const realRender = auditPdf.renderAuditLinePdf;
let renderCalls = [];
auditPdf.renderAuditLinePdf = (doc, args) => {
  const call = { args, texts: [], images: [] };
  const realText = doc.text.bind(doc);
  doc.text = (txt, ...rest) => {
    call.texts.push(String(txt));
    return realText(txt, ...rest);
  };
  // Die Unterschriftsbilder sind das einzige, was der Block zeichnet statt zu
  // schreiben — ohne diesen Spy bliebe eine leere Zelle vom vollen Kasten
  // ununterscheidbar, denn im fertigen PDF ist beides komprimiert.
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

// Ohne Unterschriftenblock hat niemand ein Bild zu zeichnen, also darf auch kein
// BLOB gelesen werden — das ist am Statement zu sehen und nicht am Blatt, genau
// wie der has_signature-Guard in tasks/smoke-cap-form-pdf.js.
const { stmts } = require('../db');
const realSigStmt = stmts.getPersonSignature;
let sigReads = [];
stmts.getPersonSignature = {
  get: (id) => { sigReads.push(id); return realSigStmt.get(id); },
};

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
  const text = buf.toString('latin1');
  return {
    status: res.status,
    ok: res.status === 200 && buf.slice(0, 4).toString() === '%PDF' && text.slice(-40).includes('%%EOF'),
    bytes: buf.length,
    call: renderCalls[0] || { texts: [], images: [] },
    sigReads,
  };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

// Die Kopfzeile des Blocks wird EXAKT verglichen und nicht mit includes():
// 'Auditor' steht auch im Behörden-Kopfblock als Feldbeschriftung, und
// 'Accountable Manager' steckt im CM-003 in 'Copy to: Accountable Manager'.
// Eine Teilstring-Prüfung könnte den Block also dort finden, wo er gerade nicht
// steht — und wäre damit blind für genau den Fehler, den dieser Test sucht.
const drew = (call, label) => call.texts.some(t => t === label);

(async () => {
  await new Promise(r => setTimeout(r, 400));

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // ── seed: eine Abteilung mit allen drei Unterzeichnern ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', regulation: 'Part-CAMO' })).payload;
  // 'Leiter CAMO' ist das, was departmentLeaderLabel() für diese Abteilung liefert;
  // die dritte Spalte trägt die Rolle und nicht das Wort 'Abteilungsleiter'.
  const AL_LABEL = require('../pdf/common').departmentLeaderLabel(dept);
  const SIG_HEADERS = ['Date', 'Auditor', AL_LABEL, 'Accountable Manager'];

  const qm = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', department_id: dept.id, first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org' })).payload;
  const al = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'ABTEILUNGSLEITER', department_id: dept.id, first_name: 'Anton', last_name: 'Leiter' })).payload;
  const acc = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'ACCOUNTABLE', first_name: 'Anja', last_name: 'Chefin' })).payload;
  // 1×1-PNG — der Inhalt ist gleichgültig, geprüft wird, DASS gezeichnet wird.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await req('PUT', `/api/persons/${qm.id}/signature`, { signature: PNG });
  await req('PUT', `/api/persons/${al.id}/signature`, { signature: PNG });
  await req('PUT', `/api/persons/${acc.id}/signature`, { signature: PNG });

  const intPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;

  // ── 1. Interner Auditplan MIT Enddatum: der Block steht ──
  const doneLine = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`, {
    subject: 'Themenbereich Technik', audit_no: '1',
    audit_start_date: '2026-03-02', audit_end_date: '2026-03-04',
    recommendation: 'Werkzeugliste jährlich prüfen'
  })).payload;
  await req('POST', `/api/audit-plan-lines/${doneLine.id}/checklist-items`,
    { section: 'THEORETICAL', compliance_check: 'Interner Prüfpunkt', evaluation: 'L1' });

  const done = await pdf(`/api/audit-plan-lines/${doneLine.id}/pdf`);
  check('durchgeführtes internes Audit: das PDF läuft vollständig durch',
    done.ok, `${done.status}, ${done.bytes} bytes`);
  check('  → die vierspaltige Kopfzeile des Unterschriftenblocks steht auf dem Blatt',
    SIG_HEADERS.every(h => drew(done.call, h)),
    SIG_HEADERS.filter(h => !drew(done.call, h)).join(', ') || SIG_HEADERS.join(' | '));
  // Das Enddatum in der ersten Spalte ist der Grund, warum das Gate an dieser
  // Spalte hängt: der Block druckt genau den Wert, an dem er hängt.
  check('  → das Enddatum steht in der ersten Spalte',
    drew(done.call, '04.03.2026'), done.call.texts.filter(t => /^\d\d\.\d\d\.\d{4}$/.test(t)).join(', '));
  check('  → die drei Unterzeichner werden gelesen und gezeichnet',
    done.sigReads.length === 3 && done.call.images.length === 3,
    `${done.sigReads.length} Read(s), ${done.call.images.length} Bild(er)`);
  check('  → und es sind QM, Abteilungsleiter und Accountable Manager',
    [qm.id, al.id, acc.id].every(id => done.sigReads.includes(id)),
    `${done.sigReads.length} Read(s)`);
  check('  → die Recommendation steht ebenfalls',
    drew(done.call, 'Recommendation for Management')
      && drew(done.call, 'Werkzeugliste jährlich prüfen'),
    'mit Text');

  // ── 2. Interner Auditplan OHNE Enddatum: kein Block, kein BLOB-Read ──
  // Die leere Checkliste, die der Auditor mitnimmt. audit_start_date und
  // performed_date sind dabei ABSICHTLICH gesetzt bzw. leer: hinge das Gate am
  // falschen Datumsfeld, stünde der Block hier trotzdem.
  const openLine = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`, {
    subject: 'Themenbereich Lager', audit_no: '2',
    audit_start_date: '2026-04-06',
    recommendation: 'Wird im Audit ausgefüllt'
  })).payload;
  await req('POST', `/api/audit-plan-lines/${openLine.id}/checklist-items`,
    { section: 'THEORETICAL', compliance_check: 'Noch offener Prüfpunkt' });

  const open = await pdf(`/api/audit-plan-lines/${openLine.id}/pdf`);
  check('noch nicht durchgeführtes internes Audit: das PDF läuft vollständig durch',
    open.ok, `${open.status}, ${open.bytes} bytes`);
  check('  → das Blatt trägt das begonnene Audit (Gate hängt nicht an audit_start_date)',
    !open.call.args.line.audit_end_date && open.call.args.line.audit_start_date === '2026-04-06',
    `start ${open.call.args.line.audit_start_date}, end ${String(open.call.args.line.audit_end_date)}`);
  check('  → keine einzige Kopfzeile der vier Spalten wird gezeichnet',
    SIG_HEADERS.every(h => !drew(open.call, h)),
    SIG_HEADERS.filter(h => drew(open.call, h)).join(', ') || 'keine');
  check('  → und damit auch kein Unterschriftsbild',
    open.call.images.length === 0, `${open.call.images.length} Bild(er)`);
  check('  → ausdrücklich KEIN getPersonSignature-Read: ein Bild ohne Kasten hat niemand zu zeichnen',
    open.sigReads.length === 0, `${open.sigReads.length} Read(s)`);

  // ── 3. Die Recommendation ist nicht mitgegatet ──
  check('die Recommendation steht auf BEIDEN Blättern',
    drew(done.call, 'Recommendation for Management') && drew(open.call, 'Recommendation for Management'),
    `mit Enddatum: ${drew(done.call, 'Recommendation for Management')}, ohne: ${drew(open.call, 'Recommendation for Management')}`);
  check('  → samt ihrem Text, den der Auditor auf dem leeren Blatt von Hand füllt',
    drew(open.call, 'Wird im Audit ausgefüllt'), 'Text steht');

  // ── 4. Behördenplan: unverändert kein Block, mit Enddatum wie ohne ──
  // Der Behördenzweig hat den Block nie gezeichnet; das Gate darf daran nichts
  // ändern. Die getPersonSignature-Reads bleiben dort trotzdem möglich — sie
  // gehören zum Unterschriftenblock des CM-003 am Schluss des Bogens und nicht
  // zu diesem hier, weshalb nur auf die Kopfzeile geprüft wird.
  const authPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const authLineId = authPlan.authority_line_id;
  await req('POST', `/api/audit-plan-lines/${authLineId}/checklist-items`,
    { compliance_check: 'Werkzeugkontrolle unvollständig', evaluation: 'L2' });

  const authOpen = await pdf(`/api/audit-plan-lines/${authLineId}/pdf`);
  check('Behördenbericht ohne Datum: das PDF läuft vollständig durch',
    authOpen.ok, `${authOpen.status}, ${authOpen.bytes} bytes`);
  check('  → kein interner Unterschriftenblock',
    !drew(authOpen.call, AL_LABEL) && !drew(authOpen.call, 'Accountable Manager'),
    'keine Kopfzeile');
  check('  → und keine Recommendation (die entfällt dort ersatzlos)',
    !drew(authOpen.call, 'Recommendation for Management'), 'nicht gezeichnet');

  const stored = (await req('GET', `/api/audit-plan-lines/${authLineId}`)).payload;
  await req('PUT', `/api/audit-plan-lines/${authLineId}`,
    Object.assign({}, stored, { audit_end_date: '2026-05-11' }));
  const authDone = await pdf(`/api/audit-plan-lines/${authLineId}/pdf`);
  check('Behördenbericht MIT Datum: das PDF läuft vollständig durch',
    authDone.ok, `${authDone.status}, ${authDone.bytes} bytes`);
  check('  → das Enddatum ist gesetzt und ändert am Behördenzweig nichts',
    authDone.call.args.line.audit_end_date === '2026-05-11'
      && !drew(authDone.call, AL_LABEL) && !drew(authDone.call, 'Accountable Manager'),
    `end ${authDone.call.args.line.audit_end_date}, keine Kopfzeile`);
  check('  → auch dort weiterhin keine Recommendation',
    !drew(authDone.call, 'Recommendation for Management'), 'nicht gezeichnet');

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
