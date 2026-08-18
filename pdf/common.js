const PDFDocument = require('pdfkit');

// Factory for consistent PDFKit document configuration.
function createPdfDoc({ landscape = false, margin = 50 } = {}) {
  const opts = { size: 'A4', margin, bufferPages: true };
  if (landscape) opts.layout = 'landscape';
  return new PDFDocument(opts);
}

// Adds a footer to all buffered pages.
function addPdfFooter(doc, opts = {}) {
  const label = opts.label || 'Erstellt mit ac-audit';
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

// Beschriftung, kein Datenmodell: gespeichert bleibt 'O'/'L1'/'L2', gedruckt wird bei
// einem Behördenaudit der Klartext des echten LBA-Berichts. Spiegelt authorityEvalLabels /
// evalLabel() im Frontend — die Farbzuordnung liest weiter den Rohwert.
// Steht hier, weil sowohl das CAP-PDF (pdf/cap.js) als auch die Beanstandungstabelle des
// Audit-Line-PDFs (pdf/audit.js) dieselbe Beschriftung drucken müssen.
const AUTHORITY_EVAL_LABELS = { O: 'Bemerkung', L1: 'Level 1', L2: 'Level 2' };

function authorityEvalLabel(value) {
  return AUTHORITY_EVAL_LABELS[value] || value || '';
}

module.exports = { createPdfDoc, addPdfFooter, authorityEvalLabel };
