// Smoke test für die Daten, die die beiden Audit-Line-PDF-Routen einem
// Behördenbericht mitgeben (authorityPdfData() in routes/audit-plan-lines.js).
// Geprüft wird genau die Hausregel: der Renderer liest nichts selbst, also muss
// alles — die CAPs der Line mit je ihrem 5-Why-Satz und ihren Maßnahmen, die
// Fristen und der QM als Unterzeichner — schon im Aufruf stehen, und zwar in der
// Form, die renderAuditLinePdf() liest. Für interne Pläne darf davon nichts
// mitreisen.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich vor dem Laden der
// Routen einen Spy auf renderAuditLinePdf: die Routen destrukturieren die Funktion
// beim Require, ein späteres Patchen käme zu spät. Der Spy ruft den echten
// Renderer auf, damit ein PDF-Fehler nicht unbemerkt bleibt.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8398;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const auditPdf = require('../pdf/audit');
const realRender = auditPdf.renderAuditLinePdf;
let calls = [];
auditPdf.renderAuditLinePdf = (doc, opts) => {
  calls.push(opts);
  return realRender(doc, opts);
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
  calls = [];
  const res = await fetch(BASE + url, { headers: { Cookie: cookie }, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  // Ein Wurf mitten im Renderer liefert trotzdem 200 mit gültigem %PDF-Kopf —
  // doc.pipe(res) läuft, bevor gezeichnet wird. Erst der Abschluss %%EOF und die
  // Seitenzahl zeigen, dass der Bogen wirklich vollständig ist.
  const text = buf.toString('latin1');
  return {
    status: res.status,
    isPdf: buf.slice(0, 4).toString() === '%PDF',
    bytes: buf.length,
    tail: text.slice(-40),
    pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length,
    calls,
  };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
// Genau die drei Felder, die renderAuditLinePdf() für ein Behördenblatt entgegennimmt:
// caps (checklist_item_id → { cap, fiveWhy, capActions }), deadlines und signer.
const AUTHORITY_KEYS = ['caps', 'deadlines', 'signer'];

(async () => {
  await new Promise(r => setTimeout(r, 400));

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // ── seed: Abteilung mit QM, ein Behördenaudit, ein interner Auditplan ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', regulation: 'Part-CAMO' })).payload;
  const qm = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', department_id: dept.id, first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org' })).payload;

  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const lineId = plan.authority_line_id;

  // Finding MIT Level → CAP-Item, 5-Why und zwei Maßnahmen; Finding OHNE Level
  // → kein CAP-Item, also auch nichts, was daran hinge.
  const withLevel = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`, {
    regulation_ref: '145.A.30', compliance_check: 'Werkzeugkontrolle unvollständig',
    document_ref: 'LBA-2026-04', evaluation: 'L2', cap_deadline: '2026-03-31'
  })).payload;
  const noLevel = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { regulation_ref: '145.A.35', compliance_check: 'Finding ohne Level' })).payload;

  const cap = ((await req('GET', `/api/audit-plans/${plan.id}/cap-items`)).payload.items || [])
    .find(c => c.checklist_item_id === withLevel.id);
  await req('PUT', `/api/cap-items/${cap.id}/five-why`, {
    why1: 'Auswirkung: Werkzeug fehlte', why2: 'Direkte Ursache: keine Ausgabekontrolle',
    why3: 'Tiefere Ursache: Liste veraltet', why4: 'Organisationsmangel: kein Review',
    why5: 'Systemmangel: Prozess fehlt', root_cause: 'Fehlender Kontrollprozess'
  });
  await req('POST', `/api/cap-items/${cap.id}/actions`,
    { kind: 'CORRECTIVE', description: 'Werkzeugliste neu aufnehmen' });
  await req('POST', `/api/cap-items/${cap.id}/actions`,
    { kind: 'PREVENTIVE', description: 'Quartalsweise Kontrolle einführen' });

  // Zweiter Behördenbericht am selben Plan (Altbestand mit >1 Zeile) — seine CAPs
  // dürfen nicht im Aufruf des ersten Berichts landen.
  const otherLine = (await req('POST', `/api/audit-plans/${plan.id}/lines`, { subject: 'Zweiter Bericht' })).payload;
  const otherFinding = (await req('POST', `/api/audit-plan-lines/${otherLine.id}/checklist-items`,
    { compliance_check: 'Fremdes Finding', evaluation: 'L1' })).payload;

  const intPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  const intLine = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`, { subject: 'Themenbereich Technik' })).payload;
  await req('POST', `/api/audit-plan-lines/${intLine.id}/checklist-items`,
    { section: 'THEORETICAL', compliance_check: 'Interner Prüfpunkt', evaluation: 'L1' });

  // ── 1. Einzel-PDF eines Behördenberichts ──
  const single = await pdf(`/api/audit-plan-lines/${lineId}/pdf`);
  check('Einzel-PDF eines Behördenberichts wird ausgeliefert',
    single.status === 200 && single.isPdf && single.bytes > 1000,
    `${single.status}, ${single.bytes} bytes`);
  const opts = single.calls[0] || {};
  check('  → alle drei Zusatzangaben stehen im Aufruf',
    AUTHORITY_KEYS.every(k => opts[k] !== undefined),
    AUTHORITY_KEYS.filter(k => opts[k] === undefined).join(', ') || 'vollständig');
  const entry = (opts.caps || {})[withLevel.id] || {};
  check('  → caps ist auf die checklist_item_id geschlüsselt, wie der Renderer liest',
    !!entry.cap && entry.cap.id === cap.id, Object.keys(opts.caps || {}).length + ' Eintrag/Einträge');
  check('  → nur die CAPs DIESES Berichts, nicht die des ganzen Plans',
    Object.keys(opts.caps || {}).length === 1 && !(opts.caps || {})[otherFinding.id],
    `fremdes Finding: ${otherFinding.id.slice(0, 8)}…`);
  check('  → die CAP-Zeile bringt compliance_check / regulation_ref / audit_no mit',
    entry.cap.compliance_check === 'Werkzeugkontrolle unvollständig'
      && entry.cap.regulation_ref === '145.A.30'
      && !!entry.cap.audit_no,
    entry.cap.audit_no);
  check('  → der 5-Why-Satz hängt am selben Eintrag',
    (entry.fiveWhy || {}).root_cause === 'Fehlender Kontrollprozess',
    (entry.fiveWhy || {}).why1);
  check('  → beide Maßnahmen hängen am selben Eintrag',
    (entry.capActions || []).length === 2,
    (entry.capActions || []).map(a => a.kind).join(', '));
  check('  → ein Finding ohne Level hat keinen caps-Eintrag (Zustand, kein Fehler)',
    (opts.caps || {})[noLevel.id] === undefined, String((opts.caps || {})[noLevel.id]));
  check('  → die Frist steht unter der checklist_item_id des Findings',
    opts.deadlines[withLevel.id] === '2026-03-31', opts.deadlines[withLevel.id]);
  check('  → ein Finding ohne Level hat keine Frist',
    opts.deadlines[noLevel.id] === undefined, String(opts.deadlines[noLevel.id]));
  check('  → der QM der Abteilung ist der Unterzeichner des CM-002',
    opts.signer && opts.signer.id === qm.id,
    opts.signer && `${opts.signer.first_name} ${opts.signer.last_name}`);

  check('  → der Bogen läuft vollständig durch (%%EOF)',
    single.tail.includes('%%EOF'), single.tail.trim().slice(-12));
  // Die Findingseiten hängen an dem, was die Route lädt: ohne caps bliebe es beim
  // einseitigen Deckblatt. Sechs Seiten = Deckblatt + die vier Seiten des Findings
  // mit Level (Findingdaten | CM-002 Seite 1 | CM-002 Seite 2 | Maßnahmen) + der
  // eine Datenblock des Findings ohne Level. Die Aufteilung selbst prüft
  // tasks/smoke-authority-finding-pages.js.
  check('  → die geladenen Daten erzeugen die Findingseiten',
    single.pages === 6, `${single.pages} Seite(n)`);

  // ── 2. Interner Plan: keine einzige Zusatzangabe ──
  const internal = await pdf(`/api/audit-plan-lines/${intLine.id}/pdf`);
  check('Einzel-PDF eines internen Audits wird ausgeliefert',
    internal.status === 200 && internal.isPdf, `${internal.status}, ${internal.bytes} bytes`);
  const intOpts = internal.calls[0] || {};
  check('  → der Aufruf ist unverändert: keine der drei Angaben reist mit',
    AUTHORITY_KEYS.every(k => intOpts[k] === undefined),
    AUTHORITY_KEYS.filter(k => intOpts[k] !== undefined).join(', ') || 'keine');

  // ── 3. Batch-PDF trennt die beiden Plantypen je Zeile ──
  const batch = await pdf(`/api/audit-plan-lines/pdf?ids=${lineId},${intLine.id}`);
  check('Batch-PDF wird ausgeliefert und rendert beide Zeilen',
    batch.status === 200 && batch.isPdf && batch.calls.length === 2,
    `${batch.status}, ${batch.calls.length} Aufruf(e)`);
  check('  → die Behördenzeile bekommt ihre Zusatzangaben',
    AUTHORITY_KEYS.every(k => batch.calls[0][k] !== undefined)
      && Object.keys(batch.calls[0].caps).length === 1,
    String(Object.keys(batch.calls[0].caps || {}).length));
  check('  → die interne Zeile im selben Aufruf bekommt keine',
    AUTHORITY_KEYS.every(k => batch.calls[1][k] === undefined),
    AUTHORITY_KEYS.filter(k => batch.calls[1][k] !== undefined).join(', ') || 'keine');

  // ── 4. Ein Bericht ohne Findings bleibt ein PDF ──
  const emptyPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2027, plan_type: 'AUTHORITY' })).payload;
  const empty = await pdf(`/api/audit-plan-lines/${emptyPlan.authority_line_id}/pdf`);
  check('ein Behördenbericht ohne Findings rendert weiterhin',
    empty.status === 200 && empty.isPdf && Object.keys(empty.calls[0].caps || {}).length === 0,
    `${empty.status}, ${empty.bytes} bytes`);

  // ── 5. Abteilung OHNE QM: der Unterzeichner-Fallback muss auflösbar sein ──
  // getQmForDepartment() findet dann niemanden, `signer` ist null, und erst da
  // wertet `signer || qmPerson` in renderAuditLinePdf() den zweiten Operanden aus.
  // Stand dessen `const` — wie kurzzeitig — innerhalb von `if (!isAuthority)`, warf
  // genau dieser Bogen "ReferenceError: qmPerson is not defined"; die Route lieferte
  // trotzdem 200 mit gültigem %PDF-Kopf, weil doc.pipe(res) schon lief. Nur der
  // Abschluss %%EOF zeigt, dass der Renderer durchgelaufen ist. Mit QM greift der
  // Kurzschluss und der Fehler bleibt unsichtbar — deshalb dieser eigene Fall.
  const noQmDept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'Ohne QM', regulation: 'Part-CAMO' })).payload;
  const noQmPlan = (await req('POST', `/api/departments/${noQmDept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  await req('POST', `/api/audit-plan-lines/${noQmPlan.authority_line_id}/checklist-items`,
    { compliance_check: 'Finding ohne QM', evaluation: 'L1' });
  const noQm = await pdf(`/api/audit-plan-lines/${noQmPlan.authority_line_id}/pdf`);
  check('ein Behördenbericht ohne QM in der Abteilung rendert vollständig',
    noQm.status === 200 && noQm.isPdf && noQm.tail.includes('%%EOF'),
    `${noQm.status}, ${noQm.bytes} bytes, endet auf ${noQm.tail.trim().slice(-6)}`);
  check('  → sein Unterzeichner bleibt leer, statt den Bogen zu sprengen',
    (noQm.calls[0] || {}).signer === undefined || !noQm.calls[0].signer,
    String((noQm.calls[0] || {}).signer));
  // Deckblatt + die vier Seiten des einen Findings (Findingdaten | CM-002 Seite 1 |
  // CM-002 Seite 2 | Maßnahmen). Ohne 5-Why-Satz bleibt es bei dessen leerem, von
  // Hand ausfüllbarem Formular, und die Maßnahmenseite steht auch ohne eine einzige
  // Maßnahme: sie trägt dann die beiden Überschriften samt "Keine Maßnahmen" — das
  // Finding hat ein CAP-Item, wir haben darauf nur noch nicht geantwortet.
  check('  → die Findingseiten stehen trotzdem',
    noQm.pages === 5, `${noQm.pages} Seite(n)`);

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
