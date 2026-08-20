const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');
const { createPdfDoc, authorityEvalLabel } = require('./common');
// Die Findingseiten drucken das vollständige CM-002 mit — zyklenfrei, weil
// five-why.js nur ./common und db zieht und nichts aus dieser Datei.
const { renderFiveWhyPdf } = require('./five-why');

// ── Internal: render audit plan PDF content ─────────────────
function _renderAuditPlanPdf(doc, { plan, dept, company, logoRow, lines, isClosed, titleLabel }) {
  let headerY = 50;
  if (logoRow && logoRow.logo) {
    try {
      doc.image(logoRow.logo, 50, headerY, { height: 50 });
      headerY += 60;
    } catch { /* logo unreadable */ }
  }
  doc.fontSize(16).font('Helvetica-Bold').text(company.name, 50, headerY);
  headerY += 25;

  doc.fontSize(10).font('Helvetica');
  let subLine = dept.name;
  if (dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, 50, headerY);
  headerY += 40;

  const label = titleLabel || (isClosed ? 'Durchgeführte Audits' : 'Geplante Audits');
  const title = `Auditplan ${plan.year} - ${label}`;
  doc.fontSize(14).font('Helvetica-Bold').text(title, 50, headerY);
  headerY += 20;
  doc.fontSize(10).font('Helvetica').text(`Rev. ${plan.revision || 0}`, 50, headerY);
  headerY += 20;

  const tableTop = headerY;
  const pageW = 595.28;
  const marginRight = 50;
  const tableRight = pageW - marginRight;

  let findingMap = {};
  if (isClosed) {
    const findings = stmts.getFindingDetailsByPlan.all(plan.id);
    for (const f of findings) findingMap[f.audit_plan_line_id] = f;
  }

  let colX, colW, colHeaders;
  if (isClosed) {
    colX = [50, 75, 190, 290, 360, 415];
    colW = [25, 115, 100, 70, 55, 80];
    colHeaders = ['Nr.', 'Thema', 'Bezug', 'Geplant', 'Auditiert', 'Findings'];
  } else {
    colX = [50, 80, 250, 370];
    colW = [30, 170, 120, 125];
    colHeaders = ['Nr.', 'Thema', 'Bezug', 'Geplant'];
  }

  doc.fontSize(9).font('Helvetica-Bold');
  doc.rect(50, tableTop, tableRight - 50, 18).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < colHeaders.length; c++) {
    doc.text(colHeaders[c], colX[c] + 4, tableTop + 4, { width: colW[c], align: 'left' });
  }
  doc.fillColor('#000000');

  let y = tableTop + 18;
  doc.font('Helvetica').fontSize(8);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const subjectH = doc.heightOfString(line.subject || '', { width: colW[1] - 8 });
    const regsH = doc.heightOfString(line.regulations || '', { width: colW[2] - 8 });
    const plannedH = doc.heightOfString(line.planned_window || '', { width: colW[3] - 8 });
    const rowH = Math.max(16, subjectH + 8, regsH + 8, plannedH + 8);

    if (y + rowH > 760) {
      doc.addPage();
      y = 50;
    }

    if (i % 2 === 0) {
      doc.rect(50, y, tableRight - 50, rowH).fill('#f0f4ff');
      doc.fillColor('#000000');
    }

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(50, y, tableRight - 50, rowH).stroke();

    doc.text(line.audit_no || String(i + 1), colX[0] + 4, y + 4, { width: colW[0] - 8 });
    doc.text(line.subject || '', colX[1] + 4, y + 4, { width: colW[1] - 8 });
    doc.text(line.regulations || '', colX[2] + 4, y + 4, { width: colW[2] - 8 });
    doc.text(line.planned_window || '', colX[3] + 4, y + 4, { width: colW[3] - 8 });
    if (isClosed) {
      doc.text(formatDateDE(line.audit_end_date), colX[4] + 4, y + 4, { width: colW[4] - 8 });
      const fd = findingMap[line.id];
      if (fd) {
        const parts = [];
        if (fd.obs) parts.push(`O:${fd.obs}`);
        if (fd.l1) parts.push(`L1:${fd.l1}`);
        if (fd.l2) parts.push(`L2:${fd.l2}`);
        if (fd.l3) parts.push(`L3:${fd.l3}`);
        doc.text(parts.join(' '), colX[5] + 4, y + 4, { width: colW[5] - 8 });
      }
    }

    y += rowH;
  }

  if (isClosed) {
    y += 10;
    if (y + 60 > 760) { doc.addPage(); y = 50; }
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    doc.text('Legende:', 50, y);
    y += 12;
    doc.fontSize(7).font('Helvetica').fillColor('#444444');
    const legendItems = [
      'O - Beobachtung, kein Finding, lediglich Empfehlung zur Verbesserung',
      'Level 1 - Nichtkonformit\u00e4t, das Finding wird innerhalb von 5 Arbeitstagen behoben',
      'Level 2 - Nichtkonformit\u00e4t, Behebung des Findings innerhalb von 60 Arbeitstagen',
      'Level 3 - Nicht nur eine Empfehlung, muss umgesetzt oder angepasst werden (bei oder mit der n\u00e4chsten Revision)',
    ];
    for (const item of legendItems) {
      doc.text(item, 58, y, { width: tableRight - 58 });
      y += doc.heightOfString(item, { width: tableRight - 58 }) + 2;
    }
    doc.fillColor('#000000');
  }

  if (plan.plan_type === 'AUTHORITY') {
    const pages = doc.bufferedPageRange();
    for (let p = pages.start; p < pages.start + pages.count; p++) {
      doc.switchToPage(p);
      const footerY = 770;
      doc.strokeColor('#000000').lineWidth(0.5);
      doc.moveTo(50, footerY).lineTo(pageW - 50, footerY).stroke();
      doc.fontSize(7).fillColor('#000000').font('Helvetica');
      doc.text('Erstellt mit ac-audit', 50, footerY + 4, { lineBreak: false });
      const pageLabel = `Seite ${p - pages.start + 1}/${pages.count}`;
      doc.text(pageLabel, 50, footerY + 4, { width: pageW - 100, align: 'right', lineBreak: false });
    }
    return;
  }

  const personsAll = stmts.getPersonsByCompany.all(company.id);
  const qmPerson = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);
  const alPerson = personsAll.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
  const accPerson = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);

  const deptText = `${dept.name} ${dept.regulation || ''}`.toLowerCase();
  let alLabel = 'Abteilungsleiter';
  if (deptText.includes('145')) alLabel = 'Maintenance Manager';
  else if (deptText.includes('camo') || deptText.includes('part-m')) alLabel = 'Leiter CAMO';
  else if (deptText.includes('ato') || deptText.includes('flugschule') || deptText.includes('training')) alLabel = 'Head of Training';
  else if (deptText.includes('flug') || deptText.includes('ops') || deptText.includes('ore') || deptText.includes('965')) alLabel = 'Flugbetriebsleiter';

  const sigRowH = 50;
  const sigHeaderH = 28;
  const sigTableH = sigHeaderH + sigRowH;
  if (y + sigTableH + 20 > 760) {
    doc.addPage();
    y = 50;
  }
  y += 16;

  const sigCols = 5;
  const sigColW = (tableRight - 50) / sigCols;

  const sigCol0Label = isClosed ? 'Erledigt' : 'Freigabe';
  const sigHeaders = [sigCol0Label, 'Weitergabe LBA', 'Compliance Monitoring Manager', alLabel, 'Accountable Manager'];

  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(50, y, tableRight - 50, sigHeaderH).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < sigCols; c++) {
    doc.text(sigHeaders[c], 50 + c * sigColW + 4, y + 4, { width: sigColW - 8, align: 'center' });
  }
  doc.fillColor('#000000');
  y += sigHeaderH;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(50, y, tableRight - 50, sigRowH).stroke();
  for (let c = 1; c < sigCols; c++) {
    doc.moveTo(50 + c * sigColW, y).lineTo(50 + c * sigColW, y + sigRowH).stroke();
  }

  doc.font('Helvetica').fontSize(9);

  if (isClosed) {
    let maxDate = '';
    for (const l of lines) {
      if (l.audit_end_date && l.audit_end_date > maxDate) maxDate = l.audit_end_date;
    }
    doc.text(formatDateDE(maxDate), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });
  } else {
    doc.text(formatDateDE(plan.approved_at), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });
  }

  const lbaDate = isClosed ? plan.submitted_at : plan.submitted_planned_at;
  doc.text(formatDateDE(lbaDate), 50 + sigColW + 4, y + 4, { width: sigColW - 8, align: 'center' });

  const sigPersons = [qmPerson, alPerson, accPerson];
  for (let c = 0; c < 3; c++) {
    const person = sigPersons[c];
    const cx = 50 + (c + 2) * sigColW;
    if (person) {
      const sigRow = stmts.getPersonSignature.get(person.id);
      if (sigRow && sigRow.signature) {
        try {
          doc.image(sigRow.signature, cx + 4, y + 2, { fit: [sigColW - 8, sigRowH - 14], align: 'center', valign: 'center' });
        } catch { /* unreadable */ }
      }
      const name = `${person.first_name} ${person.last_name}`.trim();
      if (name) {
        doc.fontSize(6).text(name, cx + 4, y + sigRowH - 10, { width: sigColW - 8, align: 'center' });
      }
    }
  }

  y += sigRowH;

  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    const footerY = 770;
    doc.strokeColor('#000000').lineWidth(0.5);
    doc.moveTo(50, footerY).lineTo(tableRight, footerY).stroke();
    doc.fontSize(7).fillColor('#000000').font('Helvetica');
    doc.text('Erstellt mit ac-audit', 50, footerY + 4, { lineBreak: false });
    const pageLabel = `Seite ${p - pages.start + 1}/${pages.count}`;
    doc.text(pageLabel, 50, footerY + 4, { width: tableRight - 50, align: 'right', lineBreak: false });
  }
}

