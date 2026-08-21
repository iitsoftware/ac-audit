// Smoke test für das CM-003-Formular (renderCapFormPdf() + capFormGroups() in
// pdf/cap.js).
//
// Geprüft wird genau die Regel: EIN Formular je Bericht im Querformat — der
// dreispaltige Kopf, die elfspaltige Tabelle mit einer Zeile je Finding, die
// gedrehte Findingbericht Nr. daneben und der vierspaltige Unterschriftenblock als
// Fußzeilentabelle. Dazu die Gruppierung: eine Mehrfachauswahl über zwei Berichte
// ergibt zwei Formulare, nicht ein gemischtes.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich vor dem Laden der
// Routen einen Spy auf renderCapFormPdf: die Routen destrukturieren die Funktion
// beim Require, ein späteres Patchen käme zu spät. Der Spy ruft den echten Renderer
// auf und spiegelt zusätzlich doc.text() — im fertigen PDF ist der Text komprimiert
// und nicht mehr zu lesen, geprüft wird also, was wirklich gezeichnet wird.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8401;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const pdfCap = require('../pdf/cap');
const realRender = pdfCap.renderCapFormPdf;
let renderCalls = [];
pdfCap.renderCapFormPdf = (doc, args) => {
  const call = {
    args, texts: [], images: [],
    pageW: doc.page.width, pageH: doc.page.height,
    pagesAtStart: doc.bufferedPageRange().count,
  };
  const realText = doc.text.bind(doc);
  doc.text = (txt, ...rest) => {
    call.texts.push(String(txt));
    return realText(txt, ...rest);
  };
  // Die Unterschriftsbilder sind das einzige, was der Unterschriftenblock zeichnet
  // statt zu schreiben — ohne diesen Spy bliebe eine leere Zelle vom vollen Kasten
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

// Der Guard auf has_signature soll den BLOB-Read für einen Unterzeichner ohne
// hinterlegte Unterschrift sparen — das ist am Statement zu sehen, nicht am Blatt.
const { db, stmts } = require('../db');
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
  return {
    status: res.status,
    isPdf: buf.slice(0, 4).toString() === '%PDF',
    ok: res.status === 200 && buf.slice(0, 4).toString() === '%PDF'
      && buf.toString('latin1').slice(-40).includes('%%EOF'),
    bytes: buf.length,
    calls: renderCalls,
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
    { name: 'CAMO', regulation: 'Part-CAMO', easa_permission_number: 'DE.MG.4711' })).payload;
  const qmPerson = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', department_id: dept.id, first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org' })).payload;
  const accPerson = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'ACCOUNTABLE', first_name: 'Achim', last_name: 'Manager' })).payload;
  // Der Abteilungsleiter bleibt bewusst OHNE Unterschrift: seine Zelle muss mit dem
  // Namen stehen bleiben, und sein fehlendes Bild darf keinen BLOB-Read kosten.
  const alPerson = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'ABTEILUNGSLEITER', department_id: dept.id, first_name: 'Lena', last_name: 'Leiter' })).payload;
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await req('PUT', `/api/persons/${qmPerson.id}/signature`, { signature: PNG_1PX });
  await req('PUT', `/api/persons/${accPerson.id}/signature`, { signature: PNG_1PX });

  // ── Ein Behördenbericht mit zwei Findings ──
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const lineId = plan.authority_line_id;
  const line = (await req('GET', `/api/audit-plan-lines/${lineId}`)).payload;
  // audit_no wird serverseitig vergeben und von PUT nicht geschrieben — dieselbe
  // Nummer muss im Kopf des Formulars stehen.
  const auditNo = line.audit_no;
  // Die Behörde ist ein editierbares Feld — ein abweichender Wert muss im Satz der
  // Audit-Nr.-Zelle stehen, sonst wäre der 'LBA'-Fallback hart gedruckt.
  await req('PUT', `/api/audit-plan-lines/${lineId}`,
    { ...line, auditor_team: 'LBA Braunschweig', audit_end_date: '2026-03-12' });

  const first = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Werkzeugkontrolle unvollständig', document_ref: 'LBA-2026-1',
      regulation_ref: 'M.A.706', evaluation: 'L2', cap_deadline: '2026-05-01' })).payload;
  const second = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Schulungsnachweis fehlt', document_ref: '',
      regulation_ref: 'M.A.706(f)', evaluation: 'O' })).payload;

  const caps = (await req('GET', `/api/audit-plans/${plan.id}/cap-items`)).payload.items;
  const capOf = itemId => caps.find(c => c.checklist_item_id === itemId);
  const capA = capOf(first.id);
  const capB = capOf(second.id);

  // Finding 1 wird erledigt und bekommt zwei Behebungs- und eine Präventivmaßnahme.
  await req('PUT', `/api/cap-items/${capA.id}`, {
    ...capA, responsible_person: 'Herr Technik', root_cause: 'Kein Prüfintervall hinterlegt',
    completion_date: '2026-04-20', evidence: 'Prüfprotokoll 12/2026',
  });
  await req('POST', `/api/cap-items/${capA.id}/actions`, { kind: 'CORRECTIVE', description: 'Werkzeuge erfasst' });
  await req('POST', `/api/cap-items/${capA.id}/actions`, { kind: 'CORRECTIVE', description: 'Fehlteile beschafft' });
  await req('POST', `/api/cap-items/${capA.id}/actions`, { kind: 'PREVENTIVE', description: 'Jährliche Inventur' });
  // Finding 2 bleibt Altbestand: nur die beiden Textspalten, keine cap_action-Zeilen.
  await req('PUT', `/api/cap-items/${capB.id}`, { ...capB, corrective_action: 'Schulung nachgeholt' });

  // ── 1. Einzelroute ──
  const single = await pdf(`/api/cap-items/${capA.id}/pdf`);
  check('Einzel-CAP rendert ein vollständiges PDF', single.ok, `${single.status}, ${single.bytes} bytes`);
  check('  → genau EIN Formular', single.calls.length === 1, `${single.calls.length}`);

  const one = single.calls[0] || { args: {}, texts: [] };
  check('  → Querformat: die elf Formularspalten brauchen die lange Kante',
    one.pageW > one.pageH && Math.round(one.pageW) === 842,
    `${Math.round(one.pageW)}×${Math.round(one.pageH)}`);
  check('  → genau EINE Tabellenzeile (ein Finding)',
    (one.args.entries || []).length === 1, `${(one.args.entries || []).length}`);

  const has = (call, txt) => call.texts.includes(txt);
  check('  → Kopf links: Formularname + Audit No.',
    has(one, 'Corrective Action Plan (CAP) Rev. 0') && has(one, 'Audit No.:'));
  // Die Zelle trägt beim Behördenbericht den Satz des Papierformulars, nicht die
  // nackte Nummer — mit der eingetragenen Behörde und dem Datum des Besuchs.
  check('  → Audit-Nr.-Zelle benennt den Beanstandungsbericht',
    has(one, `Beanstandungsbericht LBA Braunschweig für Audit Nr. ${auditNo} vom 12.03.2026`),
    one.texts.find(t => t.startsWith('Beanstandungsbericht')) || '—');
  check('  → Kopf Mitte: Audit Subject (Besuchszeile) + Audit Title',
    has(one, 'Audit Subject:') && has(one, 'Audit Title:')
    && has(one, 'Behördenaudit 12.03.2026'), one.texts.slice(0, 8).join(' | '));
  // Die Titelzelle trägt beim Behördenbericht den Satz mit der Abteilung, statt leer
  // zu bleiben — `audit_title` füllt nur der xlsx-Import interner Audits.
  check('  → Audit-Title-Zelle benennt die Abteilung',
    has(one, `Beanstandungen durch die Behörde in der Abteilung ${dept.name}`),
    one.texts.find(t => t.startsWith('Beanstandungen durch')) || '—');
  check('  → Kopf rechts: EASA-Genehmigungsnummer', has(one, 'DE.MG.4711'));

  const HEADERS = ['No.', 'Finding description', 'Level', 'Deadline', 'Responsible person',
    'Root cause', 'Corrective action', 'Preventive action', 'Status', 'Date', 'Evidence'];
  check('  → elf Formularspalten in ihrer Reihenfolge',
    HEADERS.every(h => has(one, h))
    && HEADERS.map(h => one.texts.indexOf(h)).every((v, i, a) => i === 0 || a[i - 1] < v),
    HEADERS.filter(h => !has(one, h)).join(', '));

  check('  → gedrehte Findingbericht Nr. neben No.', has(one, 'LBA-2026-1'));
  check('  → Level als Klartext des Behördenberichts', has(one, 'Level 2'));
  check('  → Maßnahmen als "1. … 2. …" in EINER Zelle',
    has(one, '1. Werkzeuge erfasst\n2. Fehlteile beschafft') && has(one, '1. Jährliche Inventur'));
  check('  → Status abgeleitet aus completion_date', has(one, 'Closed') && has(one, '20.04.2026'));
  check('  → Evidence als Textspalte', has(one, 'Prüfprotokoll 12/2026'));

  check('  → Unterschriftenblock vierspaltig mit QM, Issued Date und beiden Copy-to',
    has(one, 'Name and position') && has(one, 'Issued Date')
    && has(one, 'Copy to: Accountable Manager') && has(one, 'Copy to: Leiter CAMO')
    && has(one, 'Petra Prüfer') && has(one, 'Compliance Monitoring Manager')
    && has(one, 'Achim Manager') && has(one, 'Lena Leiter'));

  // Alle drei Namensspalten zeichnen ihr Unterschriftsbild, nicht nur der QM: die
  // Firma dieses Tests hat kein Logo, jedes gezeichnete Bild ist also eine
  // Unterschrift. Geprüft wird an der Spalte, in der es landet.
  const SIG_COL_W = (841.89 - 80) / 4;
  const inSigCol = (img, c) => Math.abs(img.x - (40 + c * SIG_COL_W + 4)) < 1;
  check('  → Unterschriftsbild in Spalte 1 (QM) UND Spalte 3 (Accountable Manager)',
    one.images.length === 2
    && one.images.some(i => inSigCol(i, 0)) && one.images.some(i => inSigCol(i, 2)),
    one.images.map(i => Math.round(i.x)).join(', ') || 'kein Bild');
  // Eine fehlende Unterschrift ist kein Fehler — die Zelle bleibt mit dem Namen
  // stehen (oben geprüft) — und sie kostet dank has_signature keinen BLOB-Read.
  check('  → der Abteilungsleiter ohne Unterschrift bekommt kein Bild',
    !one.images.some(i => inSigCol(i, 3)));
  check('  → nur die Unterzeichner MIT Unterschrift kosten einen BLOB-Read',
    sigReads.length === 2 && sigReads.includes(qmPerson.id)
    && sigReads.includes(accPerson.id) && !sigReads.includes(alPerson.id),
    `${sigReads.length} Read(s)`);

  check('  → kein 5-Why-Block und keine Nachweisbilder mehr',
    !one.texts.some(t => /5-Why|Nachweise|Warum\?/.test(t)));

  // ── 2. Batch-Route über beide Findings EINES Berichts: ein Formular, zwei Zeilen ──
  const batch = await pdf(`/api/cap-items/pdf?ids=${capA.id},${capB.id}`);
  check('Mehrfachauswahl eines Berichts rendert EIN Formular mit zwei Zeilen',
    batch.ok && batch.calls.length === 1 && (batch.calls[0].args.entries || []).length === 2,
    `${batch.calls.length} Formular(e)`);
  check('  → Zeilen in der Reihenfolge der vergebenen Nr.',
    (batch.calls[0].args.entries || []).map(e => e.cap.sort_order).join(',') === '0,1',
    (batch.calls[0].args.entries || []).map(e => e.cap.sort_order).join(','));
  check('  → Altbestand ohne cap_action-Zeilen druckt den Textfallback',
    batch.calls[0].texts.includes('Schulung nachgeholt'));

  // ── 3. Zwei Berichte in einer Auswahl: zwei Formulare, nicht ein gemischtes ──
  const plan2 = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const other = (await req('POST', `/api/audit-plan-lines/${plan2.authority_line_id}/checklist-items`,
    { compliance_check: 'Zweiter Besuch', evaluation: 'L1' })).payload;
  const capC = (await req('GET', `/api/audit-plans/${plan2.id}/cap-items`)).payload.items
    .find(c => c.checklist_item_id === other.id);

  const across = await pdf(`/api/cap-items/pdf?ids=${capA.id},${capC.id}`);
  check('eine Auswahl über zwei Berichte ergibt zwei Formulare',
    across.ok && across.calls.length === 2, `${across.calls.length}`);
  check('  → jedes Formular trägt nur die Findings SEINES Berichts',
    across.calls.every(c => (c.args.entries || []).length === 1
      && c.args.entries[0].cap.checklist_item_id !== undefined));
  // plan2 hat kein Datum und keine geänderte Behörde: der Satz endet bei der Nummer
  // (kein leeres `vom `) und trägt den 'LBA'-Fallback der Vorbelegung.
  const line2 = (await req('GET', `/api/audit-plan-lines/${plan2.authority_line_id}`)).payload;
  const noDate = across.calls[1] || { texts: [] };
  check('  → ohne Berichtsdatum endet der Satz bei der Nummer',
    noDate.texts.includes(`Beanstandungsbericht LBA für Audit Nr. ${line2.audit_no}`),
    noDate.texts.find(t => t.startsWith('Beanstandungsbericht')) || '—');

  // ── 3b. Ein Bericht MIT eigenem Titel: die Titelzelle ist ein Fallback, keine
  // Ersetzung — ein gefülltes `audit_title` (der Weg des xlsx-Imports) gewinnt.
  const titled = (await req('POST', `/api/audit-plans/${plan2.id}/lines`,
    { audit_title: 'Nachaudit Werkstatt' })).payload;
  const titledItem = (await req('POST', `/api/audit-plan-lines/${titled.id}/checklist-items`,
    { compliance_check: 'Dritter Besuch', evaluation: 'L1' })).payload;
  const titledCap = (await req('GET', `/api/audit-plans/${plan2.id}/cap-items`)).payload.items
    .find(c => c.checklist_item_id === titledItem.id);

  const withTitle = await pdf(`/api/cap-items/${titledCap.id}/pdf`);
  check('ein gesetzter audit_title gewinnt gegen den Satz der Titelzelle',
    withTitle.ok && withTitle.calls[0].texts.includes('Nachaudit Werkstatt')
    && !withTitle.calls[0].texts.some(t => t.startsWith('Beanstandungen durch')),
    (withTitle.calls[0] || { texts: [] }).texts.find(t => t.startsWith('Beanstandungen durch'))
    || 'Titel gewinnt');

  // ── 3c. Ohne Abteilungsnamen bleibt die Zelle leer, statt den Satz auf
  // `… in der Abteilung` enden zu lassen — dieselbe sprechende Leere, die
  // capAuditNoLine() eine Zeile darüber ohne Datum hält. Der Name wird direkt in der
  // Datenbank geleert: POST/PUT /api/departments verlangen ihn, über HTTP ist der
  // Zustand also nicht zu erreichen, aus einer Altbestandszeile sehr wohl.
  const deptName = dept.name;
  db.prepare('UPDATE department SET name = ? WHERE id = ?').run('', dept.id);
  const noDept = await pdf(`/api/cap-items/${capC.id}/pdf`);
  db.prepare('UPDATE department SET name = ? WHERE id = ?').run(deptName, dept.id);
  check('ohne Abteilungsnamen bleibt die Titelzelle leer',
    noDept.ok && !noDept.calls[0].texts.some(t => t.startsWith('Beanstandungen durch')),
    (noDept.calls[0] || { texts: [] }).texts.find(t => t.startsWith('Beanstandungen durch'))
    || 'leer');

  // ── 4. Interner Auditplan druckt dasselbe Formular mit der internen Kurzform ──
  const intPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  const intLine = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`,
    { subject: 'Themenbereich Technik' })).payload;
  const intItem = (await req('POST', `/api/audit-plan-lines/${intLine.id}/checklist-items`,
    { section: 'PRACTICAL', sort_order: 0, compliance_check: 'Interner Prüfpunkt', evaluation: 'L1' })).payload;
  const intCap = (await req('GET', `/api/audit-plans/${intPlan.id}/cap-items`)).payload.items
    .find(c => c.checklist_item_id === intItem.id);

  const internal = await pdf(`/api/cap-items/${intCap.id}/pdf`);
  check('interner Plan rendert dasselbe Formular', internal.ok && internal.calls.length === 1);
  check('  → Level bleibt die interne Kurzform',
    internal.calls[0].texts.includes('L1') && !internal.calls[0].texts.includes('Level 1'));
  check('  → Audit Subject fällt auf den Themenbereich zurück',
    internal.calls[0].texts.includes('Themenbereich Technik'));
  check('  → Audit-Nr.-Zelle bleibt die nackte Nummer',
    internal.calls[0].texts.includes(String(intLine.audit_no))
    && !internal.calls[0].texts.some(t => t.startsWith('Beanstandungsbericht')));
  check('  → Audit-Title-Zelle bleibt ohne den Behördensatz',
    !internal.calls[0].texts.some(t => t.startsWith('Beanstandungen durch')),
    internal.calls[0].texts.find(t => t.startsWith('Beanstandungen durch')) || '—');

  // ── 5. Der Versandweg fährt denselben Renderer ──
  // generateCapItemsPdfBuffer() ist die Quelle des E-Mail-Anhangs; ohne SMTP ist die
  // Route nicht zu fahren, der Puffer selbst schon. Der Spy sieht diesen Aufruf
  // nicht — er ruft den Renderer modulintern und nicht über den Export —, geprüft
  // wird deshalb der Puffer samt Abschluss und der Kontext, den der Versand für
  // Betreff und Log-Zeile braucht.
  const mail = await pdfCap.generateCapItemsPdfBuffer([capA.id, capB.id]);
  check('der E-Mail-Anhang rendert dasselbe Formular',
    mail.buffer.slice(0, 4).toString() === '%PDF'
    && mail.buffer.toString('latin1').slice(-40).includes('%%EOF')
    && mail.dept.id === dept.id && mail.company.id === company.id,
    `${mail.buffer.length} bytes`);
  await pdfCap.generateCapItemsPdfBuffer(['nope']).then(
    () => check('  → eine Auswahl ohne Treffer wirft statt einen leeren Anhang zu liefern', false),
    e => check('  → eine Auswahl ohne Treffer wirft statt einen leeren Anhang zu liefern',
      e.statusCode === 404, e.message));

  // ── 6. Eine Auswahl ohne existierende IDs ist 404 statt eines PDFs ohne Zeilen ──
  const gone = await fetch(`${BASE}/api/cap-items/pdf?ids=nope`, { headers: { Cookie: cookie } });
  check('eine Auswahl, von der nichts übrig ist, liefert 404', gone.status === 404, String(gone.status));

  console.log(failures === 0 ? '\nAlle Prüfungen bestanden.' : `\n${failures} Prüfung(en) fehlgeschlagen.`);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(1);
});
