const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');
const { getQmForDepartment } = require('../services/email');
const { createPdfDoc, addPdfFooter, authorityEvalLabel, authorityVisitLabel, departmentLeaderLabel } = require('./common');

function isAuthorityCap(cap) {
  return (cap.plan_type || 'AUDIT') === 'AUTHORITY';
}

// Beschriftung, kein Datenmodell — die Klartext-Zuordnung steht in pdf/common.js,
// weil das Audit-Line-PDF dieselbe Stufe druckt.
function capEvalLabel(cap) {
  if (isAuthorityCap(cap)) return authorityEvalLabel(cap.evaluation);
  return cap.evaluation || '';
}

// Die Behörde verlangt die Ursachenanalyse (CM-002) für JEDES Finding, auch für die
// Stufe "Bemerkung" — interne Pläne behalten die L1/L2-Grenze exakt. Die Regel steht
// hier einmal, weil sie außerhalb des Renderers entschieden werden muss: wer den
// 5-Why-Satz überhaupt lädt, entscheidet sie, nicht wer ihn druckt.
// Das CM-003 ist seit dem Formularschnitt KEIN Leser mehr — es hat für die
// Ursachenanalyse keine Zelle, `Root cause` ist eine Tabellenspalte und das CM-002
// ist mit pdf/five-why.js ein Blatt für sich. Der Behördenbogen
// (renderAuthorityFindingPages in pdf/audit.js) gated bewusst gar nicht, weil das
// Prädikat dort durchweg wahr wäre; bleibt als die eine Stelle, an der die Grenze
// geschrieben steht und die der Frontend-Gate der CAP-Ebene spiegelt.
function capHasFiveWhy(cap) {
  return isAuthorityCap(cap) || cap.evaluation === 'L1' || cap.evaluation === 'L2';
}

// Das CM-003 hat je Art EINE Formularzelle, in die die Behörde ihre Maßnahmen von
// Hand als "1. … 2. …" schreibt — also joint der Renderer die cap_action-Zeilen
// einer Gruppe genauso in diese eine Zelle. Die laufende Nummer ist wie überall
// abgeleitet (Index der gedruckten Liste, nie gespeichert) und bleibt dadurch
// lückenlos 1..n; eine Maßnahme ohne Text hat nichts zu drucken und zählt deshalb
// nicht mit. Existieren KEINE Zeilen, bleibt der alte Textwert aus
// cap_item.corrective_action / preventive_action der Fallback — Altbestand und
// interne Audits drucken damit unverändert. Ausschlaggebend ist die leere Liste,
// nicht der leere Text: sobald Zeilen da sind, sind sie die Maßnahmen des
// Findings, genau wie auf dem Finding-Screen.
function capActionCell(capActions, kind, fallback) {
  const rows = (capActions || []).filter(a => a.kind === kind);
  if (rows.length === 0) return fallback || '';
  return rows
    .map(a => (a.description || '').trim())
    .filter(Boolean)
    .map((desc, i) => `${i + 1}. ${desc}`)
    .join('\n');
}

// Liest immer den Rohwert 'C'/'NA'/'O'/'L1'/'L2'/'L3' — auch im Behördenaudit,
// wo nur die Zelle beschriftet wird. Deshalb braucht die Karte keine AUTHORITY-Einträge.
const EVAL_COLORS = {
  'C': '#d4edda', 'NA': '#e2e3e5', 'O': '#fff3cd',
  'L1': '#f8d7da', 'L2': '#f5c6cb', 'L3': '#f1b0b7'
};

// ── Satzspiegel des CM-003 ───────────────────────────────────────────────
// Querformat: elf Spalten mit je einer Zeile pro Finding passen auf kein Hochformat.
// Die Ränder sind 40 statt 50, weil addPdfFooter() seinen Strich bei 40 zieht und
// die Fußzeile sonst breiter stünde als das Formular darüber.
const FORM_LEFT = 40;
const FORM_RIGHT = 841.89 - 40;
// Oberkante der Fußzeile ist pageH - 30 = 565.28 — darüber bleibt Luft für den
// Strich, den addPdfFooter() zieht.
const FORM_BOTTOM = 545;

