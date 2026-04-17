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

module.exports = { createPdfDoc, addPdfFooter };
