const XLSX = require('xlsx');
const { excelDateToISO } = require('./audit');

// Parses a .xlsx buffer describing a Change Management task list.
// Returns { tasks: [...], title } where each task is the raw parsed data,
// ready for insertion by the route handler.
function parseChangeTasksXlsx(fileBuffer) {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Detect layout: CAMO vs FB
  let headerRowIdx = -1;
  let isFB = false;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const rowStr = (rows[i] || []).map(c => String(c).toLowerCase()).join('|');
    if (rowStr.includes('prozesse') || rowStr.includes('maßnahmen') || rowStr.includes('massnahmen')) {
      headerRowIdx = i;
      isFB = rowStr.includes('bemerkungen') || rowStr.includes('verantwortlichkeit');
      break;
    }
  }

  if (headerRowIdx < 0) {
    const err = new Error('Konnte Spaltenüberschriften nicht finden');
    err.statusCode = 400;
    throw err;
  }

  // Extract header info from rows before header
  let importTitle = '';
  for (let i = 0; i < headerRowIdx; i++) {
    const firstCell = rows[i] && rows[i][0] ? String(rows[i][0]).trim() : '';
    if (firstCell && firstCell.length > 5 && !importTitle) importTitle = firstCell;
  }

  // Map column indices — process and measures are distinct fields
  const headerRow = rows[headerRowIdx].map(c => String(c).toLowerCase().trim());
  const colMap = {};
  headerRow.forEach((h, idx) => {
    if (h.includes('nr') && !colMap.nr) colMap.nr = idx;
    // "eingeleitete Maßnahmen" / "To Do" / "Bemerkungen" → measures (must check before process)
    if (h.includes('eingeleitete') || h.includes('to do') || h.includes('bemerkungen')) {
      colMap.measures = idx;
    }
    // "Prozesse" or standalone "Maßnahmen" (not "eingeleitete") → process
    else if ((h.includes('prozesse') || h.includes('maßnahmen') || h.includes('massnahmen')) && !colMap.process) {
      colMap.process = idx;
    }
    if (h.includes('sicherheitsbewertung')) colMap.safety_note = idx;
    if (h.includes('bereich')) colMap.area = idx;
    if (h.includes('verantwortlich') || h.includes('verantwortlichkeit')) colMap.responsible = idx;
    if (h.includes('datum') || h.includes('ziel')) colMap.target_date = idx;
    if (h.includes('erledigt') || h.includes('status')) colMap.completion = idx;
  });

  const tasks = [];
  let currentSectionHeader = '';
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c || String(c).trim() === '')) continue;

    const processVal = colMap.process != null ? String(row[colMap.process] || '').trim() : '';
    const areaVal = colMap.area != null ? String(row[colMap.area] || '').trim() : '';

    // Detect section header: row with text in first column but no process content
    if (processVal === '' && areaVal === '' && row[0] && String(row[0]).trim().length > 1) {
      const candidate = String(row[0]).trim();
      if (isNaN(candidate)) {
        currentSectionHeader = candidate;
        continue;
      }
    }

    // Skip empty process rows
    if (!processVal && !areaVal) continue;

    let targetDateVal = colMap.target_date != null ? row[colMap.target_date] : null;
    if (typeof targetDateVal === 'number') targetDateVal = excelDateToISO(targetDateVal);
    else if (targetDateVal) targetDateVal = null; // text dates not parsed

    let completionVal = colMap.completion != null ? row[colMap.completion] : null;
    if (typeof completionVal === 'number') completionVal = excelDateToISO(completionVal);
    else if (completionVal && String(completionVal).trim().toLowerCase() === 'erledigt') {
      completionVal = new Date().toISOString().slice(0, 10);
    } else completionVal = null;

    tasks.push({
      process: processVal,
      area: areaVal,
      safety_note: colMap.safety_note != null ? String(row[colMap.safety_note] || '').trim() : '',
      measures: colMap.measures != null ? String(row[colMap.measures] || '').trim() : '',
      responsible: colMap.responsible != null ? String(row[colMap.responsible] || '').trim() : '',
      target_date: targetDateVal,
      completion_date: completionVal,
      section_header: currentSectionHeader,
    });
  }

  return { tasks, title: importTitle, isFB };
}

module.exports = { parseChangeTasksXlsx };