// Liest immer den Rohwert 'C'/'NA'/'O'/'L1'/'L2'/'L3' — auch im Behördenaudit,
// wo nur die Zelle beschriftet wird. Deshalb braucht die Karte keine AUTHORITY-Einträge.
const EVAL_COLORS = {
  'C': '#d4edda', 'NA': '#e2e3e5', 'O': '#fff3cd',
  'L1': '#f8d7da', 'L2': '#f5c6cb', 'L3': '#f1b0b7'
};

// Die zwei Maßnahmenarten eines Findings samt ihrer Überschrift und der Spalte,
// aus der ein CAP-Item ohne cap_action-Zeilen gedruckt wird. Zweite Fundstelle
// derselben Liste: CAP_ACTION_GROUPS in public/companies.js beschriftet damit die
// beiden Tabellen des Finding-Screens — Schirm und Blatt zeigen dieselben Gruppen
// in derselben Folge, wer hier ein Wort ändert, ändert es dort mit.
const CAP_ACTION_GROUPS = [
  { kind: 'CORRECTIVE', label: 'Behebungsmaßnahmen', legacy: 'corrective_action' },
  { kind: 'PREVENTIVE', label: 'Präventivmaßnahmen', legacy: 'preventive_action' },
];

// Die Überschrift eines Behördenberichts — dieselbe Regel wie authorityName(date, '')
// im Frontend: ohne Datum sagt die Beschriftung genau das, statt eine Jahreszahl zu
// erfinden. Steht hier einmal, weil Deckblatt und Findingseiten denselben Besuch
// benennen müssen.
function authorityVisitLabel(line) {
  const visitDate = formatDateDE(line.audit_end_date);
  return visitDate ? `Behördenaudit ${visitDate}` : 'Behördenaudit (ohne Datum)';
}

