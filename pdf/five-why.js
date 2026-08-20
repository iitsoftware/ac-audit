const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');
const { getQmForDepartment } = require('../services/email');
const { createPdfDoc, addPdfFooter } = require('./common');

// LBA-Formularreferenz + App-Hinweis in einem Label wie in pdf/safety.js: addPdfFooter()
// ersetzt mit `label` den Default 'Erstellt mit ac-audit', also muss beides hier stehen.
const FOOTER_LABEL = 'CM-002, Grundursachenanalyse, Rev. 0, 28.08.2024  |  Erstellt mit ac-audit';
const BAND_COLOR = '#1f4e79';
const PAGE_BOTTOM = 740;
const CONTENT_W = 595.28 - 100;
const TITLE = 'GRUNDURSACHENANALYSE / ROOT CAUSE ANALYSIS';

// Die Frageüberschriften des CM-002-Formulars sind Konstanten des Renderers, keine
// Spalten: five_why bleibt why1..why5 + root_cause (schema.sql), das Formular
// beschriftet die fünf Stufen. Deshalb kostet dieses PDF keine Migration.
// Die Kopfzeile folgt dem Original: über Kasten 1 steht die Einstiegsfrage der
// 5W-Kette, über 2–5 jeweils deren Wiederholung. Der deutsche Titel steht dahinter
// in Klammern statt allein im Kopf, weil der Feldinhalt selbst mit 'Auswirkung: …'
// beginnt und das Wort sonst zweimal überm selben Text stünde.
// Zweite Fundstelle derselben fünf Überschriften: fiveWhyHtml() in
// public/companies.js beschriftet die Eingabefelder der Ursachenanalyse damit.
// Frontend und Renderer teilen sich kein Modul, die Liste steht also zwangsläufig
// zweimal — wie die Stufen-Klartexte bei evalLabel() (public/companies.js) und
// capEvalLabel() (pdf/cap.js). Wer hier ein Wort ändert, ändert es dort mit:
// Schirm und Blatt beschriften dasselbe Feld.
const WHY_STEPS = [
  { field: 'why1', question: 'Why is it happening?', title: 'Auswirkung' },
  { field: 'why2', question: 'Why is that?', title: 'Direkte Ursache' },
  { field: 'why3', question: 'Why is that?', title: 'Tiefere Ursache' },
  { field: 'why4', question: 'Why is that?', title: 'Organisationsmangel' },
  { field: 'why5', question: 'Why is that?', title: 'Systemmangel' }
];
// Beide Seiten setzen ihre Kastenköpfe hier zusammen — laufende Nummer, Frage,
// deutscher Titel in Klammern —, damit der Seitenschnitt die Überschriften nicht
// in zwei Schreibweisen auseinanderlaufen lässt.
// Verglichen wird mit fiveWhyHtml() (public/companies.js) genau dieser
// zusammengesetzte String, nicht die drei Einzelteile darüber: die <label> der
// fünf fw-why-Felder tragen '1. Why is it happening? (Auswirkung)' und
// '2.'–'5. Why is that? (…)' wörtlich.
const whyHeading = (step, n) => `${n}. ${step.question} (${step.title})`;
// Seite 1 trägt Why 1–3 unter PRIMARY CAUSE, Seite 2 die restlichen unter
// WHY IS THIS A PROBLEM? — der Schnitt des echten zweiseitigen Formulars.
const PRIMARY_CAUSE_STEPS = 3;
const STEP_INDENT = 20;
// Luft zwischen zwei Kästen — die Höhe, in der die Treppenlinie läuft.
const BOX_GAP = 14;

// Funktionsbezeichnung des Unterzeichners: dieselbe, mit der AC-Audit jedes Dokument
// nach außen zeichnet (routes/cap-items.js, Unterschriftenzeile in pdf/audit.js).
const SIGNER_POSITION = 'Compliance Monitoring Manager';

