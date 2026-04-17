const AdmZip = require('adm-zip');

// ── XLSX checklist parsing helpers ─────────────────────────────
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(epoch.getTime() + serial * 86400000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function findInRow(row, label) {
  if (!row) return null;
  for (let i = 0; i < row.length; i++) {
    if (row[i] && String(row[i]).trim().toLowerCase().startsWith(label.toLowerCase())) {
      // Check if label cell itself contains the value after ":"
      const cellVal = String(row[i]).trim();
      const colonIdx = cellVal.indexOf(':');
      if (colonIdx >= 0) {
        const after = cellVal.substring(colonIdx + 1).trim();
        if (after) return after;
      }
      // Otherwise return next non-null value (but stop at the next label containing ":")
      for (let j = i + 1; j < row.length; j++) {
        if (row[j] == null || String(row[j]).trim() === '') continue;
        const val = String(row[j]).trim();
        if (val.includes(':')) return null; // next label reached, field is empty
        return row[j];
      }
      return null;
    }
  }
  return null;
}

function normalizeEval(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (s === 'C' || s === 'NA' || s === 'O') return s;
  if (/^level\s*1$/i.test(s) || s === 'L1') return 'L1';
  if (/^level\s*2$/i.test(s) || s === 'L2') return 'L2';
  if (/^level\s*3$/i.test(s) || s === 'L3') return 'L3';
  return s;
}

function parseAuditChecklist(rows) {
  const meta = {};
  // Row 0: Audit Subject
  meta.audit_subject = findInRow(rows[0], 'Audit Subject') || '';
  // Row 2: Audit No, Audit Title
  meta.audit_no = findInRow(rows[2], 'Audit No') || '';
  meta.audit_title = findInRow(rows[2], 'Audit Title') || '';
  // Row 6: Auditor Team, Auditee, Audit Start Date
  meta.auditor_team = findInRow(rows[6], 'Auditor Team') || '';
  meta.auditee = findInRow(rows[6], 'Auditee') || '';
  const startRaw = findInRow(rows[6], 'Audit Start Date');
  meta.audit_start_date = typeof startRaw === 'number' ? excelDateToISO(startRaw) : null;
  // Row 8: Location, Document Ref, Iss/Rev, Rev Date, Audit End Date
  meta.audit_location = findInRow(rows[8], 'Location') || '';
  meta.document_ref = findInRow(rows[8], 'Document Ref') || '';
  meta.document_iss_rev = findInRow(rows[8], 'Iss/Rev') || '';
  const revDateRaw = findInRow(rows[8], 'Rev. Date');
  meta.document_rev_date = typeof revDateRaw === 'number' ? excelDateToISO(revDateRaw) : null;
  const endRaw = findInRow(rows[8], 'Audit End Date');
  meta.audit_end_date = typeof endRaw === 'number' ? excelDateToISO(endRaw) : null;

  // Parse sections and items
  const items = [];
  let currentSection = null;
  let itemOrder = 0;

  for (let i = 10; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const firstCell = row[0] != null ? String(row[0]).trim() : '';
    // Detect section headers
    if (/^theoretical/i.test(firstCell)) { currentSection = 'THEORETICAL'; continue; }
    if (/^practical/i.test(firstCell)) { currentSection = 'PRACTICAL'; continue; }
    if (/^procedure/i.test(firstCell)) { currentSection = 'PROCEDURE'; continue; }
    if (/^recommendation\s+for\s+management/i.test(firstCell)) {
      // Next non-empty row is the recommendation text (skip signature header rows)
      const sigPattern = /\b(date|signature|accountable\s+manager|maintenance\s+manager)\b/i;
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[j]) {
          const recText = rows[j].filter(c => c != null).map(c => String(c).trim()).filter(Boolean).join(' ');
          if (recText) {
            if (sigPattern.test(recText)) break; // reached signature block, no recommendation
            meta.recommendation = recText;
            break;
          }
        }
      }
      break; // done parsing items
    }

    // Skip header rows (Nr.: / Regulation ref.: etc.)
    if (/^nr/i.test(firstCell)) continue;

    // Parse checklist item: must have a number-like value in col 0
    if (currentSection && firstCell && /^\d/.test(firstCell)) {
      const regRef = row[2] != null ? String(row[2]).trim() : '';
      const compCheck = row[8] != null ? String(row[8]).trim() : '';
      const evalVal = normalizeEval(row[26]);
      const comment = row[29] != null ? String(row[29]).trim() : '';
      const docRef = row[42] != null ? String(row[42]).trim() : '';
      // Skip empty rows that only have a number
      if (!regRef && !compCheck && !evalVal && !comment && !docRef) continue;
      itemOrder++;
      items.push({
        section: currentSection,
        sort_order: itemOrder,
        regulation_ref: regRef,
        compliance_check: compCheck,
        evaluation: evalVal,
        auditor_comment: comment,
        document_ref: docRef,
      });
    }
  }

  return { meta, items };
}