// ── PDF Helper: dreigeteilte Checklistentabelle eines internen Audits ─────
// Gibt das neue y zurück. Unverändertes Verhalten — nur aus renderAuditLinePdf
// herausgezogen, damit die Behördenvariante als gleichrangige Schwester danebensteht.
function renderInternalSections(doc, { checklistItems, startY, tableRight }) {
  let y = startY;

  const sections = [
    { key: 'THEORETICAL', label: 'Theoretical / Documentation Verification' },
    { key: 'PRACTICAL', label: 'Practical Review' },
    { key: 'PROCEDURE', label: 'Procedure / MOE Review' },
  ];

  const clColX = [50, 70, 140, 290, 330, 400];
  const clColW = [20, 70, 150, 40, 70, 95.28];
  const clHeaders = ['Nr', 'Regulation Ref', 'Compliance Check', 'Eval', 'Auditor Comment', 'Document Ref'];

  for (const section of sections) {
    const items = checklistItems.filter(i => i.section === section.key);

    if (items.length === 0) {
      if (y + 34 > 740) { doc.addPage(); y = 50; }
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(section.label, 50, y);
      y += 16;
      doc.fontSize(8).font('Helvetica').fillColor('#888888').text('No items', 50, y);
      doc.fillColor('#000000');
      y += 18;
      continue;
    }

    doc.font('Helvetica').fontSize(7);
    const firstItem = items[0];
    const firstRegH = doc.heightOfString(firstItem.regulation_ref || '', { width: clColW[1] - 6 });
    const firstCompH = doc.heightOfString(firstItem.compliance_check || '', { width: clColW[2] - 6 });
    const firstCommH = doc.heightOfString(firstItem.auditor_comment || '', { width: clColW[4] - 6 });
    const firstDocH = doc.heightOfString(firstItem.document_ref || '', { width: clColW[5] - 6 });
    const firstRowH = Math.max(14, firstRegH + 6, firstCompH + 6, firstCommH + 6, firstDocH + 6);
    if (y + 16 + 16 + firstRowH > 740) { doc.addPage(); y = 50; }

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(section.label, 50, y);
    y += 16;

    doc.fontSize(7).font('Helvetica-Bold');
    doc.rect(50, y, tableRight - 50, 16).fill('#2563eb');
    doc.fillColor('#ffffff');
    for (let c = 0; c < clHeaders.length; c++) {
      doc.text(clHeaders[c], clColX[c] + 3, y + 3, { width: clColW[c] - 6 });
    }
    doc.fillColor('#000000');
    y += 16;

    doc.font('Helvetica').fontSize(7);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Alle umbrechenden Spalten messen — Regulation Ref (70pt) und Document Ref
      // (95pt) brechen genauso um wie Compliance Check und Auditor Comment.
      // Muss identisch zur firstRowH-Abschätzung oben bleiben, sonst laufen
      // Seitenumbruch-Schätzung und gezeichnete Zeile auseinander.
      const regH = doc.heightOfString(item.regulation_ref || '', { width: clColW[1] - 6 });
      const compH = doc.heightOfString(item.compliance_check || '', { width: clColW[2] - 6 });
      const commH = doc.heightOfString(item.auditor_comment || '', { width: clColW[4] - 6 });
      const docH = doc.heightOfString(item.document_ref || '', { width: clColW[5] - 6 });
      const rowH = Math.max(14, regH + 6, compH + 6, commH + 6, docH + 6);

      if (y + rowH > 740) {
        doc.addPage();
        y = 50;
        doc.fontSize(7).font('Helvetica-Bold');
        doc.rect(50, y, tableRight - 50, 16).fill('#2563eb');
        doc.fillColor('#ffffff');
        for (let c = 0; c < clHeaders.length; c++) {
          doc.text(clHeaders[c], clColX[c] + 3, y + 3, { width: clColW[c] - 6 });
        }
        doc.fillColor('#000000');
        y += 16;
        doc.font('Helvetica').fontSize(7);
      }

      if (i % 2 === 0) {
        doc.rect(50, y, tableRight - 50, rowH).fill('#f8f9fa');
        doc.fillColor('#000000');
      }

      const evalVal = (item.evaluation || '').trim().toUpperCase();
      if (EVAL_COLORS[evalVal]) {
        doc.rect(clColX[3], y, clColW[3], rowH).fill(EVAL_COLORS[evalVal]);
        doc.fillColor('#000000');
      }

      doc.strokeColor('#d0d0d0').lineWidth(0.5);
      doc.rect(50, y, tableRight - 50, rowH).stroke();
      for (let c = 1; c < clColX.length; c++) {
        doc.moveTo(clColX[c], y).lineTo(clColX[c], y + rowH).stroke();
      }

      doc.text(String(i + 1), clColX[0] + 3, y + 3, { width: clColW[0] - 6 });
      doc.text(item.regulation_ref || '', clColX[1] + 3, y + 3, { width: clColW[1] - 6 });
      doc.text(item.compliance_check || '', clColX[2] + 3, y + 3, { width: clColW[2] - 6 });
      doc.text(item.evaluation || '', clColX[3] + 3, y + 3, { width: clColW[3] - 6 });
      doc.text(item.auditor_comment || '', clColX[4] + 3, y + 3, { width: clColW[4] - 6 });
      doc.text(item.document_ref || '', clColX[5] + 3, y + 3, { width: clColW[5] - 6 });

      y += rowH;
    }
    y += 12;
  }

  return y;
}