// Die erste Spalte trägt keinen Kopf: in ihr steht — um 90° gedreht wie auf dem
// echten Formular — die Findingbericht Nr., die Bezugsnummer der Behörde aus
// audit_checklist_item.document_ref. Die elf beschrifteten Spalten dahinter sind
// die Formularspalten des CM-003.
// `Level` ist auf das längste Wort geschnitten, das dort stehen kann — 'Bemerkung',
// der Klartext des Behördenberichts; eine Spalte, die es umbricht, zeigte ein
// gespeichertes Level in zwei Zeilen. Bezahlt wird es aus `Root cause`, das als
// Fließtext ohnehin umbricht.
const COL_W = [16, 22, 140, 48, 42, 60, 87, 105, 105, 34, 42, 60.89];
const COL_HEADERS = [
  '', 'No.', 'Finding description', 'Level', 'Deadline', 'Responsible person',
  'Root cause', 'Corrective action', 'Preventive action', 'Status', 'Date', 'Evidence',
];
const COL_X = COL_W.reduce((acc, w) => {
  acc.push(acc[acc.length - 1] + w);
  return acc;
}, [FORM_LEFT]).slice(0, COL_W.length);

// Beschriftetes Feld des Kopfblocks: Label fett, Wert dahinter. Zwei Aufrufe statt
// `continued: true`, damit ein umbrechender Wert nicht am Label klebt.
function drawHeadField(doc, { x, y, w, label, value }) {
  doc.font('Helvetica-Bold').fontSize(8);
  const labelW = doc.widthOfString(label) + 4;
  doc.text(label, x, y, { width: w, lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(value || '', x + labelW, y, { width: Math.max(20, w - labelW), height: 20 });
}

// Der dreispaltige Kopf des Formulars: links das Dokument samt Audit-Nr., in der
// Mitte der Besuch, rechts das Logo über der EASA-Genehmigungsnummer. Er ersetzt
// den Briefkopf des alten Renderers — dieselbe Angabe, aber in der Aufteilung, die
// das echte CM-003 trägt. Gibt das neue y zurück wie drawLetterhead() in pdf/audit.js.
function drawCapFormHead(doc, { line, plan, dept, logoRow, y }) {
  const headH = 66;
  const colX = [FORM_LEFT, FORM_LEFT + 300, FORM_LEFT + 560];
  const colW = [300, 260, FORM_RIGHT - (FORM_LEFT + 560)];

  doc.strokeColor('#000000').lineWidth(0.8);
  doc.rect(FORM_LEFT, y, FORM_RIGHT - FORM_LEFT, headH).stroke();
  for (let c = 1; c < colX.length; c++) {
    doc.moveTo(colX[c], y).lineTo(colX[c], y + headH).stroke();
  }
  // Die waagerechte Trennlinie des Papierformulars läuft auf halber Höhe und nur über
  // die ersten beiden Spalten: dort stehen je zwei Angaben übereinander (Dokumenttitel
  // über Audit No., Audit Subject über Audit Title), die Logospalte rechts trägt
  // dagegen EINE Angabe — Logo über der Genehmigungsnummer —, durch die ein Strich
  // mitten hindurchliefe. Sie endet deshalb an colX[2], der linken Kante dieser Spalte.
  doc.moveTo(FORM_LEFT, y + headH / 2).lineTo(colX[2], y + headH / 2).stroke();
  doc.fillColor('#000000');

  doc.font('Helvetica-Bold').fontSize(12)
    .text('Corrective Action Plan (CAP) Rev. 0', colX[0] + 6, y + 10, { width: colW[0] - 12 });
  drawHeadField(doc, {
    x: colX[0] + 6, y: y + 40, w: colW[0] - 12,
    label: 'Audit No.:', value: capAuditNoLine(line, plan),
  });

  // Der Besuch, den dieser CAP beantwortet. `audit_subject` ist die Spalte, die der
  // xlsx-Import unter genau diesem Namen füllt (imports/audit.js) — ein Bericht ohne
  // sie fällt auf die Besuchszeile zurück, dieselbe eine Beschriftung, die Kachel,
  // Berichtsebene und Behördenbogen tragen.
  drawHeadField(doc, {
    x: colX[1] + 6, y: y + 12, w: colW[1] - 12,
    label: 'Audit Subject:', value: line.audit_subject || capVisitLine(line, plan),
  });
  // Der Titel des Blattes. `audit_title` füllt allein der xlsx-Import interner Audits
  // (imports/audit.js), ein Behördenbericht hat kein Feld dafür — dieselbe Lage wie bei
  // `audit_subject` eine Zeile darüber, also derselbe Fallback statt einer dauerhaft
  // leeren Zelle neben zwei sprechenden Nachbarn.
  drawHeadField(doc, {
    x: colX[1] + 6, y: y + 40, w: colW[1] - 12,
    label: 'Audit Title:', value: line.audit_title || capTitleLine(line, plan, dept),
  });

  let ry = y + 8;
  if (logoRow && logoRow.logo) {
    try {
      doc.image(logoRow.logo, colX[2] + 6, ry, { fit: [colW[2] - 12, 28], align: 'right' });
      ry += 32;
    } catch { /* unlesbares Logo lässt den Kopf stehen */ }
  }
  doc.font('Helvetica-Bold').fontSize(8)
    .text(dept.easa_permission_number || '', colX[2] + 6, ry, { width: colW[2] - 12, align: 'right' });

  return y + headH + 12;
}

// Die Besuchszeile eines Berichts ohne eigenen `audit_subject`. Behördenpläne
// schreiben die Spalte nie (die Berichtsebene hat kein Feld dafür), interne Pläne
// führen ihren Themenbereich in `subject` — beide sollen im Kopf des Formulars den
// Besuch benennen und nicht leer bleiben.
function capVisitLine(line, plan) {
  if (line.subject) return line.subject;
  const isAuthority = plan && (plan.plan_type || 'AUDIT') === 'AUTHORITY';
  return isAuthority ? authorityVisitLabel(line) : '';
}

// Die Audit-Nr.-Zelle desselben Kopfes. Im Papierformular der Behörde steht dort nicht
// die nackte Nummer, sondern zweizeilig der Satz, der den Bericht benennt, den dieser
// CAP beantwortet — "Beanstandungsbericht LBA für Audit Nr. 1 vom 27.07.2026". Die
// Behörde ist `auditor_team` mit demselben 'LBA'-Fallback, den der Kopfblock der
// Berichtsebene, authorityLineDefaults() (services/audit-lines.js) und
// authorityFooterLabel() (routes/audit-plan-lines.js) tragen: das Feld ist editierbar,
// ein hart gedrucktes 'LBA' wäre genau die Stelle, an der Blatt und Schirm
// auseinanderlaufen. Das Berichtsdatum ist `audit_end_date` — die eine Spalte, die die
// Berichtsebene als Datum des Besuchs schreibt und aus der auch authorityVisitLabel()
// (pdf/common.js) seine Überschrift zieht, damit der Kopf keine zweite Datumsregel
// bekommt. OHNE Datum endet der Satz bei der Nummer, statt ein leeres `vom ` zu
// drucken — dieselbe sprechende Leere wie `Behördenaudit LBA` in der Fußzeile des
// Behördenbogens. Ein interner Plan behält die nackte Nummer: er hat keinen
// Beanstandungsbericht, den der Satz benennen könnte.
function capAuditNoLine(line, plan) {
  const isAuthority = plan && (plan.plan_type || 'AUDIT') === 'AUTHORITY';
  if (!isAuthority) return line.audit_no || '';
  const authority = line.auditor_team || 'LBA';
  const sentence = `Beanstandungsbericht ${authority} für Audit Nr. ${line.audit_no || ''}`.trim();
  const reportDate = formatDateDE(line.audit_end_date);
  return reportDate ? `${sentence} vom ${reportDate}` : sentence;
}

// Die Audit-Title-Zelle desselben Kopfes, im Idiom der beiden Helfer darüber. Auf einem
// Behördenbericht benennt das Papierformular dort nicht einen Themenbereich, sondern
// wofür das Blatt steht: die Beanstandungen, welche die Behörde in dieser Abteilung
// erhoben hat. Die Abteilung kommt aus `dept`, das der Renderer ohnehin bekommt — es
// wird nichts gespeichert und nichts nachgelesen. OHNE Abteilungsnamen bleibt die Zelle
// leer, statt einen halben Satz auf `… in der Abteilung` enden zu lassen — dieselbe
// sprechende Leere, die capAuditNoLine() eine Zeile darüber ohne Datum hält. Ein
// interner Plan bekommt den leeren String: sein Titel ist der importierte `audit_title`
// oder gar keiner, und ein Satz über Beanstandungen der Behörde wäre auf seinem Blatt
// schlicht falsch.
function capTitleLine(line, plan, dept) {
  const isAuthority = plan && (plan.plan_type || 'AUDIT') === 'AUTHORITY';
  if (!isAuthority) return '';
  const deptName = (dept && dept.name ? dept.name : '').trim();
  return deptName ? `Beanstandungen durch die Behörde in der Abteilung ${deptName}` : '';
}

// ── Unterschriftenblock ──────────────────────────────────────────────────
const SIG_HEADER_H = 18;
const SIG_ROW_H = 54;
const SIG_TABLE_H = SIG_HEADER_H + SIG_ROW_H;

function personName(person) {
  return person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : '';
}

// Die Fußzeilentabelle des Formulars: wer den CAP herausgibt und wer ihn zur
// Kenntnis bekommt. Der Unterzeichner ist der QM der Abteilung aus
// getQmForDepartment() — dieselbe Quelle, aus der auch das CM-002 und jede
// AC-Audit-Signatur ihren Unterzeichner ziehen, damit die Blätter eines Vorgangs
// nicht verschiedene Namen tragen. Die beiden Copy-to-Spalten kommen aus dem
// ohnehin geladenen `personsAll`, das für ihre Rollen keinen solchen Helfer hat;
// die Bezeichnung des Abteilungsleiters liefert departmentLeaderLabel()
// (pdf/common.js), damit Auditplan-, Audit-Line- und CAP-PDF sie gleich schreiben.
function drawCapSignatures(doc, { dept, company, personsAll, y }) {
  const persons = personsAll || [];
  const qm = getQmForDepartment(company.id, dept.id);
  const accPerson = persons.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);
  const alPerson = persons.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
  const alLabel = departmentLeaderLabel(dept);

  const headers = ['Name and position', 'Issued Date', 'Copy to: Accountable Manager', `Copy to: ${alLabel}`];
  const colW = (FORM_RIGHT - FORM_LEFT) / headers.length;

  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(FORM_LEFT, y, FORM_RIGHT - FORM_LEFT, SIG_HEADER_H).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < headers.length; c++) {
    doc.text(headers[c], FORM_LEFT + c * colW + 4, y + 5, { width: colW - 8, align: 'center', lineBreak: false });
  }
  doc.fillColor('#000000');
  y += SIG_HEADER_H;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(FORM_LEFT, y, FORM_RIGHT - FORM_LEFT, SIG_ROW_H).stroke();
  for (let c = 1; c < headers.length; c++) {
    doc.moveTo(FORM_LEFT + c * colW, y).lineTo(FORM_LEFT + c * colW, y + SIG_ROW_H).stroke();
  }

  // Das Unterschriftsbild steht in jeder der drei Namensspalten über dem Namen —
  // deshalb einmal hier statt dreimal in derselben Funktion. Der Guard auf
  // has_signature, das getPersonsByCompany ohnehin mitliefert, spart den BLOB-Read
  // für jeden Unterzeichner ohne hinterlegte Unterschrift; eine fehlende ist kein
  // Fehler, die Zelle bleibt dann mit dem Namen allein stehen.
  const drawSignatureImage = (person, colX) => {
    if (!person || !person.has_signature) return;
    const sigRow = stmts.getPersonSignature.get(person.id);
    if (!sigRow || !sigRow.signature) return;
    try {
      doc.image(sigRow.signature, colX + 4, y + 3, {
        fit: [colW - 8, SIG_ROW_H - 26], align: 'center', valign: 'center',
      });
    } catch { /* unlesbare Unterschrift lässt Name und Funktion stehen */ }
  };

  // Spalte 1: Unterschriftsbild über Name und Funktionsbezeichnung.
  drawSignatureImage(qm, FORM_LEFT);
  doc.font('Helvetica-Bold').fontSize(7)
    .text(personName(qm), FORM_LEFT + 4, y + SIG_ROW_H - 21, { width: colW - 8, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(6)
    .text('Compliance Monitoring Manager', FORM_LEFT + 4, y + SIG_ROW_H - 12, { width: colW - 8, align: 'center', lineBreak: false });

  // Spalte 2: Ausgabedatum. Es hat keine Spalte im Modell — eine eigene wäre die
  // Migration, die dieser Fall nicht wert ist —, und ein Ausgabedatum ist der Tag,
  // an dem das Blatt herausgeht: der Tag der Erstellung.
  doc.font('Helvetica').fontSize(9)
    .text(formatDateDE(new Date().toISOString()), FORM_LEFT + colW + 4, y + SIG_ROW_H / 2 - 6,
      { width: colW - 8, align: 'center', lineBreak: false });

  // Spalte 3 und 4: die beiden Empfänger in Kopie — Bild und Name wie in Spalte 1
  // und auf derselben Grundlinie, damit die vier Zellen bündig lesen. Eine
  // Funktionszeile braucht es hier nicht: die Rolle steht in der Kopfzeile der Spalte.
  doc.font('Helvetica').fontSize(7);
  [accPerson, alPerson].forEach((person, i) => {
    const colX = FORM_LEFT + (i + 2) * colW;
    drawSignatureImage(person, colX);
    doc.text(personName(person), colX + 4, y + SIG_ROW_H - 21,
      { width: colW - 8, align: 'center', lineBreak: false });
  });

  return y + SIG_ROW_H;
}

// ── CM-003, Corrective Action Plan ───────────────────────────────────────
// Ein Formular je Bericht: dreispaltiger Kopf, die elfspaltige Tabelle mit EINER
// Zeile pro Finding und darunter der Unterschriftenblock. `entries` sind die
// Findings dieses Berichts als { cap, capActions } — geladen wird nichts, das ist
// Sache des Aufrufers (capFormGroups()).
//
// Der 5-Why-Block und die Nachweisbilder des Vorgängers entfallen ersatzlos: das
// Formular hat für beides keine Zelle, `Root cause` ist eine Spalte und die
// Ursachenanalyse ist mit pdf/five-why.js ein Blatt für sich.
function renderCapFormPdf(doc, { line, plan, dept, company, logoRow, entries, personsAll }) {
  const rows = entries || [];
  let y = drawCapFormHead(doc, { line, plan, dept, logoRow, y: 40 });

  doc.font('Helvetica-Bold').fontSize(7);
  const headerH = Math.max(20, ...COL_HEADERS.map(
    (h, c) => doc.heightOfString(h, { width: COL_W[c] - 6 }) + 6));

  // Auf einer Folgeseite wiederholt sich der Tabellenkopf, nicht der Formularkopf —
  // dieselbe Regel wie in den Tabellen von pdf/audit.js: die Spalten müssen
  // beschriftet bleiben, der Besuch steht einmal auf dem Blatt, das ihn ausweist.
  const drawTableHeader = () => {
    doc.fontSize(7).font('Helvetica-Bold');
    doc.rect(FORM_LEFT, y, FORM_RIGHT - FORM_LEFT, headerH).fill('#2563eb');
    doc.fillColor('#ffffff');
    for (let c = 0; c < COL_HEADERS.length; c++) {
      doc.text(COL_HEADERS[c], COL_X[c] + 3, y + 3, { width: COL_W[c] - 6 });
    }
    doc.fillColor('#000000');
    y += headerH;
    doc.font('Helvetica').fontSize(7);
  };

  drawTableHeader();

  if (rows.length === 0) {
    doc.fontSize(8).font('Helvetica').fillColor('#888888').text('Keine Findings', FORM_LEFT, y + 4);
    doc.fillColor('#000000');
    y += 22;
  }

  for (let i = 0; i < rows.length; i++) {
    const { cap, capActions } = rows[i];

    // Die Zellen der elf beschrifteten Spalten, in ihrer Reihenfolge — COL_* führt
    // die gedrehte Bezugsnummer als Spalte 0 davor.
    const cells = [
      // Die vergebene Nr. des Findings (audit_checklist_item.sort_order), `?? 0` wie
      // in Findingliste und Audit-Line-PDF: eine ausdrückliche 0 ist eine Nummer,
      // nur ein fehlender Wert (Altbestand) fällt darauf zurück.
      String(cap.sort_order ?? 0),
      cap.compliance_check || '',
      capEvalLabel(cap),
      formatDateDE(cap.deadline),
      cap.responsible_person || '',
      cap.root_cause || '',
      // Verantwortlicher und Erledigt-Datum einer einzelnen Maßnahme bleiben außen
      // vor — das Formular hat dafür keine Spalte; gedruckt wird der Verantwortliche
      // des CAP-Items.
      capActionCell(capActions, 'CORRECTIVE', cap.corrective_action),
      capActionCell(capActions, 'PREVENTIVE', cap.preventive_action),
      // Der Status ist abgeleitet und nie gespeichert — dieselbe completion_date-
      // Grenze, die capStatus() im Frontend zieht.
      cap.completion_date ? 'Closed' : 'Open',
      formatDateDE(cap.completion_date),
      cap.evidence || '',
    ];

    // Die gedrehte Bezugsnummer ist eine Zelle wie jede andere und bestimmt die
    // Zeilenhöhe mit: gedreht ist ihre Textbreite die Höhe, die sie braucht. Ohne
    // sie liefe eine kurze Zeile mit langer Nummer über den linken Rand hinaus oder
    // in die Nummer der Nachbarzeile.
    doc.font('Helvetica-Bold').fontSize(6);
    const refH = cap.document_ref ? doc.widthOfString(cap.document_ref) + 8 : 0;

    doc.font('Helvetica').fontSize(7);
    const rowH = Math.max(22, refH, ...cells.map(
      (t, c) => doc.heightOfString(t, { width: COL_W[c + 1] - 6 }) + 6));

    if (y + rowH > FORM_BOTTOM) {
      doc.addPage();
      y = 40;
      drawTableHeader();
    }

    if (i % 2 === 0) {
      doc.rect(FORM_LEFT, y, FORM_RIGHT - FORM_LEFT, rowH).fill('#f8f9fa');
      doc.fillColor('#000000');
    }

    // Die Farbe liest den Rohwert 'O'/'L1'/'L2'/'L3' — beschriftet wird nur die Zelle.
    const evalVal = (cap.evaluation || '').trim().toUpperCase();
    if (EVAL_COLORS[evalVal]) {
      doc.rect(COL_X[3], y, COL_W[3], rowH).fill(EVAL_COLORS[evalVal]);
      doc.fillColor('#000000');
    }

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(FORM_LEFT, y, FORM_RIGHT - FORM_LEFT, rowH).stroke();
    for (let c = 1; c < COL_X.length; c++) {
      doc.moveTo(COL_X[c], y).lineTo(COL_X[c], y + rowH).stroke();
    }

    // Die gedrehte Zahl der ersten Spalte: die Findingbericht Nr., unter der die
    // Behörde dieses Finding in IHREM Schreiben führt. Sie steht nur, wenn sie
    // gefüllt ist — sie ist kein Zustand, den jedes Finding hat.
    if (cap.document_ref) {
      const cx = COL_X[0] + COL_W[0] / 2;
      const cy = y + rowH / 2;
      doc.save();
      doc.rotate(-90, { origin: [cx, cy] });
      doc.font('Helvetica-Bold').fontSize(6)
        .text(cap.document_ref, cx - rowH / 2, cy - 3, { width: rowH, align: 'center', lineBreak: false });
      doc.restore();
    }

    doc.font('Helvetica').fontSize(7);
    cells.forEach((t, c) => doc.text(t, COL_X[c + 1] + 3, y + 3, { width: COL_W[c + 1] - 6 }));

    y += rowH;
  }

  // Der Unterschriftenblock steht als Fußzeilentabelle am unteren Rand des letzten
  // Blattes, nicht direkt unter der letzten Zeile: er zeichnet das Formular als
  // Ganzes und nicht das letzte Finding darin.
  if (y > FORM_BOTTOM - SIG_TABLE_H - 10) {
    doc.addPage();
  }
  return drawCapSignatures(doc, { dept, company, personsAll, y: FORM_BOTTOM - SIG_TABLE_H });
}

// ── Laden ────────────────────────────────────────────────────────────────
// Ein CM-003 ist das Formular EINES Berichts, eine Auswahl von CAP-Einträgen kann
// aber über mehrere Berichte streuen. Die Gruppierung steht deshalb genau hier —
// die drei Aufrufer (Einzelroute, Batch-Route, generateCapItemsPdfBuffer) spreizen
// ihr Ergebnis in denselben renderCapFormPdf()-Aufruf, statt die Ladeschritte
// dreimal auszuschreiben.
// Die Reihenfolge der Gruppen folgt dem ersten Auftreten in `ids`; innerhalb einer
// Gruppe zählt die vergebene Nr. des Findings, damit das Formular in derselben
// Folge liest wie die Findingliste.
function capFormGroups(ids) {
  const groups = [];
  const byLine = new Map();

  for (const id of ids || []) {
    const cap = stmts.getCapItem.get(id);
    if (!cap) continue;
    const checklistItem = stmts.getChecklistItem.get(cap.checklist_item_id);
    if (!checklistItem) continue;

    let group = byLine.get(checklistItem.audit_plan_line_id);
    if (!group) {
      const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
      if (!line) continue;
      const plan = stmts.getAuditPlan.get(line.audit_plan_id);
      if (!plan) continue;
      const dept = stmts.getDepartment.get(plan.department_id);
      if (!dept) continue;
      const company = stmts.getCompany.get(dept.company_id);
      if (!company) continue;
      group = {
        line, plan, dept, company,
        logoRow: stmts.getCompanyLogo.get(company.id),
        personsAll: stmts.getPersonsByCompany.all(company.id),
        entries: [],
      };
      byLine.set(line.id, group);
      groups.push(group);
    }

    group.entries.push({ cap, capActions: stmts.getCapActionsByCapItem.all(cap.id) });
  }

  for (const group of groups) {
    group.entries.sort((a, b) => (a.cap.sort_order ?? 0) - (b.cap.sort_order ?? 0));
  }
  return groups;
}

function generateCapItemsPdfBuffer(ids) {
  return new Promise((resolve, reject) => {
    if (!ids || ids.length === 0) return reject(new Error('No IDs provided'));
    const groups = capFormGroups(ids);
    if (groups.length === 0) {
      return reject(Object.assign(new Error('Keine CAP-Einträge gefunden'), { statusCode: 404 }));
    }

    const doc = createPdfDoc({ landscape: true, margin: FORM_LEFT });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);

    groups.forEach((group, idx) => {
      if (idx > 0) doc.addPage();
      renderCapFormPdf(doc, group);
    });

    const last = groups[groups.length - 1];
    addPdfFooter(doc);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), dept: last.dept, company: last.company }));
    doc.end();
  });
}

module.exports = { renderCapFormPdf, capFormGroups, generateCapItemsPdfBuffer, capHasFiveWhy };
