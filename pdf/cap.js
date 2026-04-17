const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');
const { createPdfDoc, addPdfFooter } = require('./common');

function renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, evidenceFiles, startY }) {
  const pageW = 595.28;
  const tableRight = pageW - 50;
  const contentW = tableRight - 50;

  const evalColors = {
    'C': '#d4edda', 'NA': '#e2e3e5', 'O': '#fff3cd',
    'L1': '#f8d7da', 'L2': '#f5c6cb', 'L3': '#f1b0b7'
  };

  let y = startY || 50;

  // ── Header ──
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

  doc.fontSize(14).font('Helvetica-Bold').text('Corrective Action', 50, y);
  y += 25;

  // ── Helper: key-value row ──
  const labelW = 130;
  const valW = contentW - labelW;

  function drawInfoRow(label, value, options) {
    const { evalHighlight, bold } = options || {};
    const textVal = value || '';
    doc.fontSize(8).font('Helvetica');
    const valH = Math.max(16, doc.heightOfString(textVal, { width: valW - 8 }) + 6);
    if (y + valH > 740) { doc.addPage(); y = 50; }

    doc.rect(50, y, labelW, valH).fill('#f0f4ff');
    doc.rect(50, y, labelW, valH).stroke();
    if (evalHighlight && evalColors[evalHighlight]) {
      doc.rect(50 + labelW, y, valW, valH).fill(evalColors[evalHighlight]);
    }
    doc.rect(50 + labelW, y, valW, valH).stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').text(label, 54, y + 3, { width: labelW - 8 });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(textVal, 50 + labelW + 4, y + 3, { width: valW - 8 });
    y += valH;
  }

  // ── Section 1: Finding Info ──
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Finding-Info', 50, y);
  y += 16;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  drawInfoRow('Auditplan', `${plan.year || ''} – ${plan.name || ''}`);
  drawInfoRow('Audit-Nr.', cap.audit_no);
  drawInfoRow('Thema', cap.subject);
  drawInfoRow('Finding', cap.compliance_check);
  drawInfoRow('Level', cap.evaluation, { evalHighlight: cap.evaluation, bold: true });
  drawInfoRow('Regulation Ref.', cap.regulation_ref);
  drawInfoRow('Kommentar', cap.auditor_comment);
  y += 15;

  // ── Section 2: 5-Why (only L1/L2) ──
  const hasFiveWhy = cap.evaluation === 'L1' || cap.evaluation === 'L2';
  if (hasFiveWhy && fiveWhy) {
    if (y + 30 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('5-Why Analyse', 50, y);
    y += 16;

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    drawInfoRow('1. Warum?', fiveWhy.why1);
    drawInfoRow('2. Warum?', fiveWhy.why2);
    drawInfoRow('3. Warum?', fiveWhy.why3);
    drawInfoRow('4. Warum?', fiveWhy.why4);
    drawInfoRow('5. Warum?', fiveWhy.why5);
    drawInfoRow('Root Cause', fiveWhy.root_cause, { bold: true });
    y += 15;
  }

  // ── Section 3: Corrective Action Details ──
  if (y + 30 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Corrective Action', 50, y);
  y += 16;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  drawInfoRow('Deadline', formatDateDE(cap.deadline));
  drawInfoRow('Verantwortlich', cap.responsible_person);
  drawInfoRow('Ursache', cap.root_cause);
  drawInfoRow('Korrekturmaßnahme', cap.corrective_action);
  drawInfoRow('Vorbeugemaßnahme', cap.preventive_action);
  drawInfoRow('Erledigt am', formatDateDE(cap.completion_date));
  drawInfoRow('Nachweis', cap.evidence);
  y += 15;

  // ── Section 4: Evidence Images ──
  const imageFiles = (evidenceFiles || []).filter(f => (f.mime_type || '').startsWith('image/'));
  if (imageFiles.length > 0) {
    if (y + 30 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Nachweise', 50, y);
    y += 16;

    for (const ef of imageFiles) {
      const fullFile = stmts.getEvidenceFile.get(ef.id);
      if (!fullFile || !fullFile.data) continue;
      try {
        const maxH = 300;
        if (y + maxH + 20 > 740) { doc.addPage(); y = 50; }
        doc.fontSize(7).font('Helvetica').fillColor('#666666').text(ef.filename || 'Bild', 50, y);
        y += 12;
        doc.image(fullFile.data, 50, y, { fit: [contentW, maxH], align: 'center' });
        y += maxH + 10;
        if (y > 740) { doc.addPage(); y = 50; }
      } catch { /* skip unreadable image */ }
    }
  }

  return y;
}

function generateCapItemsPdfBuffer(ids) {
  return new Promise((resolve, reject) => {
    if (!ids || ids.length === 0) return reject(new Error('No IDs provided'));
    const doc = createPdfDoc({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);

    let dept, company;
    for (let idx = 0; idx < ids.length; idx++) {
      const cap = stmts.getCapItem.get(ids[idx]);
      if (!cap) continue;
      const checklistItem = stmts.getChecklistItem.get(cap.checklist_item_id);
      const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
      const plan = stmts.getAuditPlan.get(line.audit_plan_id);
      dept = stmts.getDepartment.get(plan.department_id);
      company = stmts.getCompany.get(dept.company_id);
      const logoRow = stmts.getCompanyLogo.get(company.id);
      const hasFiveWhy = cap.evaluation === 'L1' || cap.evaluation === 'L2';
      const fiveWhy = hasFiveWhy ? stmts.getFiveWhyByCapItem.get(cap.id) : null;
      const evidenceFiles = stmts.getEvidenceFilesByCapItem.all(cap.id);
      if (idx > 0) doc.addPage();
      renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, evidenceFiles, startY: 50 });
    }
    addPdfFooter(doc);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), dept, company }));
    doc.end();
  });
}

module.exports = { renderCapItemPdf, generateCapItemsPdfBuffer };
