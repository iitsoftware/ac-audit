const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');
const { createPdfDoc, addPdfFooter } = require('./common');

const FOOTER_LABEL = 'CM-025, SRB Meeting, Rev. 1, 28.08.2024';
const PROTOCOL_COLOR = '#1f4e79';
const PAGE_BOTTOM = 740;

// ── Shared layout helpers (same page geometry as pdf/cap.js) ──

function drawHeader(doc, { company, dept, logoRow, title }, startY) {
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

  doc.fontSize(14).font('Helvetica-Bold').text(title, 50, y);
  y += 25;
  return y;
}

// Returns { drawInfoRow, drawTextBlock, getY, setY } bound to the doc.
function makeFormHelpers(doc, initialY) {
  const pageW = 595.28;
  const tableRight = pageW - 50;
  const contentW = tableRight - 50;
  const labelW = 130;
  const valW = contentW - labelW;
  let y = initialY;

  function drawInfoRow(label, value, options) {
    const { highlight, bold } = options || {};
    const textVal = value || '';
    doc.fontSize(8).font('Helvetica-Bold');
    const labelH = doc.heightOfString(label, { width: labelW - 8 }) + 6;
    doc.font('Helvetica');
    const valH = Math.max(16, labelH, doc.heightOfString(textVal, { width: valW - 8 }) + 6);
    if (y + valH > 740) { doc.addPage(); y = 50; }

    doc.rect(50, y, labelW, valH).fill('#f0f4ff');
    doc.rect(50, y, labelW, valH).stroke();
    if (highlight) {
      doc.rect(50 + labelW, y, valW, valH).fill(highlight);
    }
    doc.rect(50 + labelW, y, valW, valH).stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').text(label, 54, y + 3, { width: labelW - 8 });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(textVal, 50 + labelW + 4, y + 3, { width: valW - 8 });
    y += valH;
  }

  // Section heading + full-width bordered box; minHeight keeps empty
  // form fields visible on the printed form.
  function drawTextBlock(title, text, minHeight = 50) {
    const textVal = text || '';
    doc.fontSize(8).font('Helvetica');
    const boxH = Math.max(minHeight, doc.heightOfString(textVal, { width: contentW - 8 }) + 10);
    if (y + 16 + boxH > 740) { doc.addPage(); y = 50; }

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(title, 50, y);
    y += 16;
    doc.rect(50, y, contentW, boxH).stroke();
    doc.fontSize(8).font('Helvetica').fillColor('#000000').text(textVal, 54, y + 5, { width: contentW - 8 });
    y += boxH + 15;
  }

  return {
    contentW,
    drawInfoRow,
    drawTextBlock,
    getY: () => y,
    setY: v => { y = v; }
  };
}

// ── CM-025 'Safety Review Board Meeting' ──