// ── DOCX audit plan parsing helpers ───────────────────────────
function decodeXml(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Parse cells from a row: extract w:tc elements, then collect w:t text per cell
function parseCells(rowXml) {
  const cells = [];
  const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
  let cellMatch;
  while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
    const cellXml = cellMatch[1];
    // Collect all w:t text, but separate by w:p (paragraphs) with newlines
    const paragraphs = [];
    const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pMatch;
    while ((pMatch = pRegex.exec(cellXml)) !== null) {
      const texts = [];
      const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let tMatch;
      while ((tMatch = tRegex.exec(pMatch[1])) !== null) {
        texts.push(decodeXml(tMatch[1]));
      }
      paragraphs.push(texts.join(''));
    }
    cells.push(paragraphs.join('\n').trim());
  }
  return cells;
}

// Parse date: DD.MM.YYYY → YYYY-MM-DD
function parseDateDE(str) {
  if (!str || !str.trim()) return null;
  const m = str.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Parse a .docx buffer containing an audit plan table.
// Throws Error with `.statusCode` when the structure is invalid.
function parseAuditPlanDocx(buffer) {
  const zip = new AdmZip(buffer);
  const docEntry = zip.getEntry('word/document.xml');
  if (!docEntry) {
    const err = new Error('Keine word/document.xml in der .docx Datei gefunden');
    err.statusCode = 400;
    throw err;
  }

  const xml = docEntry.getData().toString('utf8');

  // Extract first table
  const tblMatch = xml.match(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/);
  if (!tblMatch) {
    const err = new Error('Keine Tabelle in der .docx Datei gefunden');
    err.statusCode = 400;
    throw err;
  }

  const tblXml = tblMatch[0];

  // Extract rows
  const rows = [];
  const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
    rows.push(rowMatch[0]);
  }

  if (rows.length < 2) {
    const err = new Error('Tabelle hat keine Datenzeilen');
    err.statusCode = 400;
    throw err;
  }

  // Skip header row (index 0), parse data rows
  const lines = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCells(rows[i]);
    if (cells.length < 4) continue;

    const sortOrder = parseInt(cells[0], 10) || i;
    const subject = cells[1] || '';
    const regulations = cells[2] || '';
    const plannedWindow = cells[3] || '';
    const performedDate = cells.length > 4 ? parseDateDE(cells[4]) : null;
    // cells[5] = Findings → ignored
    const signature = cells.length > 6 ? (cells[6] || '') : '';

    if (!subject.trim()) continue;

    lines.push({ sortOrder, subject, regulations, plannedWindow, performedDate, signature });
  }

  if (lines.length === 0) {
    const err = new Error('Keine Themenbereiche in der Tabelle gefunden');
    err.statusCode = 400;
    throw err;
  }

  // Detect year from performed dates or use current year
  let year = new Date().getFullYear();
  for (const line of lines) {
    if (line.performedDate) {
      const y = parseInt(line.performedDate.substring(0, 4), 10);
      if (y >= 2000 && y <= 2099) { year = y; break; }
    }
  }

  return { year, lines };
}

module.exports = {
  excelDateToISO,
  findInRow,
  normalizeEval,
  parseAuditChecklist,
  parseAuditPlanDocx,
};
