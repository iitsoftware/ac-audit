const XLSX = require('xlsx');
const { excelDateToISO } = require('./audit');
const { computeRiskScore } = require('../pdf/risk');

// Parses a .xlsx buffer describing a Change Management risk analysis.
// Returns { items: [...], history: [...], meta: { title, author, safety_manager, overall_initial, overall_residual, signed_at } }.
function parseRiskAnalysisXlsx(fileBuffer, fallbackTitle = '') {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });

  const findSheet = (patterns) => {
    for (const name of wb.SheetNames) {
      const lower = name.toLowerCase();
      for (const p of patterns) { if (lower.includes(p)) return wb.Sheets[name]; }
    }
    return null;
  };

  const historieSheet = findSheet(['historie', 'history', 'version']);
  const detailSheet = findSheet(['detail']);
  const mainSheet = detailSheet || wb.Sheets[wb.SheetNames[wb.SheetNames.length > 2 ? 2 : 0]];

  let raTitle = fallbackTitle;
  let raAuthor = '';
  let raSafetyManager = '';
  let overallInitial = '';
  let overallResidual = '';
  let signedAt = null;

  // Extract title from first row of detail sheet
  if (mainSheet) {
    const allRows = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
    if (allRows[0] && allRows[0][1]) raTitle = String(allRows[0][1]).trim();
    if (!raTitle && allRows[0] && allRows[0][0]) raTitle = String(allRows[0][0]).trim();
  }

  // ── Parse Historie ──
  const history = [];
  if (historieSheet) {
    const histRows = XLSX.utils.sheet_to_json(historieSheet, { header: 1, defval: '' });
    let hdrIdx = -1;
    for (let i = 0; i < Math.min(histRows.length, 10); i++) {
      const rowStr = histRows[i].map(c => String(c).toLowerCase()).join('|');
      if (rowStr.includes('version') && (rowStr.includes('datum') || rowStr.includes('autor'))) { hdrIdx = i; break; }
    }
    if (hdrIdx >= 0) {
      const hHdr = histRows[hdrIdx].map(c => String(c).toLowerCase().trim());
      const hColMap = {};
      hHdr.forEach((h, idx) => {
        if (h.includes('version') && !hColMap.version) hColMap.version = idx;
        if (h.includes('datum') || h.includes('date')) hColMap.date = idx;
        if (h.includes('autor') || h.includes('author')) hColMap.author = idx;
        if (h.includes('änderung') || h.includes('grund') || h.includes('bemerkung')) hColMap.reason = idx;
      });
      let histCount = 0;
      for (let i = hdrIdx + 1; i < histRows.length; i++) {
        const row = histRows[i];
        if (!row || row.every(c => !c || String(c).trim() === '')) continue;
        let ver = hColMap.version != null ? row[hColMap.version] : histCount + 1;
        if (typeof ver === 'string') ver = parseInt(ver) || histCount + 1;
        let dateVal = hColMap.date != null ? row[hColMap.date] : null;
        if (typeof dateVal === 'number') dateVal = excelDateToISO(dateVal);
        else dateVal = null;
        history.push({
          version: ver,
          version_date: dateVal,
          author: hColMap.author != null ? String(row[hColMap.author] || '').trim() : '',
          reason: hColMap.reason != null ? String(row[hColMap.reason] || '').trim() : '',
        });
        histCount++;
      }
    }
  }

  // ── Parse Detail sheet for risk items ──
  const items = [];
  if (mainSheet) {
    const detailRows = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });

    // Find header row containing "Risikotyp" or "Risiko-beschreibung"
    let dHdrIdx = -1;
    for (let i = 0; i < Math.min(detailRows.length, 15); i++) {
      const rowStr = detailRows[i].map(c => String(c).toLowerCase().replace(/[\s-]/g, '')).join('|');
      if (rowStr.includes('risikotyp') || rowStr.includes('risikobeschreibung')) { dHdrIdx = i; break; }
    }
    if (dHdrIdx < 0) {
      const err = new Error('Konnte Spaltenüberschriften nicht finden (Risikotyp/Risikobeschreibung)');
      err.statusCode = 400;
      throw err;
    }

    // Map columns by header text
    const dHdr = detailRows[dHdrIdx].map(c => String(c).toLowerCase().replace(/[\s-]/g, '').trim());
    const dColMap = {};
    const probCols = [];
    const sevCols = [];
    dHdr.forEach((h, idx) => {
      if ((h.includes('risikotyp') || h === 'typ') && dColMap.risk_type == null) dColMap.risk_type = idx;
      if (h.includes('risikobeschreibung') && dColMap.description == null) dColMap.description = idx;
      if (h.includes('auswirkung')) dColMap.consequence = idx;
      if (h.includes('wahrscheinlichkeit')) probCols.push(idx);
      if (h.includes('schwere')) sevCols.push(idx);
      if (h.includes('einbindung') || h.includes('verantwortlich')) dColMap.responsible = idx;
      if (h.includes('themadermassnahme') || (h.includes('thema') && h.includes('massnahme'))) dColMap.mitigation = idx;
      if (h.includes('behandlung')) dColMap.treatment = idx;
      if (h.includes('terminfür') || (h.includes('termin') && h.includes('umsetzung'))) dColMap.impl_date = idx;
      if (h.includes('nächster') || h.includes('nächsterschritt')) dColMap.next_step = idx;
    });
    if (probCols.length >= 2) { dColMap.init_prob = probCols[0]; dColMap.res_prob = probCols[1]; }
    else if (probCols.length === 1) dColMap.init_prob = probCols[0];
    if (sevCols.length >= 2) { dColMap.init_sev = sevCols[0]; dColMap.res_sev = sevCols[1]; }
    else if (sevCols.length === 1) dColMap.init_sev = sevCols[0];

    // Parse data rows — stop when we hit the embedded risk matrix or empty section
    for (let i = dHdrIdx + 1; i < detailRows.length; i++) {
      const row = detailRows[i];
      if (!row) continue;

      // Stop at embedded matrix (row starting with "Risiko" in lower columns without risk data)
      const col5Val = String(row[5] || '').toLowerCase();
      if (col5Val.includes('risikoschwere') || col5Val.includes('geringfügig')) break;

      // Skip empty rows
      const riskType = dColMap.risk_type != null ? String(row[dColMap.risk_type] || '').trim() : '';
      const desc = dColMap.description != null ? String(row[dColMap.description] || '').trim() : '';
      if (!desc && !riskType) continue;

      const initP = dColMap.init_prob != null ? parseInt(row[dColMap.init_prob]) || null : null;
      const initS = dColMap.init_sev != null ? parseInt(row[dColMap.init_sev]) || null : null;
      const resP = dColMap.res_prob != null ? parseInt(row[dColMap.res_prob]) || null : null;
      const resS = dColMap.res_sev != null ? parseInt(row[dColMap.res_sev]) || null : null;
      const ini = computeRiskScore(initP, initS);
      const residual = computeRiskScore(resP, resS);

      let implDate = dColMap.impl_date != null ? row[dColMap.impl_date] : null;
      if (typeof implDate === 'number') implDate = excelDateToISO(implDate);
      else if (implDate && typeof implDate === 'string' && implDate.trim()) implDate = null;
      else implDate = null;

      items.push({
        risk_type: riskType,
        description: desc,
        consequence: dColMap.consequence != null ? String(row[dColMap.consequence] || '').trim() : '',
        initial_probability: initP,
        initial_severity: initS,
        initial_score: ini.score,
        initial_level: ini.level,
        responsible_person: dColMap.responsible != null ? String(row[dColMap.responsible] || '').trim() : '',
        mitigation_topic: dColMap.mitigation != null ? String(row[dColMap.mitigation] || '').trim() : '',
        treatment: dColMap.treatment != null ? String(row[dColMap.treatment] || '').trim() : '',
        implementation_date: implDate,
        residual_probability: resP,
        residual_severity: resS,
        residual_score: residual.score,
        residual_level: residual.level,
        next_step: dColMap.next_step != null ? String(row[dColMap.next_step] || '').trim() : '',
      });
    }

    // Extract footer: Safety Manager, overall assessments
    for (let i = dHdrIdx + 1; i < detailRows.length; i++) {
      const row = detailRows[i];
      if (!row) continue;
      const rowStr = row.map(c => String(c).toLowerCase()).join('|');
      if (rowStr.includes('safety manager') || rowStr.includes('unterschrift')) {
        // Name is usually in column 9 or nearby
        for (let c = 5; c < row.length; c++) {
          const v = String(row[c] || '').trim();
          if (v && v.length > 2 && !v.match(/^\d/) && !v.toLowerCase().includes('datum')) { raSafetyManager = v; break; }
        }
        // Date in column 5
        if (typeof row[5] === 'number') {
          const signedDate = excelDateToISO(row[5]);
          if (signedDate) signedAt = signedDate;
        }
      }
      if (rowStr.includes('anfangsrisiko') || rowStr.includes('einschätzung anfangs')) {
        overallInitial = String(row[5] || '').trim();
      }
      if (rowStr.includes('nach der ma') || rowStr.includes('einschätzung risiko nach')) {
        overallResidual = String(row[5] || '').trim();
      }
    }
  }

  return {
    items,
    history,
    meta: {
      title: raTitle,
      author: raAuthor,
      safety_manager: raSafetyManager,
      overall_initial: overallInitial,
      overall_residual: overallResidual,
      signed_at: signedAt,
    },
  };
}

module.exports = { parseRiskAnalysisXlsx };