// Page 1: header data + THEMEN box. Page 2: the SRB protocol table.
function renderSrbMeetingPdf(doc, { meeting, year, dept, company, logoRow, startY }) {
  const header = { company, dept, logoRow, title: 'SAFETY REVIEW BOARD MEETING' };
  const form = makeFormHelpers(doc, drawHeader(doc, header, startY));
  const { contentW, drawInfoRow, drawTextBlock } = form;

  // Draws the protocol block: coloured bar plus cells sharing one outer
  // contour per page. Cells grow with their content and move to the next
  // page as a whole; text longer than a full page is split across pages.
  function drawProtocol(sections) {
    const x = 50;
    const pad = 6;
    const textW = contentW - 2 * pad;

    const textHeight = text => {
      doc.fontSize(8).font('Helvetica');
      return doc.heightOfString(text || '', { width: textW });
    };
    const headingHeight = title => {
      doc.fontSize(9).font('Helvetica-Bold');
      return doc.heightOfString(title, { width: textW }) + 5;
    };
    // Splits text so the first part fits maxH; returns [head, tail].
    const splitText = (text, maxH) => {
      const words = text.split(' ');
      let lo = 1, hi = words.length, fit = 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (textHeight(words.slice(0, mid).join(' ')) <= maxH) { fit = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return [words.slice(0, fit).join(' '), words.slice(fit).join(' ')];
    };

    const applyStroke = () => doc.strokeColor(PROTOCOL_COLOR).lineWidth(0.5);
    applyStroke();

    let y = form.getY();

    doc.rect(x, y, contentW, 20).fill(PROTOCOL_COLOR);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
      .text('SAFETY REVIEW BOARD PROTOKOLL', x, y + 5, { width: contentW, align: 'center' });
    doc.fillColor('#000000');
    y += 20;

    let contourTop = y;   // top edge of the outer contour on the current page
    let firstOnPage = true;

    const closeContour = () => {
      if (y > contourTop) doc.rect(x, contourTop, contentW, y - contourTop).stroke();
    };
    const newPage = () => {
      closeContour();
      doc.addPage();
      applyStroke();
      y = drawHeader(doc, header, 50);
      contourTop = y;
      firstOnPage = true;
    };
    const drawCell = (title, text, cellH, headH) => {
      if (!firstOnPage) doc.moveTo(x, y).lineTo(x + contentW, y).stroke();
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold')
        .text(title, x + pad, y + pad, { width: textW, underline: true });
      doc.fontSize(8).font('Helvetica')
        .text(text || '', x + pad, y + pad + headH, {
          width: textW,
          height: Math.max(0, cellH - headH - 2 * pad),
          underline: false
        });
      y += cellH;
      firstOnPage = false;
    };

    for (const section of sections) {
      const headH = headingHeight(section.title);
      let rest = String(section.text || '');
      let firstChunk = true;

      for (;;) {
        const minH = firstChunk ? section.minHeight : 0;
        const cellH = Math.max(minH, headH + textHeight(rest) + 2 * pad);
        if (cellH > PAGE_BOTTOM - y && !firstOnPage) newPage();

        const room = PAGE_BOTTOM - y;
        if (cellH <= room) { drawCell(section.title, rest, cellH, headH); break; }

        // Too tall even for an empty page — cut the text and continue overleaf.
        const [head, tail] = splitText(rest, room - headH - 2 * pad);
        drawCell(section.title, head, room, headH);
        rest = tail;
        firstChunk = false;
        newPage();
      }
    }

    closeContour();
    form.setY(y);
  }

  // ── Page 1 ──
  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  drawInfoRow('Datum', formatDateDE(meeting.meeting_date));
  drawInfoRow('Ort', meeting.location);
  drawInfoRow('Teilnehmer', meeting.participants);
  drawInfoRow('Teilnehmer entschuldigt', meeting.participants_excused);
  drawInfoRow('SRB MEETING NO', meeting.meeting_no);
  form.setY(form.getY() + 15);

  // Large topics box — stays usable (fillable by hand) when empty.
  drawTextBlock('THEMEN', meeting.topics, 380);

  // ── Page 2 ──
  doc.addPage();
  form.setY(drawHeader(doc, header, 50));

  // The outlook heading targets the year after the safety year; the
  // parenthetical hint stays lower case exactly as on the CM-025 form.
  const outlookYear = year && year.year ? ` ${Number(year.year) + 1}` : '';
  drawProtocol([
    { title: 'ALLGEMEINES ERGEBNIS', text: meeting.general_result, minHeight: 90 },
    { title: 'POSITIVES', text: meeting.positives, minHeight: 55 },
    { title: 'NEGATIV', text: meeting.negatives, minHeight: 55 },
    { title: 'VERBESSERUNGSVORSCHLÄGE', text: meeting.improvements, minHeight: 55 },
    { title: 'BEMERKUNGEN', text: meeting.remarks, minHeight: 55 },
    { title: `VORSCHAU${outlookYear} (objectives, targets usw.)`, text: meeting.outlook, minHeight: 55 }
  ]);

  return form.getY();
}

// ── Buffer generator (analog pdf/cap.js) ──

function generateSmsMeetingPdfBuffer(id) {
  return new Promise((resolve, reject) => {
    const meeting = stmts.getSmsMeeting.get(id);
    if (!meeting) return reject(new Error('SMS meeting not found'));
    const year = meeting.safety_year_id ? stmts.getSafetyYear.get(meeting.safety_year_id) : null;
    const dept = stmts.getDepartment.get(meeting.department_id);
    const company = stmts.getCompany.get(dept.company_id);
    const logoRow = stmts.getCompanyLogo.get(company.id);

    const doc = createPdfDoc({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), dept, company }));

    renderSrbMeetingPdf(doc, { meeting, year, dept, company, logoRow, startY: 50 });
    addPdfFooter(doc, { label: FOOTER_LABEL });
    doc.end();
  });
}

module.exports = {
  renderSrbMeetingPdf,
  generateSmsMeetingPdfBuffer
};