// ── PDF Helper: flache Findings-Tabelle eines Behördenaudits ─────────
// Ein Behördenaudit kennt keine Sektionen: die Behörde übergibt eine flache
// Findings-Liste in der Spaltenfolge ihres Berichts. Spiegelt renderFindingsSection()
// in public/companies.js — die Nr. ist wie dort die VERGEBENE laufende Nummer
// (audit_checklist_item.sort_order) und nicht der Zeilenindex: ein LBA-Schreiben
// verweist auf die Nummer, die im Bericht steht, also muss dasselbe Finding auf
// dem Papier dieselbe Nummer tragen wie auf dem Schirm — samt der Lücke, die nach
// dem Löschen eines vorangehenden Findings stehen bleibt.
// Gibt das neue y zurück, wie es die Sektionsschleife interner Pläne hinterlässt.
function renderAuthorityFindings(doc, { checklistItems, deadlines = {}, startY, tableRight }) {
  let y = startY;

  const colX = [50, 82, 297, 369, 451, 499];
  const colW = [32, 215, 72, 82, 48, 46.28];
  const headers = ['Nr.', 'Beschreibung', 'Findingbericht Nr.', 'Referenz Paragraph', 'Level', 'Frist'];
  // Die Spaltenfolge ist die der Findingliste: die Beschreibung steht zweite,
  // gleich hinter der Nr., die beiden Bezugsnummern dahinter. Ein Finding trägt
  // damit auf dem Blatt, das zur Behörde zurückgeht, dieselbe Folge wie in der
  // App — die Nummer, unter der die Behörde es führt, darf nicht auf jedem der
  // beiden an anderer Stelle stehen.
  // Der Satzspiegel ist dabei nur neu getilet, nicht neu gerechnet: die
  // Beschreibung behält ihre 215pt, die Findingbericht Nr. ihre 72pt aus dem,
  // was Nr. (nur Zahlen), Level ("Bemerkung", 35.9pt bei 7pt) und Frist (ein
  // Datum, 35pt) über ihrem Inhalt zu breit waren — die Tabelle endet weiter bei
  // 545.28 und tilt ohne Lücke. Jede Überschrift passt weiter in eine Zeile —
  // die breiteste ("Referenz Paragraph", 65.8pt bei 7pt fett) bleibt unter den
  // 82pt ihrer Spalte, "Findingbericht Nr." (59.8pt) unter den 72pt ihrer —
  // also dieselben 16pt Kopfhöhe wie in der internen Tabelle.
  const headerH = 16;

  // Die Frist wird am CAP-Item gepflegt, gehört in der Findings-Liste aber in die
  // Zeile. Nachgeschlagen hat sie der Aufrufer und übergibt sie als
  // checklist_item_id → deadline — eine Abfrage je Audit-Zeile statt eines
  // CAP-Reads je Finding, und der Renderer liest nichts selbst.
  //
  // In der Reihenfolge der Kopfzeile, ohne die Nr., die aus sort_order kommt und
  // eigens gesetzt wird. Die Findingbericht Nr. ist die Bezugsnummer der Behörde
  // (document_ref) und steht neben der eigenen, vergebenen Nr. — die eine zählt
  // diesen Bericht durch, die andere zitiert den der Behörde.
  const cellText = item => [
    item.compliance_check || '',
    item.document_ref || '',
    item.regulation_ref || '',
    authorityEvalLabel(item.evaluation),
    formatDateDE(deadlines[item.id]),
  ];

  // Setzt Schrift selbst, weil heightOfString() sonst mit der Schrift des Aufrufers misst.
  const rowHeight = item => {
    doc.font('Helvetica').fontSize(7);
    const heights = cellText(item).map((t, c) => doc.heightOfString(t, { width: colW[c + 1] - 6 }) + 6);
    return Math.max(14, ...heights);
  };

  const drawHeader = () => {
    doc.fontSize(7).font('Helvetica-Bold');
    doc.rect(50, y, tableRight - 50, headerH).fill('#2563eb');
    doc.fillColor('#ffffff');
    for (let c = 0; c < headers.length; c++) {
      doc.text(headers[c], colX[c] + 3, y + 3, { width: colW[c] - 6 });
    }
    doc.fillColor('#000000');
    y += headerH;
    doc.font('Helvetica').fontSize(7);
  };

  if (checklistItems.length === 0) {
    if (y + 34 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Findings', 50, y);
    y += 16;
    doc.fontSize(8).font('Helvetica').fillColor('#888888').text('Keine Findings', 50, y);
    doc.fillColor('#000000');
    return y + 18;
  }

  // Überschrift, Tabellenkopf und erste Zeile bleiben zusammen auf einer Seite.
  if (y + 16 + headerH + rowHeight(checklistItems[0]) > 740) { doc.addPage(); y = 50; }

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Findings', 50, y);
  y += 16;
  drawHeader();

  for (let i = 0; i < checklistItems.length; i++) {
    const item = checklistItems[i];
    const rowH = rowHeight(item);

    if (y + rowH > 740) {
      doc.addPage();
      y = 50;
      drawHeader();
    }

    if (i % 2 === 0) {
      doc.rect(50, y, tableRight - 50, rowH).fill('#f8f9fa');
      doc.fillColor('#000000');
    }

    // Die Farbe liest den Rohwert 'O'/'L1'/'L2' — beschriftet wird nur die Zelle.
    const evalVal = (item.evaluation || '').trim().toUpperCase();
    if (EVAL_COLORS[evalVal]) {
      doc.rect(colX[4], y, colW[4], rowH).fill(EVAL_COLORS[evalVal]);
      doc.fillColor('#000000');
    }

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(50, y, tableRight - 50, rowH).stroke();
    for (let c = 1; c < colX.length; c++) {
      doc.moveTo(colX[c], y).lineTo(colX[c], y + rowH).stroke();
    }

    // `?? 0` wie in der Findingliste: eine ausdrückliche 0 ist eine Nummer, nur
    // ein fehlender Wert (Altbestand) fällt darauf zurück.
    doc.text(String(item.sort_order ?? 0), colX[0] + 3, y + 3, { width: colW[0] - 6 });
    cellText(item).forEach((t, c) => doc.text(t, colX[c + 1] + 3, y + 3, { width: colW[c + 1] - 6 }));

    y += rowH;
  }

  return y + 12;
}

// ── PDF Helper: eine Seite je Finding eines Behördenaudits ──────────
// Die flache Tabelle von renderAuthorityFindings() bleibt das Inhaltsverzeichnis
// des Berichts, direkt hinter dem Kopfblock; hier bekommt jedes Finding sein
// eigenes Blatt mit allem, was an ihm hängt — Findingdaten, das vollständige
// zweiseitige CM-002 und die beiden Maßnahmentabellen. Die Kette Besuch → Finding
// → 5-Why/Maßnahmen, die der Finding-Screen zeigt, steht damit auch auf dem Papier,
// das zur Behörde zurückgeht.
//
// Geladen wird nichts — Hausregel wie in pdf/cap.js, das Laden gehört in die Route:
//   caps      checklist_item_id → { cap, fiveWhy, capActions }
//             (cap ist eine getCapItem-Zeile, die Ursache dafür, dass das CM-002
//             Audit-Nr., Referenz und Beschreibung im Kopf führen kann)
//   deadlines checklist_item_id → ISO-Datum, dieselbe Karte, aus der die
//             Übersichtstabelle ihre Frist zieht
// Fehlt `caps`, zeichnet der Renderer nichts und liefert null: ein Aufrufer ohne
// die neuen Felder bekommt exakt das Dokument von vorher.
function renderAuthorityFindingPages(doc, { line, checklistItems, caps, dept, company, logoRow, signer, deadlines }) {
  if (!caps || checklistItems.length === 0) return null;

  const tableRight = 595.28 - 50;
  const contentW = tableRight - 50;
  const capDeadlines = deadlines || {};
  const visitLabel = authorityVisitLabel(line);

  let y = 50;

  // Zwilling von drawInfoRow() in renderCapItemPdf (pdf/cap.js): dieselbe
  // Label/Wert-Optik, damit Findingseite und CM-003 denselben Datensatz nicht in
  // zwei Anmutungen zeigen. Die Funktion wohnt dort in einem Closure über dessen
  // `y`, ist also nicht zu importieren.
  function drawInfoRow(label, value, { evalHighlight, bold } = {}) {
    const labelW = 130;
    const valW = contentW - labelW;
    const textVal = value || '';
    doc.fontSize(8).font('Helvetica');
    const rowH = Math.max(16, doc.heightOfString(textVal, { width: valW - 8 }) + 6);
    if (y + rowH > 740) { doc.addPage(); y = 50; }

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(50, y, labelW, rowH).fill('#f0f4ff');
    doc.rect(50, y, labelW, rowH).stroke();
    // Die Farbe liest den Rohwert 'O'/'L1'/'L2'/'L3' wie in der Tabelle darüber —
    // beschriftet wird nur die Zelle.
    if (EVAL_COLORS[evalHighlight]) doc.rect(50 + labelW, y, valW, rowH).fill(EVAL_COLORS[evalHighlight]);
    doc.rect(50 + labelW, y, valW, rowH).stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').text(label, 54, y + 3, { width: labelW - 8 });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(textVal, 50 + labelW + 4, y + 3, { width: valW - 8 });
    y += rowH;
  }

  // Der Satzspiegel der Maßnahmentabelle tilt dieselben 50 → 545.28 wie die
  // Findingtabelle: Nr. druckt Zahlen, Zieldatum und Erledigt am je ein Datum
  // (35pt bei 7pt), der Verantwortliche einen Namen — der Rest gehört der Maßnahme.
  const actColX = [50, 82, 325.28, 425.28, 485.28];
  const actColW = [32, 243.28, 100, 60, 60];
  const actHeaders = ['Nr.', 'Maßnahme', 'Verantwortlich', 'Zieldatum', 'Erledigt am'];
  const actHeaderH = 16;

  function drawActionHeader() {
    doc.fontSize(7).font('Helvetica-Bold');
    doc.rect(50, y, tableRight - 50, actHeaderH).fill('#2563eb');
    doc.fillColor('#ffffff');
    for (let c = 0; c < actHeaders.length; c++) {
      doc.text(actHeaders[c], actColX[c] + 3, y + 3, { width: actColW[c] - 6 });
    }
    doc.fillColor('#000000');
    y += actHeaderH;
    doc.font('Helvetica').fontSize(7);
  }

  // Die gedruckten Zeilen einer Gruppe. Wie in capActionCell() (pdf/cap.js) zählt
  // eine Maßnahme ohne Beschreibung nicht mit — sie hat nichts zu drucken, und die
  // abgeleitete Nummer bliebe sonst nicht lückenlos. Ausschlaggebend ist auch hier
  // die leere Liste, nicht der leere Text: gibt es keine cap_action-Zeilen, ist der
  // alte Textwert des CAP-Items die eine Maßnahme dieser Art. Anders als das CM-003
  // joint diese Ansicht aber nicht zu "1. … 2. …", sondern druckt eine echte Zeile
  // je Maßnahme — dafür ist sie eine Tabelle und keine Formularzelle.
  function actionRows(entry, group) {
    const rows = (entry.capActions || [])
      .filter(a => a.kind === group.kind)
      .map(a => ({ ...a, description: (a.description || '').trim() }))
      .filter(a => a.description);
    if (rows.length > 0) return rows;
    // Der Altbestand kennt Verantwortlichen und Zieldatum je Maßnahme nicht — die
    // beiden hängen dort am CAP-Item und stehen bereits im Datenblock oben.
    const legacy = (entry.cap[group.legacy] || '').trim();
    return legacy ? [{ description: legacy }] : [];
  }

  function drawActionTable(label, rows) {
    // Überschrift, Tabellenkopf und erste Zeile bleiben zusammen auf einer Seite.
    if (y + 16 + actHeaderH + 14 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(label, 50, y);
    y += 16;

    if (rows.length === 0) {
      doc.fontSize(8).font('Helvetica').fillColor('#888888').text('Keine Maßnahmen', 50, y);
      doc.fillColor('#000000');
      y += 18 + 12;
      return;
    }

    drawActionHeader();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = [
        row.description,
        row.responsible_person || '',
        formatDateDE(row.target_date),
        formatDateDE(row.completion_date),
      ];
      doc.font('Helvetica').fontSize(7);
      const rowH = Math.max(14, ...cells.map((t, c) => doc.heightOfString(t, { width: actColW[c + 1] - 6 }) + 6));

      if (y + rowH > 740) { doc.addPage(); y = 50; drawActionHeader(); }

      if (i % 2 === 0) {
        doc.rect(50, y, tableRight - 50, rowH).fill('#f8f9fa');
        doc.fillColor('#000000');
      }

      doc.strokeColor('#d0d0d0').lineWidth(0.5);
      doc.rect(50, y, tableRight - 50, rowH).stroke();
      for (let c = 1; c < actColX.length; c++) {
        doc.moveTo(actColX[c], y).lineTo(actColX[c], y + rowH).stroke();
      }

      // Die laufende Nummer einer Maßnahme ist der Zeilenindex ihrer Gruppe und wird
      // nie gespeichert — sie darf sich beim Löschen einer Nachbarzeile schließen.
      // Ausdrücklich anders als die Nr. des Findings darüber, auf die ein
      // LBA-Schreiben verweist und die deshalb ihre Lücken behält.
      doc.text(String(i + 1), actColX[0] + 3, y + 3, { width: actColW[0] - 6 });
      cells.forEach((t, c) => doc.text(t, actColX[c + 1] + 3, y + 3, { width: actColW[c + 1] - 6 }));

      y += rowH;
    }
    y += 12;
  }

  for (const item of checklistItems) {
    doc.addPage();
    y = 50;

    const entry = caps[item.id];
    const cap = entry && entry.cap ? entry.cap : null;
    // Die vergebene Nummer aus sort_order, nicht der Zeilenindex — `?? 0` wie in der
    // Übersichtstabelle: eine ausdrückliche 0 ist eine Nummer, nur ein fehlender Wert
    // (Altbestand) fällt darauf zurück.
    const nr = String(item.sort_order ?? 0);

    // Briefkopf wie ihn renderFiveWhyPdf() auf seine Seiten zeichnet — Logo, Firma,
    // Abteilungszeile mit EASA-Nummer. Er stand hier nicht, solange das CM-002 ein
    // paar Zeilen darunter auf demselben Blatt begann und seinen Kopf dort selbst
    // zog; seit die beiden getrennte Seiten haben, treffen sie sich nicht mehr und
    // dies wäre sonst die einzige Seite des Bogens ohne Absender.
    if (logoRow && logoRow.logo) {
      try { doc.image(logoRow.logo, 50, y, { height: 45 }); y += 55; } catch { y += 10; }
    }
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(company.name, 50, y);
    y += 20;
    doc.fontSize(9).font('Helvetica');
    let subLine = dept.name;
    if (dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
    if (dept.regulation) subLine += `  |  ${dept.regulation}`;
    doc.text(subLine, 50, y);
    y += 25;

    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(`Finding ${nr}`, 50, y);
    y += 20;
    doc.fontSize(9).font('Helvetica').text(visitLabel, 50, y);
    y += 25;

    // Die Reihenfolge der ersten sechs Felder ist die Spaltenfolge der Findingliste
    // (Nr. | Beschreibung | Findingbericht Nr. | Referenz Paragraph | Level | Frist),
    // an die Liste, Stammdaten, Anlage-Dialog und Übersichtstabelle gebunden sind.
    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    drawInfoRow('Nr.', nr);
    drawInfoRow('Beschreibung', item.compliance_check);
    // Nur wenn gefüllt, wie im Kopfblock des CM-003: die Bezugsnummer der Behörde ist
    // kein Zustand, den jedes Finding hat, und stünde sonst als leere Zeile da.
    if (item.document_ref) drawInfoRow('Findingbericht Nr.', item.document_ref);
    drawInfoRow('Referenz Paragraph', item.regulation_ref);
    drawInfoRow('Level', authorityEvalLabel(item.evaluation), {
      evalHighlight: (item.evaluation || '').trim().toUpperCase(), bold: true,
    });
    drawInfoRow('Frist', formatDateDE(capDeadlines[item.id]));
    // Die beiden letzten Felder wohnen am CAP-Item — ohne Level gibt es keins, und
    // zwei leere Zeilen wären eine Angabe, die dieses Finding gar nicht kennt.
    if (cap) {
      drawInfoRow('Verantwortlicher', cap.responsible_person);
      drawInfoRow('Erledigt am', formatDateDE(cap.completion_date));
    }
    y += 15;

    // Ein Finding ohne Level hat kein cap_item und damit weder Ursachenanalyse noch
    // Maßnahmen — ein Zustand, kein Fehler: die Seite bleibt der Datenblock.
    if (!cap) continue;

    // Das CM-002 beginnt auf einer eigenen Seite. Sein Seitenschnitt ist gesetzt —
    // PRIMARY_CAUSE_STEPS = 3 (pdf/five-why.js) will Why 1–3 auf die erste und
    // Why 4–5 samt Statement und Unterzeichnerzeile auf die zweite Seite —, und
    // hinter dem Datenblock beginnend passten ab y ≈ 250 nur Why 1+2: Why 3 rutschte
    // allein auf eine fast leere Seite und der harte newPage() schöbe Why 4/5 noch
    // eine weiter. Je Finding gilt damit: Seite 1 Findingdaten, Seite 2 CM-002 Seite 1,
    // Seite 3 CM-002 Seite 2, Seite 4 die Maßnahmen. Es zeichnet seinen Kopf auf jeder
    // neuen Seite selbst; ein fehlender five_why-Datensatz ist dort kein Fehler,
    // sondern das leere, von Hand ausfüllbare Formular. Sein Rückgabe-y bleibt hier
    // ungenutzt, weil die Maßnahmen ohnehin auf einem frischen Blatt beginnen.
    doc.addPage();
    y = 50;
    renderFiveWhyPdf(doc, {
      cap, fiveWhy: entry.fiveWhy || null, department: dept, company, logoRow, signer, startY: y,
    });

    // Auch die Maßnahmen bekommen ihre eigene Seite: die Zeile Name / Position / Datum
    // schließt das CM-002 ab, und eine Tabelle darunter auf demselben Blatt läse sich
    // als ein weiterer Abschnitt des unterschriebenen Formulars statt als das, was sie
    // ist — unsere Antwort auf das Finding. Innerhalb der beiden Tabellen bleibt der
    // Umbruch dagegen gerechnet (drawActionTable), denn wie viele Blätter n Maßnahmen
    // brauchen, gibt kein Formular vor.
    doc.addPage();
    y = 50;
    for (const group of CAP_ACTION_GROUPS) drawActionTable(group.label, actionRows(entry, group));
  }

  return y;
}

// ── PDF Helper: Render single audit line into doc ────────────
// `caps`, `deadlines` und `signer` sind das Behörden-Beiwerk des Blatts und
// werden vom Aufrufer geladen (authorityPdfData() in routes/audit-plan-lines.js).
// Sie dürfen fehlen: ohne `caps` bleibt es beim Deckblatt samt Übersichtstabelle
// wie bisher, und `deadlines` ist die EINE Fristenkarte, aus der sowohl diese
// Übersicht als auch die Findingseiten dahinter ihre Frist ziehen — sonst liefe
// getCapDeadlinesByLine zweimal je Bogen. Interne Pläne brauchen keins der drei.
function renderAuditLinePdf(doc, { line, plan, dept, company, logoRow, checklistItems, personsAll, startY, caps, deadlines, signer }) {
  const pageW = 595.28;
  const tableRight = pageW - 50;

  // Ein Behördenplan liest denselben Datensatz als Bericht EINES Besuchs: Titel,
  // Kopfblock und Findingliste folgen dem Schirm. Interne Pläne drucken
  // unverändert 'Audit Checklist', die vollen Audit-Informationen und die drei
  // Sektionen.
  const isAuthority = (plan.plan_type || 'AUDIT') === 'AUTHORITY';

  let y = startY || 50;

  if (logoRow && logoRow.logo) {
    try {
      doc.image(logoRow.logo, 50, y, { height: 45 });
      y += 55;
    } catch { y += 10; }
  }

  doc.fontSize(14).font('Helvetica-Bold').text(company.name, 50, y);
  y += 20;
  doc.fontSize(9).font('Helvetica');
  let subLine = dept.name;
  if (dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, 50, y);
  y += 25;

  // Titel wie die Überschrift der Berichtsebene (authorityName() ohne Behörde,
  // die eine Zeile darunter ihr eigenes Feld hat): ohne Datum sagt die
  // Beschriftung genau das, statt eine Jahreszahl zu erfinden.
  const visitDate = formatDateDE(line.audit_end_date);
  const title = isAuthority ? authorityVisitLabel(line) : 'Audit Checklist';
  doc.fontSize(14).font('Helvetica-Bold').text(title, 50, y);
  y += 25;

  doc.fontSize(10).font('Helvetica-Bold').text('Audit Information', 50, y);
  y += 16;

  // Der Kopfblock eines Behördenberichts beschreibt den Besuch und nicht ein
  // Themenbereichs-Audit: dieselben fünf Zeilen, die renderLineDetail() im
  // Frontend zeichnet — die drei Rollen aus authorityLineDefaults() plus Datum
  // und Ort. Der Ort ist hier `location` und nicht `audit_location`, weil der
  // Kopfblock des Berichtsscreens genau diese Spalte schreibt.
  const infoItems = isAuthority ? [
    ['Behörde', line.auditor_team || 'LBA'],
    ['Auditor', line.authority_auditor || ''],
    ['Auditee', line.auditee || ''],
    ['Datum', visitDate],
    ['Ort', line.location || ''],
  ] : [
    ['Auditplan', plan.year || ''],
    ['Audit Nr.', line.audit_no || ''],
    ['Thema', line.subject || ''],
    ['Auditor Team', line.auditor_team || ''],
    ['Auditee', line.auditee || ''],
    ['Audit Start', formatDateDE(line.audit_start_date)],
    ['Audit End', formatDateDE(line.audit_end_date)],
    ['Location', line.audit_location || ''],
    ['Document Ref', line.document_ref || ''],
    ['Iss/Rev', line.document_iss_rev || ''],
    ['Rev Date', formatDateDE(line.document_rev_date)],
  ];

  doc.fontSize(8);
  const labelW = 100;
  const valW = tableRight - 50 - labelW;
  for (const [label, value] of infoItems) {
    doc.rect(50, y, labelW, 16).fill('#f0f4ff');
    doc.rect(50 + labelW, y, valW, 16).stroke();
    doc.rect(50, y, labelW, 16).stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').text(label, 54, y + 3, { width: labelW - 8 });
    doc.font('Helvetica').text(value, 50 + labelW + 4, y + 3, { width: valW - 8 });
    y += 16;
  }
  y += 15;

  // Ein Behördenaudit kennt keine Sektionen — dieselbe flache Findings-Tabelle
  // wie renderLineDetail() im UI. Interne Pläne drucken unverändert die drei Sektionen.
  y = isAuthority
    ? renderAuthorityFindings(doc, { checklistItems, deadlines, startY: y, tableRight })
    : renderInternalSections(doc, { checklistItems, startY: y, tableRight });

  if (y + 50 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Summary', 50, y);
  y += 16;

  const countEval = value => checklistItems.filter(i => (i.evaluation || '').toUpperCase() === value).length;

  // Die Zählzeile eines Behördenaudits kennt genau die Level, die auch im
  // Auswahlmenü stehen (authorityEvalValues im Frontend): C/NA sind kein Urteil
  // einer Findings-Liste, Level 3 vergibt die Behörde dagegen wie die anderen
  // drei. Gezählt wird weiter der Rohwert, beschriftet der Klartext des
  // LBA-Berichts.
  const sumHeaders = isAuthority
    ? ['Findings', 'Bemerkung', 'Level 1', 'Level 2', 'Level 3']
    : ['Total Questions', 'Conformities', 'Not Applicable', 'Observation', 'Level 1', 'Level 2', 'Level 3'];
  const sumValues = isAuthority
    ? [checklistItems.length, countEval('O'), countEval('L1'), countEval('L2'), countEval('L3')]
    : [checklistItems.length, countEval('C'), countEval('NA'), countEval('O'), countEval('L1'), countEval('L2'), countEval('L3')];
  const sumColW = (tableRight - 50) / sumHeaders.length;

  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(50, y, tableRight - 50, 16).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < sumHeaders.length; c++) {
    doc.text(sumHeaders[c], 50 + c * sumColW + 2, y + 3, { width: sumColW - 4, align: 'center' });
  }
  doc.fillColor('#000000');
  y += 16;

  doc.fontSize(9).font('Helvetica');
  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(50, y, tableRight - 50, 18).stroke();
  for (let c = 1; c < sumHeaders.length; c++) {
    doc.moveTo(50 + c * sumColW, y).lineTo(50 + c * sumColW, y + 18).stroke();
  }
  for (let c = 0; c < sumValues.length; c++) {
    doc.text(String(sumValues[c]), 50 + c * sumColW + 2, y + 4, { width: sumColW - 4, align: 'center' });
  }
  y += 30;

  // Empfehlung ans Management und die Unterschriftenzeile sind Artefakte eines
  // internen Audits: der LBA-Bericht wird nicht von uns gezeichnet, und eine
  // Empfehlung an das Management ist das Ergebnis unserer eigenen Prüfung, nicht
  // eines Behördenbesuchs. Beide entfallen dort ersatzlos — und mit ihnen die
  // einzige Leserstelle von `personsAll` und `getPersonSignature` in diesem
  // Renderer, die im Behördenzweig damit gar nicht mehr angefasst wird. Die
  // Zählzeile 'Summary' darüber und die 'Legend' darunter bleiben, sie
  // beschreiben die Findings und nicht deren Bewertung durch uns.
  //
  // Der QM steht dabei VOR dem Zweig: er ist im internen Zweig der Unterzeichner
  // der dritten Unterschriftenspalte und im Behördenzweig der Fallback für den
  // Unterzeichner des eingebetteten CM-002. Innerhalb des `!isAuthority`-Blocks
  // deklariert, wäre er genau dort nicht sichtbar, wo der Fallback ihn liest —
  // ein `const` ist blockskopiert, und `signer || qmPerson` wertet ihn aus, sobald
  // die Route keinen Unterzeichner findet. Ein reines `find()` über das ohnehin
  // geladene `personsAll`, also kein Lesezugriff, den der Behördenzweig scheute.
  const qmPerson = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);

  if (!isAuthority) {
    if (y + 40 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').text('Recommendation for Management', 50, y);
    y += 16;
    doc.fontSize(8).font('Helvetica');
    const recText = line.recommendation || '—';
    doc.rect(50, y, tableRight - 50, Math.max(30, doc.heightOfString(recText, { width: tableRight - 60 }) + 10)).stroke();
    doc.text(recText, 55, y + 5, { width: tableRight - 60 });
    y += Math.max(30, doc.heightOfString(recText, { width: tableRight - 60 }) + 10) + 15;

    const alPerson = personsAll.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
    const accPerson = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);

    const deptText = `${dept.name} ${dept.regulation || ''}`.toLowerCase();
    let alLabel = 'Abteilungsleiter';
    if (deptText.includes('145')) alLabel = 'Maintenance Manager';
    else if (deptText.includes('camo') || deptText.includes('part-m')) alLabel = 'Leiter CAMO';
    else if (deptText.includes('ato') || deptText.includes('flugschule') || deptText.includes('training')) alLabel = 'Head of Training';
    else if (deptText.includes('flug') || deptText.includes('ops') || deptText.includes('ore') || deptText.includes('965')) alLabel = 'Flugbetriebsleiter';

    const sigCols = 4;
    const sigColW = (tableRight - 50) / sigCols;
    const sigHeaderH = 20;
    const sigRowH = 50;

    if (y + sigHeaderH + sigRowH + 10 > 740) { doc.addPage(); y = 50; }

    const sigHeaders = ['Date', 'Auditor', alLabel, 'Accountable Manager'];

    doc.fontSize(7).font('Helvetica-Bold');
    doc.rect(50, y, tableRight - 50, sigHeaderH).fill('#2563eb');
    doc.fillColor('#ffffff');
    for (let c = 0; c < sigCols; c++) {
      doc.text(sigHeaders[c], 50 + c * sigColW + 4, y + 5, { width: sigColW - 8, align: 'center' });
    }
    doc.fillColor('#000000');
    y += sigHeaderH;

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(50, y, tableRight - 50, sigRowH).stroke();
    for (let c = 1; c < sigCols; c++) {
      doc.moveTo(50 + c * sigColW, y).lineTo(50 + c * sigColW, y + sigRowH).stroke();
    }

    doc.fontSize(8).font('Helvetica');
    doc.text(formatDateDE(line.audit_end_date), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });

    const sigPersons = [qmPerson, alPerson, accPerson];
    for (let c = 0; c < 3; c++) {
      const person = sigPersons[c];
      const cx = 50 + (c + 1) * sigColW;
      if (person) {
        const sigRow = stmts.getPersonSignature.get(person.id);
        if (sigRow && sigRow.signature) {
          try {
            doc.image(sigRow.signature, cx + 4, y + 2, { fit: [sigColW - 8, sigRowH - 14], align: 'center', valign: 'center' });
          } catch { /* unreadable */ }
        }
        const name = `${person.first_name} ${person.last_name}`.trim();
        if (name) {
          doc.fontSize(6).text(name, cx + 4, y + sigRowH - 10, { width: sigColW - 8, align: 'center' });
        }
      }
    }
    y += sigRowH + 15;
  }

  if (y + 60 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('Legend', 50, y);
  y += 14;
  doc.fontSize(7).font('Helvetica').fillColor('#444444');
  // Dieselbe Grenze wie Tabelle und Zählzeile: die Legende erklärt die Spalte "Level",
  // also darf sie im Behördenaudit keine Werte beschreiben, die dort nicht vorkommen.
  const legendItems = isAuthority ? [
    'Bemerkung - Beobachtung, kein Finding, lediglich Empfehlung zur Verbesserung',
    'Level 1 - Nichtkonformität, das Finding wird innerhalb von 5 Arbeitstagen behoben',
    'Level 2 - Nichtkonformität, Behebung des Findings innerhalb von 60 Arbeitstagen',
    'Level 3 - Nicht nur eine Empfehlung, muss umgesetzt oder angepasst werden (bei oder mit der nächsten Revision)',
  ] : [
    'C - Conform: The requirement is fully met',
    'NA - Not Applicable: The requirement does not apply',
    'O - Observation: No finding, recommendation for improvement',
    'Level 1 - Non-conformity: Finding to be resolved within 5 working days',
    'Level 2 - Non-conformity: Finding to be resolved within 60 working days',
    'Level 3 - Not just a recommendation, must be implemented or adapted (at or with the next revision)',
  ];
  for (const item of legendItems) {
    doc.text(item, 58, y, { width: tableRight - 58 });
    y += doc.heightOfString(item, { width: tableRight - 58 }) + 2;
  }
  doc.fillColor('#000000');

  // Erst hier, nach Summary, Empfehlung, Unterschriften und Legende: die gehören zur
  // Übersicht, nicht zwischen die Findingseiten. Die flache Tabelle bleibt damit das
  // Inhaltsverzeichnis direkt hinter dem Kopfblock, und die Blätter der einzelnen
  // Findings folgen dem vollständigen Deckblatt.
  if (isAuthority) {
    const pagesY = renderAuthorityFindingPages(doc, {
      line, checklistItems, caps, dept, company, logoRow, deadlines,
      // Unterzeichner des CM-002 ist der QM der Abteilung — dieselbe Zeile, die
      // getQmForDepartment() findet und die hier schon aus dem übergebenen
      // personsAll steht. Der Fallback kostet also keinen Read und kann nicht
      // gegen den eigenständigen CM-002-Download driften.
      signer: signer || qmPerson,
    });
    if (pagesY !== null) y = pagesY;
  }

  return y;
}

// Generates audit plan PDF as a Buffer (for email attachment etc.)
function generateAuditPlanPdfBuffer(planId, type, filter, titleLabel) {
  return new Promise((resolve, reject) => {
    const isClosed = type === 'closed';
    const plan = stmts.getAuditPlan.get(planId);
    if (!plan) return reject(new Error('Audit plan not found'));
    const dept = stmts.getDepartment.get(plan.department_id);
    if (!dept) return reject(new Error('Department not found'));
    const company = stmts.getCompany.get(dept.company_id);
    if (!company) return reject(new Error('Company not found'));
    const logoRow = stmts.getCompanyLogo.get(company.id);
    let lines = stmts.getAuditPlanLinesByPlan.all(plan.id);
    if (filter === 'planned') lines = lines.filter(l => l.planned_window && l.planned_window.trim());
    if (isClosed) lines = lines.filter(l => l.audit_end_date);

    const doc = createPdfDoc({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), plan, dept, company }));
    doc.on('error', reject);
    _renderAuditPlanPdf(doc, { plan, dept, company, logoRow, lines, isClosed, titleLabel });
    doc.end();
  });
}

module.exports = {
  _renderAuditPlanPdf,
  renderAuditLinePdf,
  generateAuditPlanPdfBuffer,
};