// Das eigenständige CM-002-Formular eines Findings. `fiveWhy` darf fehlen: die
// Kästen behalten ihre Mindesthöhe, das Formular ist dann von Hand ausfüllbar —
// dieselbe Begründung wie bei den Blöcken des CM-025 (pdf/safety.js).
function renderFiveWhyPdf(doc, { cap, fiveWhy, department, company, logoRow, signer, startY }) {
  const x0 = 50;
  const pad = 6;
  let y = startY || 50;
  // Ausgangspunkt der Treppen-Verbindungslinie; auf jeder neuen Seite zurückgesetzt,
  // weil eine Linie über den Seitenrand hinaus nichts verbindet.
  let lastBox = null;
  // Oberkante des Inhalts der laufenden Seite — die Abbruchbedingung des
  // Umbruchs in drawBox(): auf einer frisch begonnenen Seite hilft eine weitere
  // Seite nicht mehr, dort wird der Text stattdessen geteilt.
  let contentTop = y;

  function drawHeader() {
    if (logoRow && logoRow.logo) {
      try { doc.image(logoRow.logo, x0, y, { height: 45 }); y += 55; } catch { y += 10; }
    }
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(company.name, x0, y);
    y += 20;

    // Die EASA-Genehmigungsnummer der Abteilung steht im Kopf jedes LBA-Formulars.
    doc.fontSize(9).font('Helvetica');
    let subLine = department.name;
    if (department.easa_permission_number) subLine += `  |  ${department.easa_permission_number}`;
    if (department.regulation) subLine += `  |  ${department.regulation}`;
    doc.text(subLine, x0, y);
    y += 25;

    doc.fontSize(14).font('Helvetica-Bold');
    const titleH = doc.heightOfString(TITLE, { width: CONTENT_W });
    doc.text(TITLE, x0, y, { width: CONTENT_W });
    y += titleH + 6;

    // Zuordnung der Analyse zum Finding — das Formular steht als eigenes
    // Dokument bei der Behörde und muss ohne den CAP-Bericht daneben lesbar sein.
    const context = [
      cap.audit_no ? `Audit-Nr. ${cap.audit_no}` : '',
      cap.regulation_ref ? `Referenz ${cap.regulation_ref}` : ''
    ].filter(Boolean).join('  |  ');
    if (context) {
      doc.fontSize(9).font('Helvetica').fillColor('#000000').text(context, x0, y);
      y += 14;
    }
    y += 10;
    contentTop = y;
  }

  function newPage() {
    doc.addPage();
    y = 50;
    lastBox = null;
    drawHeader();
  }

  function ensureRoom(height) {
    if (y + height > PAGE_BOTTOM) newPage();
  }

  // Farbiges Band über die volle Breite — die Abschnittsüberschriften des Formulars.
  // Der Platzbedarf schließt den ersten Kasten mit ein, damit ein Band nie allein
  // am Seitenfuß stehen bleibt.
  function drawBand(label) {
    ensureRoom(20 + 10 + 60 + BOX_GAP);
    doc.rect(x0, y, CONTENT_W, 20).fill(BAND_COLOR);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
      .text(label, x0, y + 5, { width: CONTENT_W, align: 'center' });
    doc.fillColor('#000000');
    y += 20 + 10;
    lastBox = null;
  }

  // Überschrift im Kasten, darunter der Wert; `indent` erzeugt die Treppe.
  // Ein Kasten wandert als Ganzes auf die nächste Seite; nur ein Text, der auch
  // auf einer leeren Seite nicht mehr Platz hat, wird geteilt und überm Blatt
  // fortgesetzt — dieselbe Mechanik wie beim Protokollblock des CM-025
  // (drawProtocol in pdf/safety.js). Ohne sie liefe ein langes Why in die Fußzeile
  // und der Rest wäre still abgeschnitten.
  function drawBox(title, text, { indent = 0, minHeight = 60, bold = false } = {}) {
    const x = x0 + indent;
    const w = CONTENT_W - indent;
    const innerW = w - 2 * pad;
    const valueFont = bold ? 'Helvetica-Bold' : 'Helvetica';

    doc.fontSize(9).font('Helvetica-Bold');
    const headH = doc.heightOfString(title, { width: innerW }) + 4;
    const textH = t => {
      doc.fontSize(9).font(valueFont);
      return doc.heightOfString(t || '', { width: innerW });
    };
    // Teilt den Text so, dass der erste Teil in maxH passt; liefert [Kopf, Rest].
    const splitText = (t, maxH) => {
      const words = t.split(' ');
      let lo = 1, hi = words.length, fit = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (textH(words.slice(0, mid).join(' ')) <= maxH) { fit = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return [words.slice(0, fit).join(' '), words.slice(fit).join(' ')];
    };

    const paint = (chunk, boxH) => {
      // Treppenstufe an die vorige Stufe anschließen: Elbow von deren Unterkante in
      // die linke Kante der neuen — nur bei einem echten Versatz nach rechts.
      doc.strokeColor(BAND_COLOR).lineWidth(0.5);
      if (lastBox && lastBox.x < x) {
        const cx = lastBox.x + 12;
        doc.moveTo(cx, lastBox.bottom).lineTo(cx, y + 10).lineTo(x, y + 10).stroke();
      }

      doc.rect(x, y, w, boxH).stroke();
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold')
        .text(title, x + pad, y + pad, { width: innerW });
      doc.fontSize(9).font(valueFont)
        .text(chunk, x + pad, y + pad + headH, { width: innerW, height: boxH - headH - 2 * pad });

      lastBox = { x, bottom: y + boxH };
      y += boxH + BOX_GAP;
    };

    let rest = String(text || '');
    let firstChunk = true;
    for (;;) {
      const boxH = Math.max(firstChunk ? minHeight : 0, headH + textH(rest) + 2 * pad);
      // Auf einer bereits begonnenen Seite zuerst umbrechen; y === contentTop
      // heißt "frische Seite" und beendet die Schleife statt sie zu wiederholen.
      if (boxH + BOX_GAP > PAGE_BOTTOM - y && y > contentTop) newPage();

      const room = PAGE_BOTTOM - y - BOX_GAP;
      if (boxH <= room) { paint(rest, boxH); break; }

      const [head, tail] = splitText(rest, room - headH - 2 * pad);
      paint(head, room);
      rest = tail;
      firstChunk = false;
      newPage();
    }
  }

  // Name / Position / Datum unter dem Root-Cause-Statement. Das Formular kennt
  // keine Unterschriftenlinie, sondern drei beschriftete Felder — deshalb eine
  // Kopf-/Wertzeile wie in der Ergebnistabelle des CM-006 (pdf/safety.js).
  function drawSignerRow() {
    const cells = [
      { label: 'Name', value: signer ? `${signer.first_name || ''} ${signer.last_name || ''}`.trim() : '', w: 200 },
      { label: 'Position', value: signer ? SIGNER_POSITION : '', w: 175 },
      // Das Datum der Analyse ist ihre letzte Änderung — five_why führt kein
      // eigenes Unterschriftsdatum, und eine neue Spalte wäre eine Migration.
      { label: 'Datum', value: formatDateDE(fiveWhy && fiveWhy.updated_at), w: 0 }
    ];
    cells[cells.length - 1].w = CONTENT_W - cells.reduce((sum, c) => sum + c.w, 0);

    const headH = 18;
    doc.fontSize(9).font('Helvetica');
    const rowH = Math.max(22, ...cells.map(c => doc.heightOfString(c.value, { width: c.w - 8 }) + 8));
    ensureRoom(headH + rowH);

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(x0, y, CONTENT_W, headH).fill('#e8e8e8');
    doc.fillColor('#000000').fontSize(8).font('Helvetica-Bold');
    let x = x0;
    for (const cell of cells) {
      doc.rect(x, y, cell.w, headH).stroke();
      doc.text(cell.label, x + 4, y + 5, { width: cell.w - 8 });
      x += cell.w;
    }
    y += headH;

    doc.fontSize(9).font('Helvetica');
    x = x0;
    for (const cell of cells) {
      doc.rect(x, y, cell.w, rowH).stroke();
      doc.fillColor('#000000').text(cell.value, x + 4, y + 5, { width: cell.w - 8 });
      x += cell.w;
    }
    y += rowH;
  }

  // ── Seite 1: das Problem und die Primärursache ──
  drawHeader();

  drawBand('DEFINE THE PROBLEM');
  // Beschriftet wie die Kette Besuch → Finding → 5-Why/Maßnahmen: der Kasten trägt
  // die `compliance_check` des Findings, und `Beanstandung` steht auf keinem
  // Behördenblatt mehr (dieselbe Sprachregelung wie Findingliste und Finding-Screen).
  drawBox('Finding', cap.compliance_check, { minHeight: 70 });

  drawBand('PRIMARY CAUSE');
  WHY_STEPS.slice(0, PRIMARY_CAUSE_STEPS).forEach((step, i) => {
    drawBox(whyHeading(step, i + 1), fiveWhy ? fiveWhy[step.field] : '', { indent: i * STEP_INDENT });
  });

  // ── Seite 2: die dahinterliegenden Ursachen und das Statement ──
  // Der Umbruch ist gesetzt, nicht gerechnet: das echte Formular ist zweiseitig.
  newPage();

  drawBand('WHY IS THIS A PROBLEM?');
  // Die Einrückung beginnt auf der zweiten Seite von vorn: die Treppe liefe sonst
  // über den rechten Rand hinaus, obwohl das Band den Abschnitt ohnehin neu öffnet.
  WHY_STEPS.slice(PRIMARY_CAUSE_STEPS).forEach((step, i) => {
    const n = PRIMARY_CAUSE_STEPS + i + 1;
    drawBox(whyHeading(step, n), fiveWhy ? fiveWhy[step.field] : '', { indent: i * STEP_INDENT });
  });

  drawBand('FINAL ROOT CAUSE STATEMENT');
  drawBox('Grundursache', fiveWhy ? fiveWhy.root_cause : '', { minHeight: 80, bold: true });
  drawSignerRow();

  return y;
}

// Analog generateCapItemsPdfBuffer in pdf/cap.js: der Aufrufer übergibt nur die
// CAP-ID, alles Weitere liest der Generator. Der Unterzeichner ist der QM der
// Abteilung — dieselbe Quelle, aus der jede AC-Audit-Mail ihre Signatur zieht.
function generateFiveWhyPdfBuffer(capItemId) {
  return new Promise((resolve, reject) => {
    const cap = stmts.getCapItem.get(capItemId);
    if (!cap) return reject(new Error('CAP item not found'));

    const checklistItem = stmts.getChecklistItem.get(cap.checklist_item_id);
    const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    const department = stmts.getDepartment.get(plan.department_id);
    const company = stmts.getCompany.get(department.company_id);
    const logoRow = stmts.getCompanyLogo.get(company.id);
    // Ohne Datensatz wird das Formular leer gedruckt — ein noch nicht ausgefülltes
    // CM-002 ist ein Zustand, kein Fehler.
    const fiveWhy = stmts.getFiveWhyByCapItem.get(cap.id) || null;
    const signer = getQmForDepartment(company.id, department.id);

    const doc = createPdfDoc({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), cap, dept: department, company }));

    renderFiveWhyPdf(doc, { cap, fiveWhy, department, company, logoRow, signer, startY: 50 });
    addPdfFooter(doc, { label: FOOTER_LABEL });
    doc.end();
  });
}

module.exports = { renderFiveWhyPdf, generateFiveWhyPdfBuffer };
