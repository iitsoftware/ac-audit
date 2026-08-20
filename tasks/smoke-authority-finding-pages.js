// Smoke test für die Seitenaufteilung je Finding im Behördenaudit-PDF
// (renderAuthorityFindingPages() in pdf/audit.js).
//
// Geprüft wird genau die Regel: je Finding vier Seiten — Findingdaten (mit
// Briefkopf) | CM-002 Seite 1 | CM-002 Seite 2 | Maßnahmentabellen —, jeder Block
// auf einer frischen Seite. Der gesetzte Seitenschnitt des Formulars bleibt dabei
// heil — Why 1–3 (PRIMARY_CAUSE_STEPS = 3 in pdf/five-why.js) auf CM-002 Seite 1,
// Why 4–5 samt Final Root Cause Statement und Unterzeichnerzeile auf CM-002
// Seite 2. Hinter dem Datenblock beginnend passten nur Why 1+2 auf die erste
// Formularseite, Why 3 rutschte allein auf eine fast leere und der harte
// newPage() schob Why 4/5 noch eine weiter.
//
// Anders als seine beiden Nachbarn bootet dieser Test keinen Server: die Regel
// wohnt im Renderer, geladen wird nichts dafür. Gerendert wird deshalb direkt in
// ein PDFKit-Dokument, dessen addPage()/text() gespiegelt werden — im fertigen PDF
// ist der Text komprimiert und nicht mehr zu lesen, geprüft wird also, was
// wirklich auf welcher Seite gezeichnet wird.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
process.env.DATA_DIR = DATA_DIR;

const { createPdfDoc } = require('../pdf/common');
const { renderAuditLinePdf } = require('../pdf/audit');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `  — ${detail}`}`);
};

// ── Ein Behördenbericht mit zwei Findings: eines mit Level (und damit CAP-Item,
//    5-Why und Maßnahmen), eines ohne. ──
const line = {
  id: 'line-1', subject: '', auditor_team: 'LBA', authority_auditor: 'Frau Muster',
  auditee: 'Herr QM', audit_end_date: '2026-03-04', location: 'Berlin',
};
const plan = { id: 'plan-1', plan_type: 'AUTHORITY', year: 2026, revision: 0 };
const dept = { id: 'dept-1', name: 'CAMO', company_id: 'c-1' };
const company = { id: 'c-1', name: 'Muster GmbH' };

const checklistItems = [
  {
    id: 'ci-1', sort_order: 1, compliance_check: 'Beschreibung des ersten Findings',
    document_ref: 'LBA-2026-1', regulation_ref: 'M.A.706', evaluation: 'L1',
  },
  {
    id: 'ci-2', sort_order: 3, compliance_check: 'Zweites Finding ohne Level',
    document_ref: '', regulation_ref: '', evaluation: '',
  },
];

const caps = {
  'ci-1': {
    cap: {
      id: 'cap-1', audit_no: 'A-2026-1', responsible_person: 'Herr QM', completion_date: null,
      compliance_check: 'Beschreibung des ersten Findings', regulation_ref: 'M.A.706',
      corrective_action: '', preventive_action: '',
    },
    fiveWhy: {
      why1: 'Auswirkung: …', why2: 'Direkte Ursache: …', why3: 'Tiefere Ursache: …',
      why4: 'Organisationsmangel: …', why5: 'Systemmangel: …',
      root_cause: 'Grundursache', updated_at: '2026-03-05',
    },
    capActions: [
      { kind: 'CORRECTIVE', sort_order: 0, description: 'Behebung A', responsible_person: 'X', target_date: '2026-04-01', completion_date: null },
      { kind: 'PREVENTIVE', sort_order: 0, description: 'Prävention B', responsible_person: 'Y', target_date: '2026-05-01', completion_date: null },
    ],
  },
};

const doc = createPdfDoc({ margin: 50 });
doc.on('data', () => {});

let page = 1;
const perPage = { 1: [] };
const realAddPage = doc.addPage.bind(doc);
doc.addPage = (...args) => { page += 1; perPage[page] = []; return realAddPage(...args); };
const realText = doc.text.bind(doc);
doc.text = (t, ...rest) => { perPage[page].push(String(t)); return realText(t, ...rest); };

renderAuditLinePdf(doc, {
  line, plan, dept, company, logoRow: null, checklistItems, personsAll: [],
  caps, deadlines: { 'ci-1': '2026-04-30' }, signer: { first_name: 'Qua', last_name: 'Manager' },
});
doc.end();

const on = (p, needle) => (perPage[p] || []).some(t => t.includes(needle));
const pageOf = needle => Object.keys(perPage).map(Number).find(p => on(p, needle));

// Die Übersichtstabelle steht auf dem Deckblatt und listet jede Beschreibung
// ebenfalls — gesucht wird deshalb die Überschrift der Findingseite.
const p = pageOf('Finding 1');

check('die Findingdaten stehen auf einer eigenen Seite',
  p !== undefined && on(p, 'Beschreibung des ersten Findings') && on(p, 'Findingbericht Nr.'), `Seite ${p}`);
check('auf der Findingseite steht noch kein CM-002', !on(p, 'DEFINE THE PROBLEM'));
check('das CM-002 beginnt auf der Folgeseite', on(p + 1, 'DEFINE THE PROBLEM'));
check('Why 1–3 stehen auf CM-002 Seite 1',
  ['1. Why is it happening?', '2. Why is that?', '3. Why is that?'].every(s => on(p + 1, s)));
check('Why 4–5 stehen auf CM-002 Seite 2',
  ['4. Why is that?', '5. Why is that?'].every(s => on(p + 2, s)));
check('Statement und Unterzeichnerzeile stehen auf CM-002 Seite 2',
  on(p + 2, 'FINAL ROOT CAUSE STATEMENT') && on(p + 2, 'Compliance Monitoring Manager'));
// Die Maßnahmen dürfen nicht unter der Unterschriftenzeile des Formulars kleben:
// eine Tabelle auf demselben Blatt läse sich als ein weiterer Abschnitt des
// unterschriebenen CM-002 statt als unsere Antwort auf das Finding.
check('die Maßnahmen stehen auf einer eigenen Seite hinter dem Formular',
  ['Behebungsmaßnahmen', 'Präventivmaßnahmen'].every(s => pageOf(s) === p + 3));
check('auf der Maßnahmenseite steht keine Unterzeichnerzeile mehr',
  !on(p + 3, 'FINAL ROOT CAUSE STATEMENT') && !on(p + 3, 'Compliance Monitoring Manager'));
// Der Briefkopf stand hier nicht, solange das CM-002 auf demselben Blatt begann und
// ihn selbst zog. Seit die beiden getrennte Seiten haben, wäre die Findingdatenseite
// sonst die einzige Seite des Bogens ohne Absender.
check('die Findingdatenseite trägt den Briefkopf',
  on(p, 'Muster GmbH') && on(p, 'CAMO'));

// Ein Finding ohne Level hat kein CAP-Item — seine Seite bleibt der Datenblock.
const p2 = pageOf('Finding 3');
check('ein Finding ohne Level bekommt eine Seite ohne CM-002',
  p2 !== undefined && on(p2, 'Zweites Finding ohne Level') && !on(p2, 'DEFINE THE PROBLEM'), `Seite ${p2}`);
check('das zweite Finding ist das letzte Blatt des Bogens', p2 === page, `${p2} von ${page}`);

fs.rmSync(DATA_DIR, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
