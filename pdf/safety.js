const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');
const { getQmForDepartment } = require('../services/email');
const { createPdfDoc, addPdfFooter } = require('./common');

const MEETING_TYPE_LABELS = { MANAGEMENT_REVIEW: 'Management Review', SRB: 'SRB' };

const COLOR_POSITIVE = '#d4edda';
const COLOR_NEGATIVE = '#f8d7da';
const COLOR_WARNING = '#fff3cd';

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

// ── CM-006 'Safety Performance Analysis' ──

function renderSpiEvaluationPdf(doc, { evaluation, objective, dept, company, logoRow, safetyManager, startY }) {
  let y = drawHeader(doc, { company, dept, logoRow, title: 'Safety Performance Analysis (CM-006)' }, startY);

  const form = makeFormHelpers(doc, y);
  const { contentW, drawInfoRow, drawTextBlock } = form;
  doc.strokeColor('#d0d0d0').lineWidth(0.5);

  // ── Kopftabelle ──
  const spt = evaluation.spt_snapshot || objective.spt;
  const intervalMonths = evaluation.interval_snapshot != null ? evaluation.interval_snapshot : objective.interval_months;
  const fulfilled = evaluation.fulfilled === 1;
  const positive = evaluation.result !== 'NEGATIV';
  const improvement = evaluation.improvement === 1;

  drawInfoRow('Safety Objective', objective.objective);
  drawInfoRow('SPT (Safety Performance Target)', spt);
  drawInfoRow('Intervall', intervalMonths != null ? `${intervalMonths} Monate` : '');
  drawInfoRow('Datum der Bewertung', formatDateDE(evaluation.eval_date));
  drawInfoRow('SPI (Ergebnis)', evaluation.spi_value);
  drawInfoRow('SPT erfüllt', fulfilled ? 'Ja' : 'Nein', { highlight: fulfilled ? COLOR_POSITIVE : COLOR_NEGATIVE, bold: true });
  drawInfoRow('Ergebnis', positive ? 'Positiv' : 'Negativ', { highlight: positive ? COLOR_POSITIVE : COLOR_NEGATIVE, bold: true });
  drawInfoRow('Verbesserung erforderlich', improvement ? 'Ja' : 'Nein', { highlight: improvement ? COLOR_WARNING : undefined, bold: true });
  form.setY(form.getY() + 15);

  // ── Ursachenanalyse ──
  drawTextBlock('Ursachenanalyse', evaluation.cause_analysis);

  // ── Maßnahmen / Empfehlung ──
  drawTextBlock('Maßnahmen / Empfehlung', evaluation.measures);

  // ── Safety-Manager-Entscheidung ──
  drawTextBlock('Entscheidung Safety Manager', evaluation.decision);

  // Ort / Datum / Name signature row (three-column form table)
  y = form.getY();
  const colW = contentW / 3;
  const sigLabels = ['Ort', 'Datum', 'Name Safety Manager'];
  const sigValues = [evaluation.decision_place || '', formatDateDE(evaluation.decided_at) || '', safetyManager || ''];
  if (y + 34 > 740) { doc.addPage(); y = 50; }
  for (let i = 0; i < 3; i++) {
    const x = 50 + i * colW;
    doc.rect(x, y, colW, 14).fill('#f0f4ff');
    doc.rect(x, y, colW, 14).stroke();
    doc.fillColor('#000000').fontSize(7).font('Helvetica-Bold').text(sigLabels[i], x + 4, y + 3, { width: colW - 8 });
    doc.rect(x, y + 14, colW, 20).stroke();
    doc.fontSize(8).font('Helvetica').text(sigValues[i], x + 4, y + 18, { width: colW - 8 });
  }
  y += 34 + 15;

  // ── Kopie an ──
  if (y + 14 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000').text('Kopie an: ', 50, y, { continued: true });
  doc.font('Helvetica').text('MM, ACC');
  y += 14;

  return y;
}

// ── Sitzungsprotokoll (Management Review / SRB) ──

function renderSmsMeetingPdf(doc, { meeting, dept, company, logoRow, startY }) {
  let y = drawHeader(doc, { company, dept, logoRow, title: 'Sitzungsprotokoll' }, startY);

  const form = makeFormHelpers(doc, y);
  const { drawInfoRow, drawTextBlock } = form;
  doc.strokeColor('#d0d0d0').lineWidth(0.5);

  drawInfoRow('Meeting-Typ', MEETING_TYPE_LABELS[meeting.meeting_type] || meeting.meeting_type);
  drawInfoRow('Datum', formatDateDE(meeting.meeting_date));
  drawInfoRow('Teilnehmer', meeting.participants);
  form.setY(form.getY() + 15);

  drawTextBlock('Thematik', meeting.topics);
  drawTextBlock('Ergebnisse', meeting.results);
  drawTextBlock('Maßnahmen', meeting.actions);

  return form.getY();
}

// ── Buffer generators (analog pdf/cap.js) ──

function generateSpiEvaluationPdfBuffer(id) {
  return new Promise((resolve, reject) => {
    const evaluation = stmts.getSpiEvaluationRaw.get(id);
    if (!evaluation) return reject(new Error('SPI evaluation not found'));
    const objective = stmts.getSafetyObjective.get(evaluation.safety_objective_id);
    const dept = stmts.getDepartment.get(objective.department_id);
    const company = stmts.getCompany.get(dept.company_id);
    const logoRow = stmts.getCompanyLogo.get(company.id);
    const qm = getQmForDepartment(company.id, dept.id);
    const safetyManager = qm ? `${qm.first_name} ${qm.last_name}` : '';

    const doc = createPdfDoc({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), dept, company }));

    renderSpiEvaluationPdf(doc, { evaluation, objective, dept, company, logoRow, safetyManager, startY: 50 });
    addPdfFooter(doc);
    doc.end();
  });
}

function generateSmsMeetingPdfBuffer(id) {
  return new Promise((resolve, reject) => {
    const meeting = stmts.getSmsMeeting.get(id);
    if (!meeting) return reject(new Error('SMS meeting not found'));
    const dept = stmts.getDepartment.get(meeting.department_id);
    const company = stmts.getCompany.get(dept.company_id);
    const logoRow = stmts.getCompanyLogo.get(company.id);

    const doc = createPdfDoc({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), dept, company }));

    renderSmsMeetingPdf(doc, { meeting, dept, company, logoRow, startY: 50 });
    addPdfFooter(doc);
    doc.end();
  });
}

module.exports = {
  renderSpiEvaluationPdf,
  renderSmsMeetingPdf,
  generateSpiEvaluationPdfBuffer,
  generateSmsMeetingPdfBuffer
};
