const PDFDocument = require('pdfkit');
const { formatDateDE } = require('../services/audit-log');

// Factory for consistent PDFKit document configuration.
function createPdfDoc({ landscape = false, margin = 50 } = {}) {
  const opts = { size: 'A4', margin, bufferPages: true };
  if (landscape) opts.layout = 'landscape';
  return new PDFDocument(opts);
}

// Der App-Hinweis der linken Fußzeile — die EINE Fundstelle des App-Namens. Er stand
// bis dahin als Default in addPdfFooter() und ein zweites Mal am Ende jedes
// zusammengesetzten Labels (pdf/safety.js, pdf/five-why.js, routes/risk-analysis.js),
// weil `label` den Default ersetzte statt ihn zu ergänzen: wer eine Formularreferenz
// setzte, tauschte den Hinweis versehentlich gegen sie ein, und dieselbe App hieß auf
// den sechs Strings dreimal anders (ac-audit / ac-sms / ac-change).
const APP_FOOTER = 'Erstellt mit ac-suite';
// Der Trenner der zusammengesetzten Fußzeile — exakt der, den die Labels zuvor selbst
// schrieben, damit sie nach dem Entfernen ihres Anhangs unverändert aussehen.
const FOOTER_SEP = '  |  ';

// Adds a footer to all buffered pages.
// `label` ist seither ein PRÄFIX und kein Ersatz: der App-Hinweis steht immer rechts
// davon, ein Renderer kann ihn also nicht mehr verlieren. Ohne `label` bleibt der
// Hinweis allein — das ist der Fall der Batch-Route und jedes internen Auditplans.
function addPdfFooter(doc, opts = {}) {
  const label = opts.label ? `${opts.label}${FOOTER_SEP}${APP_FOOTER}` : APP_FOOTER;
  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const marginL = 40;
    const tableRight = pageW - 40;
    const footerY = pageH - 30;
    doc.save();
    doc.strokeColor('#000000').lineWidth(0.5);
    doc.moveTo(marginL, footerY).lineTo(tableRight, footerY).stroke();
    doc.fontSize(7).fillColor('#000000').font('Helvetica');
    doc.text(label, marginL, footerY + 4, { lineBreak: false, height: 10 });
    const pageLabel = `Seite ${p - pages.start + 1}/${pages.count}`;
    doc.text(pageLabel, tableRight - 60, footerY + 4, { width: 60, align: 'right', lineBreak: false, height: 10 });
    doc.restore();
  }
}

// Beschriftung, kein Datenmodell: gespeichert bleibt 'O'/'L1'/'L2'/'L3', gedruckt wird bei
// einem Behördenaudit der Klartext des echten LBA-Berichts. Spiegelt authorityEvalLabels /
// evalLabel() im Frontend — die Farbzuordnung liest weiter den Rohwert.
// Steht hier, weil sowohl das CAP-PDF (pdf/cap.js) als auch die Findingtabelle des
// Audit-Line-PDFs (pdf/audit.js) dieselbe Beschriftung drucken müssen.
// 'L3' steht im Auswahlmenü eines Behördenaudits nicht zur Wahl (authorityEvalValues), kann
// aber als Altbestand an einem Finding hängen — ohne Eintrag druckte das Dokument dort den
// Rohwert 'L3' neben ausgeschriebenen Nachbarn.
const AUTHORITY_EVAL_LABELS = { O: 'Bemerkung', L1: 'Level 1', L2: 'Level 2', L3: 'Level 3' };

function authorityEvalLabel(value) {
  return AUTHORITY_EVAL_LABELS[value] || value || '';
}

// Die Überschrift eines Behördenberichts — dieselbe Regel wie authorityName(date, '')
// im Frontend: ohne Datum sagt die Beschriftung genau das, statt eine Jahreszahl zu
// erfinden. Steht hier, weil Deckblatt und Findingseiten des Behördenbogens
// (pdf/audit.js) und der Kopf des CM-003 (pdf/cap.js) denselben Besuch benennen —
// eine zweite Fundstelle wäre die erste, die abdriftet.
function authorityVisitLabel(line) {
  const visitDate = formatDateDE(line.audit_end_date);
  return visitDate ? `Behördenaudit ${visitDate}` : 'Behördenaudit (ohne Datum)';
}

// Beschriftung, kein Datenmodell: die Rolle bleibt gespeichert als 'ABTEILUNGSLEITER', gedruckt
// wird die Bezeichnung, die das jeweilige Regelwerk der Abteilung dafür führt. Gelesen werden
// Name und Regulation gemeinsam, weil beide Felder die Genehmigungsart tragen können.
// Steht hier, weil das Auditplan-PDF und das Audit-Line-PDF (beide pdf/audit.js) dieselbe
// Unterschriftenspalte beschriften und eine dritte Fundstelle die erste wäre, die abdriftet.
// Die Reihenfolge der Zweige ist Teil der Regel und keine Kosmetik: 'flugschule' enthält 'flug',
// eine ATO stünde hinter dem OPS-Zweig also als Flugbetriebsleiter auf dem Blatt.
function departmentLeaderLabel(dept) {
  const deptText = `${dept?.name || ''} ${dept?.regulation || ''}`.toLowerCase();
  if (deptText.includes('145')) return 'Maintenance Manager';
  if (deptText.includes('camo') || deptText.includes('part-m')) return 'Leiter CAMO';
  if (deptText.includes('ato') || deptText.includes('flugschule') || deptText.includes('training')) return 'Head of Training';
  if (deptText.includes('flug') || deptText.includes('ops') || deptText.includes('ore') || deptText.includes('965')) return 'Flugbetriebsleiter';
  return 'Abteilungsleiter';
}

module.exports = { createPdfDoc, addPdfFooter, APP_FOOTER, authorityEvalLabel, authorityVisitLabel, departmentLeaderLabel };
