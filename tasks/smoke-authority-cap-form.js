// Smoke test für das CM-003 am Schluss des Behördenaudit-Bogens
// (renderAuthorityCapForm() in pdf/audit.js).
//
// Geprüft wird die Regel: die Einzelroute eines Behördenberichts hängt hinter
// Summary und Legend GENAU EIN CM-003 an, mit einer Zeile je Finding, das ein
// CAP-Item hat — als Querformat-Seite im laufenden Hochformat-Dokument, ohne
// zweites Dokument und ohne Merge. Interne Pläne bekommen nichts davon.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich VOR dem Laden der
// Routen einen Spy auf renderCapFormPdf: pdf/audit.js destrukturiert die Funktion
// beim Require, ein späteres Patchen käme zu spät. Der Spy ruft den echten Renderer
// auf, damit ein Zeichenfehler nicht unbemerkt bleibt — im fertigen PDF ist der Text
// komprimiert und nicht mehr zu lesen, geprüft wird deshalb, was wirklich im Aufruf
// steht. Das Querformat dagegen steht unkomprimiert als /MediaBox im Dokument.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8401;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const pdfCap = require('../pdf/cap');
const realCapForm = pdfCap.renderCapFormPdf;
let capFormCalls = [];
pdfCap.renderCapFormPdf = (doc, args) => {
  capFormCalls.push(args);
  return realCapForm(doc, args);
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

// A4 quer ist 841.89 × 595.28, hochkant 595.28 × 841.89 — die MediaBox jeder Seite
// steht unkomprimiert im Dokument und ist damit die einzige Stelle, an der sich das
// Format des fertigen PDFs von außen ablesen lässt.
const PORTRAIT_BOX = '/MediaBox [0 0 595.28 841.89]';
const LANDSCAPE_BOX = '/MediaBox [0 0 841.89 595.28]';
const countOf = (text, needle) => text.split(needle).length - 1;

const pdf = async (url) => {
  capFormCalls = [];
  const res = await fetch(BASE + url, { headers: { Cookie: cookie }, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  // Ein Wurf mitten im Renderer liefert trotzdem 200 mit gültigem %PDF-Kopf —
  // doc.pipe(res) läuft, bevor gezeichnet wird. Erst %%EOF zeigt den Abschluss.
  const text = buf.toString('latin1');
  return {
    status: res.status,
    isPdf: buf.slice(0, 4).toString() === '%PDF',
    complete: text.slice(-40).includes('%%EOF'),
    bytes: buf.length,
    portraitPages: countOf(text, PORTRAIT_BOX),
    landscapePages: countOf(text, LANDSCAPE_BOX),
    calls: capFormCalls,
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
  await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'ACCOUNTABLE', first_name: 'Arne', last_name: 'Achtsam', email: 'am@example.org' });

  // ── Behördenbericht mit drei Findings: zwei mit Level, eines ohne ──
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const lineId = plan.authority_line_id;
  const line = (await req('GET', `/api/audit-plan-lines/${lineId}`)).payload;
  await req('PUT', `/api/audit-plan-lines/${lineId}`, { ...line, audit_end_date: '2026-03-12' });

  const f1 = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Werkzeugkontrolle unvollständig', document_ref: 'LBA-2026-01',
      regulation_ref: 'M.A.605', evaluation: 'L2', cap_deadline: '2026-05-01' })).payload;
  const f2 = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Schulungsnachweis fehlt', document_ref: 'LBA-2026-02',
      regulation_ref: 'M.A.706', evaluation: 'O' })).payload;
  const f3 = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Hinweis ohne Level' })).payload;

  // Finding 2 löschen und neu anlegen: die vergebene Nr. behält ihre Lücke, und
  // genau die muss das Formular drucken — ein LBA-Schreiben verweist darauf.
  await req('DELETE', `/api/checklist-items/${f2.id}`);
  const f2b = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { compliance_check: 'Schulungsnachweis fehlt', document_ref: 'LBA-2026-02',
      regulation_ref: 'M.A.706', evaluation: 'O' })).payload;

  // Zwei Maßnahmen an Finding 1 — das Formular joint sie als "1. … 2. …".
  const caps = (await req('GET', `/api/audit-plans/${plan.id}/cap-items`)).payload.items;
  const cap1 = caps.find(c => c.checklist_item_id === f1.id);
  await req('POST', `/api/cap-items/${cap1.id}/actions`, { kind: 'CORRECTIVE', description: 'Werkzeug erfasst' });
  await req('POST', `/api/cap-items/${cap1.id}/actions`, { kind: 'CORRECTIVE', description: 'Kontrolle terminiert' });

  const sheet = await pdf(`/api/audit-plan-lines/${lineId}/pdf`);
  check('Bogen eines Behördenberichts rendert vollständig',
    sheet.status === 200 && sheet.isPdf && sheet.complete, `${sheet.status}, ${sheet.bytes} bytes`);
  check('genau EIN CM-003 für den ganzen Bogen',
    sheet.calls.length === 1, `${sheet.calls.length} Aufruf(e)`);

  const call = sheet.calls[0] || {};
  const entries = call.entries || [];
  check('  → eine Zeile je Finding MIT Level, das Finding ohne Level hat keine',
    entries.length === 2, `${entries.length} Zeile(n)`);
  // Angelegt wurden 0, 1, 2; die 1 ist gelöscht, die Neuanlage zählt serverseitig
  // bei max+1 = 3 weiter, und die 2 gehört dem Finding ohne Level. Das Formular
  // druckt also 0 und 3 — die Lücke bleibt stehen, genau darauf verweist die Behörde.
  check('  → die Nr. ist die VERGEBENE sort_order des Findings samt ihrer Lücke',
    entries.map(e => e.cap.sort_order).join(',') === '0,3',
    entries.map(e => e.cap.sort_order).join(','));
  check('  → die Findingbericht Nr. (document_ref) reist mit',
    entries.map(e => e.cap.document_ref).join(',') === 'LBA-2026-01,LBA-2026-02',
    entries.map(e => e.cap.document_ref).join(','));
  check('  → plan_type liegt an, sonst druckte die Stufe "O" statt "Bemerkung"',
    entries.every(e => e.cap.plan_type === 'AUTHORITY'),
    entries.map(e => e.cap.plan_type).join(','));
  check('  → die Maßnahmen des Findings reisen als cap_action-Zeilen mit',
    (entries[0].capActions || []).length === 2, `${(entries[0].capActions || []).length}`);
  check('  → personsAll ist durchgereicht (Unterschriftenblock schlägt darin nach)',
    Array.isArray(call.personsAll) && call.personsAll.length === 2,
    `${(call.personsAll || []).length} Person(en)`);
  check('  → Bericht, Plan, Abteilung, Firma sind die des Besuchs',
    call.line && call.line.id === lineId && call.plan.id === plan.id
      && call.dept.id === dept.id && call.company.id === company.id);

  // Deckblatt + 2 Findings à 3 Seiten + 1 Finding ohne Level à 1 Seite = 8 hochkant,
  // dazu das eine Querformat-Blatt des CM-003 am Schluss.
  check('das CM-003 liegt quer, der Rest des Bogens hochkant',
    sheet.landscapePages === 1 && sheet.portraitPages === 8,
    `${sheet.portraitPages} hoch / ${sheet.landscapePages} quer`);

  // ── Interner Auditplan: kein CM-003, kein Querformat ──
  const intPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`, { year: 2026 })).payload;
  const intLine = (await req('POST', `/api/audit-plans/${intPlan.id}/lines`,
    { subject: 'Themenbereich Technik' })).payload;
  await req('POST', `/api/audit-plan-lines/${intLine.id}/checklist-items`,
    { section: 'THEORETICAL', compliance_check: 'Interner Prüfpunkt', evaluation: 'L1' });

  const internal = await pdf(`/api/audit-plan-lines/${intLine.id}/pdf`);
  check('ein interner Auditplan bekommt kein CM-003 und bleibt hochkant',
    internal.complete && internal.calls.length === 0 && internal.landscapePages === 0,
    `${internal.calls.length} Aufruf(e), ${internal.landscapePages} quer`);

  // ── Batch-Route: das Querformat darf nicht auf die nächste Zeile abfärben ──
  const batch = await pdf(`/api/audit-plan-lines/pdf?ids=${lineId},${intLine.id}`);
  check('in der Batch-Route beginnt der interne Bericht hinter dem Querformat wieder hochkant',
    batch.complete && batch.calls.length === 1 && batch.landscapePages === 1
      && batch.portraitPages === internal.portraitPages + 8,
    `${batch.portraitPages} hoch / ${batch.landscapePages} quer`);

  // ── Ein Formular, das nicht auf ein Blatt passt ──
  // Die Seiten, die renderCapFormPdf() selbst nachlegt, kommen aus einem blanken
  // doc.addPage() und damit aus den Dokument-Optionen: ohne das Umstellen läge die
  // Fortsetzung des Querformat-Formulars wieder hochkant.
  const bigPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const longText = 'Die Dokumentation der wiederkehrenden Prüfung ist unvollständig. '.repeat(12);
  for (let i = 0; i < 8; i++) {
    await req('POST', `/api/audit-plan-lines/${bigPlan.authority_line_id}/checklist-items`,
      { compliance_check: `${i + 1}. ${longText}`, evaluation: 'L2' });
  }
  const big = await pdf(`/api/audit-plan-lines/${bigPlan.authority_line_id}/pdf`);
  // Hochkant sind die drei Seiten je Finding plus das Deckblatt, das bei acht langen
  // Zeilen selbst über die Übersichtstabelle hinaus auf ein zweites Blatt läuft —
  // gezählt wird deshalb "mindestens", die Aussage des Falls ist das Querformat.
  check('ein Formular über mehrere Blätter bleibt auf jedem davon quer',
    big.complete && big.landscapePages > 1 && big.portraitPages >= 1 + 8 * 3,
    `${big.portraitPages} hoch / ${big.landscapePages} quer`);

  // ── Behördenbericht ohne Findings: das Formular des Berichts bleibt ──
  const emptyPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const empty = await pdf(`/api/audit-plan-lines/${emptyPlan.authority_line_id}/pdf`);
  check('ein Bericht ohne Findings druckt das leere Formular statt gar keins',
    empty.complete && empty.calls.length === 1 && (empty.calls[0].entries || []).length === 0
      && empty.landscapePages === 1,
    `${empty.calls.length} Aufruf(e), ${empty.landscapePages} quer`);

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
