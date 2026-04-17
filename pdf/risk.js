const { stmts } = require('../db');
const { formatDateDE } = require('../services/audit-log');

function computeRiskScore(p, s) {
  if (!p || !s) return { score: null, level: '' };
  const score = p * s;
  let level = 'Gering oder kein Risiko';
  if (score >= 12) level = 'Nicht akzeptabel';
  else if (score >= 4) level = 'Akzeptabel';
  return { score, level };
}

function riskColor(score) {
  if (score >= 12) return '#ef4444';
  if (score >= 4) return '#eab308';
  return '#22c55e';
}

function riskLabel(score) {
  if (score >= 12) return 'Nicht akzeptabel';
  if (score >= 4) return 'Akzeptabel';
  return 'Gering oder kein Risiko';
}

function renderRiskAnalysisPdf(doc, { ra, cr, dept, company, logoRow, items, qm }) {
  const marginL = 40;
  const maxY = 540; // page break threshold (landscape A4 height ~595, minus footer)
  let y = 40;

  // ── Header (like audit plans) ──
  if (logoRow && logoRow.logo) {
    try { doc.image(logoRow.logo, marginL, y, { height: 50 }); y += 60; } catch { /* skip */ }
  }
  doc.fontSize(16).font('Helvetica-Bold').text(company ? company.name : '', marginL, y);
  y += 25;
  doc.fontSize(10).font('Helvetica');
  let subLine = dept ? dept.name : '';
  if (dept && dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept && dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, marginL, y);
  y += 30;

  // ── Title ──
  doc.fontSize(14).font('Helvetica-Bold').text('Risikoanalyse: ' + (ra.title || ''), marginL, y);
  y += 18;
  if (cr) { doc.fontSize(9).font('Helvetica').text(cr.change_no + (cr.title ? ' – ' + cr.title : ''), marginL, y); y += 15; }
  y += 10;

  // ── Table ──
  const pageW = doc.page.width;
  const fullTableW = pageW - marginL - 40; // use full width between margins
  const baseCols = [
    { key: 'nr', label: 'Nr.', w: 22 },
    { key: 'risk_type', label: 'Risikotyp', w: 52 },
    { key: 'description', label: 'Beschreibung', w: 85 },
    { key: 'consequence', label: 'Auswirkung', w: 85 },
    { key: 'ip', label: 'W', w: 16 }, { key: 'is', label: 'S', w: 16 }, { key: 'ic', label: '', w: 16 },
    { key: 'responsible', label: 'Verantwortlich', w: 65 },
    { key: 'mitigation', label: 'Maßnahme', w: 75 },
    { key: 'treatment', label: 'Behandlung', w: 85 },
    { key: 'rp', label: 'W', w: 16 }, { key: 'rs', label: 'S', w: 16 }, { key: 'rc', label: '', w: 16 },
    { key: 'next_step', label: 'Nächster Schritt', w: 96 },
  ];
  // Scale columns to fill full width
  const baseW = baseCols.reduce((s, c) => s + c.w, 0);
  const scale = fullTableW / baseW;
  const cols = baseCols.map(c => ({ ...c, w: Math.round(c.w * scale) }));
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const anfX = cols.slice(0, 4).reduce((s, c) => s + c.w, marginL);
  const anfW = cols[4].w + cols[5].w + cols[6].w;
  const restX = cols.slice(0, 10).reduce((s, c) => s + c.w, marginL);
  const restW = cols[10].w + cols[11].w + cols[12].w;

  // Reusable table header renderer
  function drawTableHeader() {
    doc.fontSize(7).font('Helvetica-Bold');
    // Group headers with blue background
    doc.rect(anfX, y, anfW, 10).fill('#2563eb');
    doc.fillColor('#fff').text('Anfangsrisiko', anfX + 2, y + 2, { width: anfW - 4 });
    doc.rect(restX, y, restW, 10).fill('#2563eb');
    doc.fillColor('#fff').text('Restrisiko', restX + 2, y + 2, { width: restW - 4 });
    doc.fillColor('#000');
    y += 12;
    doc.rect(marginL, y, tableW, 13).fill('#2563eb'); doc.fillColor('#fff');
    let x = marginL;
    for (const col of cols) { doc.text(col.label, x + 2, y + 3, { width: col.w - 4 }); x += col.w; }
    doc.fillColor('#000');
    y += 15;
    doc.font('Helvetica').fontSize(6.5);
  }

  drawTableHeader();

  // Data rows with dynamic height
  const textCols = ['description', 'consequence', 'responsible', 'mitigation', 'treatment', 'next_step', 'risk_type'];

  items.forEach((item, idx) => {
    const vals = {
      nr: String(idx + 1), risk_type: item.risk_type || '', description: item.description || '',
      consequence: item.consequence || '', ip: String(item.initial_probability || ''),
      is: String(item.initial_severity || ''), ic: '', responsible: item.responsible_person || '',
      mitigation: item.mitigation_topic || '', treatment: item.treatment || '',
      rp: String(item.residual_probability || ''), rs: String(item.residual_severity || ''),
      rc: '', next_step: item.next_step || '',
    };

    // Compute row height
    let maxH = 14;
    for (const col of cols) {
      if (textCols.includes(col.key) && vals[col.key]) {
        const h = doc.heightOfString(vals[col.key], { width: col.w - 4, fontSize: 6.5 });
        if (h + 6 > maxH) maxH = h + 6;
      }
    }
    maxH = Math.min(maxH, 80);

    // Page break with repeated header
    if (y + maxH > maxY) {
      doc.addPage();
      y = 40;
      drawTableHeader();
    }

    // Zebra stripe
    if (idx % 2 === 0) doc.rect(marginL, y, tableW, maxH).fill('#f8fafc').fillColor('#000');
    doc.moveTo(marginL, y + maxH).lineTo(marginL + tableW, y + maxH).strokeColor('#e2e8f0').lineWidth(0.3).stroke();

    let x = marginL;
    for (const col of cols) {
      if (col.key === 'ic' && item.initial_score) {
        doc.rect(x + 3, y + 2, 10, 10).fill(riskColor(item.initial_score)).fillColor('#000');
      } else if (col.key === 'rc' && item.residual_score) {
        doc.rect(x + 3, y + 2, 10, 10).fill(riskColor(item.residual_score)).fillColor('#000');
      } else {
        doc.text(String(vals[col.key]), x + 2, y + 3, { width: col.w - 4, height: maxH - 4 });
      }
      x += col.w;
    }
    y += maxH;
  });

  y += 20;

  // ── Overall Risk + Signature + Matrix Legend ──
  // Ensure the entire footer block fits: overall risk + signature + matrix (~300pt)
  if (y + 300 > maxY) { doc.addPage(); y = 40; }
  const footerStartY = y;
  const maxInitScore = Math.max(0, ...items.map(i => i.initial_score || 0));
  const maxResScore = Math.max(0, ...items.map(i => i.residual_score || 0));

  doc.fontSize(9).font('Helvetica-Bold');
  if (maxInitScore > 0) {
    doc.rect(marginL, y, 12, 12).fill(riskColor(maxInitScore)).fillColor('#000');
    doc.text(`  Gesamt-Anfangsrisiko: ${riskLabel(maxInitScore)}`, marginL + 16, y + 1);
    y += 18;
  }
  if (maxResScore > 0) {
    doc.rect(marginL, y, 12, 12).fill(riskColor(maxResScore)).fillColor('#000');
    doc.text(`  Gesamt-Restrisiko: ${riskLabel(maxResScore)}`, marginL + 16, y + 1);
    y += 18;
  }
  y += 30;

  // ── Signature block ──
  const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : (ra.safety_manager || '');

  // Ort, Datum above signature
  doc.fontSize(9).font('Helvetica');
  doc.text(`${company ? company.city || '' : ''}, ${formatDateDE(new Date().toISOString().slice(0, 10))}`, marginL, y);
  y += 20;

  // Signature image
  if (qm) {
    const sigRow = stmts.getPersonSignature.get(qm.id);
    if (sigRow && sigRow.signature) {
      try { doc.image(sigRow.signature, marginL, y, { height: 40 }); y += 45; } catch { /* skip */ }
    }
  }

  // Line
  doc.moveTo(marginL, y).lineTo(marginL + 200, y).strokeColor('#000').lineWidth(0.5).stroke();
  y += 5;
  doc.fontSize(9).font('Helvetica');
  doc.text(qmName, marginL, y);
  y += 12;
  doc.text('Safety Manager', marginL, y);

  // ── Risk Matrix Legend (right side, matching XLSX layout) ──
  const matrixRight = marginL + tableW; // align with table right edge
  const matrixLeft = pageW / 2 + 20;
  const availW = matrixRight - matrixLeft;
  const labelW = Math.round(availW * 0.35); // space for row labels + factor
  const gridW = availW - labelW;
  const cellSz = Math.floor(gridW / 5);
  const gridX = matrixLeft + labelW;
  let my = footerStartY;

  const probLabels = ['häufig', 'gelegentlich', 'gering', 'unwahrscheinlich', 'extrem\nunwahrscheinlich'];
  const sevLabels = ['geringfügig', 'gering', 'bedeutend', 'gefährlich', 'katastrophal'];
  const probFactors = [5, 4, 3, 2, 1];
  const sevFactors = [1, 2, 3, 4, 5];

  // "Risikoschwere" header
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('Risikoschwere', gridX, my, { width: cellSz * 5, align: 'center' });
  my += 12;

  // Severity column labels
  doc.fontSize(6.5).font('Helvetica');
  for (let s = 0; s < 5; s++) {
    doc.text(sevLabels[s], gridX + s * cellSz, my, { width: cellSz, align: 'center' });
  }
  my += 10;

  // "Faktor" row
  doc.fontSize(7).font('Helvetica-Bold');
  doc.text('Faktor', matrixLeft, my + 1, { width: labelW - 5, align: 'right' });
  for (let s = 0; s < 5; s++) {
    doc.text(String(sevFactors[s]), gridX + s * cellSz, my + 1, { width: cellSz, align: 'center' });
  }
  my += 14;

  // "Risikowahrscheinlichkeit" vertical label — positioned 1 char before "unwahrscheinlich"
  doc.save();
  doc.fontSize(6.5).font('Helvetica');
  const matrixTotalH = cellSz * 5;
  const unwWidth = doc.widthOfString('unwahrscheinlich', { fontSize: 6.5 });
  doc.fontSize(7).font('Helvetica-Bold');
  const labelX = gridX - 14 - unwWidth - 4; // factor col - "unwahrscheinlich" width - 1 char
  doc.translate(labelX, my + matrixTotalH / 2 + 40);
  doc.rotate(-90);
  doc.text('Risikowahrscheinlichkeit', -40, 0, { width: matrixTotalH, align: 'center' });
  doc.restore();

  // Matrix rows
  for (let p = 0; p < 5; p++) {
    // Row label + factor
    doc.fontSize(6.5).font('Helvetica');
    doc.text(probLabels[p], matrixLeft + 10, my + (cellSz - 8) / 2, { width: labelW - 22, align: 'right', lineGap: 0 });
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text(String(probFactors[p]), gridX - 12, my + (cellSz - 8) / 2, { width: 10, align: 'center' });

    // Score cells
    for (let s = 0; s < 5; s++) {
      const score = probFactors[p] * sevFactors[s];
      const color = riskColor(score);
      doc.rect(gridX + s * cellSz, my, cellSz, cellSz).fill(color);
      doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
      doc.text(String(score), gridX + s * cellSz, my + (cellSz - 9) / 2, { width: cellSz, align: 'center' });
      doc.fillColor('#000');
    }
    // Cell borders
    for (let s = 0; s <= 5; s++) {
      doc.moveTo(gridX + s * cellSz, my).lineTo(gridX + s * cellSz, my + cellSz).strokeColor('#ffffff').lineWidth(1).stroke();
    }
    doc.moveTo(gridX, my).lineTo(gridX + cellSz * 5, my).strokeColor('#ffffff').lineWidth(1).stroke();
    my += cellSz;
  }
  // Bottom border
  doc.moveTo(gridX, my).lineTo(gridX + cellSz * 5, my).strokeColor('#ffffff').lineWidth(1).stroke();

  // Legend (under matrix, one line)
  my += 8;
  let lx = gridX;
  doc.fontSize(7).font('Helvetica');
  [{ color: '#ef4444', label: 'Nicht akzeptabel' },
   { color: '#eab308', label: 'Akzeptabel' },
   { color: '#22c55e', label: 'Gering oder kein Risiko' }].forEach(entry => {
    doc.rect(lx, my, 10, 10).fill(entry.color).fillColor('#000');
    const tw = doc.widthOfString(entry.label, { fontSize: 7 });
    doc.text(entry.label, lx + 13, my + 1);
    lx += 13 + tw + 12;
  });
}

module.exports = { computeRiskScore, riskColor, riskLabel, renderRiskAnalysisPdf };
