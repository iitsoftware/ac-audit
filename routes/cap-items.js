const express = require('express');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { getCapDeadlineDays, calcCapDeadline } = require('../services/cap-deadlines');
const { snapshotCapItem } = require('../services/trash');
const { getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail } = require('../services/email');
const { renderCapItemPdf, generateCapItemsPdfBuffer, capHasFiveWhy } = require('../pdf/cap');
const { generateFiveWhyPdfBuffer } = require('../pdf/five-why');
const { addPdfFooter } = require('../pdf/common');
const { loadResource } = require('../middleware/load-resource');

const router = express.Router();

// Dateinamenskonvention der Einzeldokumente einer Beanstandung:
// <Präfix>_<Audit-Nr.>_<Stufe>.pdf — CAP-Bericht und Ursachenanalyse gehören zum
// selben Datensatz und müssen beim Empfänger nebeneinander zusammenpassen.
// Audit-Nr. und Stufe sind Nutzereingaben, daher entschärft, bevor sie in den
// Content-Disposition-Header wandern.
function capPdfFilename(prefix, cap) {
  const safe = value => String(value || '').replace(/[^a-zA-Z0-9]/g, '_');
  return `${prefix}_${cap.audit_no ? safe(cap.audit_no) : 'X'}_${safe(cap.evaluation)}.pdf`;
}

// Firmen-/Abteilungskontext einer Beanstandung fürs Audit-Log: cap_item hängt
// über checklist_item → line → plan an der Abteilung, also läuft jede Leserstelle
// denselben Weg. Jeder Schritt kann fehlen (Altbestand, halb gelöschte Kette), das
// Log ist deshalb best effort und liefert leere Strings statt zu werfen.
function capContext(checklistItemId) {
  const out = { companyName: '', deptName: '', lineName: '' };
  const checkItem = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?').get(checklistItemId);
  if (!checkItem) return out;
  const line = stmts.getAuditPlanLine.get(checkItem.audit_plan_line_id);
  if (!line) return out;
  out.lineName = line.subject || line.audit_no || '';
  const plan = stmts.getAuditPlan.get(line.audit_plan_id);
  if (!plan) return out;
  const dept = stmts.getDepartment.get(plan.department_id);
  if (!dept) return out;
  out.deptName = dept.name;
  const comp = stmts.getCompany.get(dept.company_id);
  if (comp) out.companyName = comp.name;
  return out;
}

// ── Recalculate all CAP deadlines (ORDER: before :id routes) ──
router.post('/api/cap-items/recalc-deadlines', (req, res) => {
  getCapDeadlineDays();
  const allCaps = db.prepare(
    `SELECT c.id, ci.evaluation, pl.performed_date, pl.audit_end_date
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE (c.completion_date IS NULL OR c.completion_date = '')`
  ).all();

  let updated = 0;
  const updateStmt = db.prepare(`UPDATE cap_item SET deadline = ?, updated_at = datetime('now') WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const cap of allCaps) {
      const baseDate = cap.performed_date || cap.audit_end_date;
      const dl = calcCapDeadline(cap.evaluation, baseDate);
      if (dl) {
        updateStmt.run(dl, cap.id);
        updated++;
      }
    }
  });
  tx();

  logAction('CAP-Fristen neu berechnet', 'cap_item', '', '', updated + ' von ' + allCaps.length + ' aktualisiert');
  res.json({ ok: true, updated, total: allCaps.length });
});

// ── Multi-select CAP Items PDF (ORDER: before :id routes) ──
router.get('/api/cap-items/pdf', (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="Corrective_Actions.pdf"');
  doc.pipe(res);

  const checklistStmt = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?');

  for (let idx = 0; idx < ids.length; idx++) {
    const cap = stmts.getCapItem.get(ids[idx]);
    if (!cap) continue;
    const checklistItem = checklistStmt.get(cap.checklist_item_id);
    const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    const dept = stmts.getDepartment.get(plan.department_id);
    const company = stmts.getCompany.get(dept.company_id);
    const logoRow = stmts.getCompanyLogo.get(company.id);
    const fiveWhy = capHasFiveWhy(cap) ? stmts.getFiveWhyByCapItem.get(cap.id) : null;
    // Die Maßnahmen lädt der Aufrufer, nicht der Renderer — dasselbe Muster wie beim
    // 5-Why-Satz: der Renderer joint nur, was er bekommt.
    const capActions = stmts.getCapActionsByCapItem.all(cap.id);
    const evidenceFiles = stmts.getEvidenceFilesByCapItem.all(cap.id);

    if (idx > 0) doc.addPage();
    renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, capActions, evidenceFiles, startY: 50 });
  }

  addPdfFooter(doc);
  doc.end();
});

// ── Send CAP items PDF via email (ORDER: before :id routes) ──
router.post('/api/cap-items/send-email', async (req, res) => {
  const { ids, to: toAddress, authority } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Keine CAP-Einträge ausgewählt' });

  let to = toAddress;
  if (authority && !to) {
    const firstCap = stmts.getCapItem.get(ids[0]);
    if (firstCap) {
      const ci = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?').get(firstCap.checklist_item_id);
      if (ci) {
        const ln = stmts.getAuditPlanLine.get(ci.audit_plan_line_id);
        if (ln) {
          const pl = stmts.getAuditPlan.get(ln.audit_plan_id);
          if (pl) {
            const dp = stmts.getDepartment.get(pl.department_id);
            if (dp && dp.authority_email) to = dp.authority_email;
          }
        }
      }
    }
  }
  if (!to) return res.status(400).json({ error: authority ? 'Keine Behörden-E-Mail in der Abteilung hinterlegt' : 'E-Mail-Adresse erforderlich' });

  try {
    const { buffer, dept, company } = await generateCapItemsPdfBuffer(ids);
    const qm = getQmForDepartment(company.id, dept.id);
    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    let subject, text;
    if (authority) {
      subject = `Corrective Action Plan – ${company.name} (${dept.name})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen den Corrective Action Plan der Abteilung ${dept.name} der ${company.name}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nCompliance Monitoring Manager\n${company.name}\n\n`;
    } else {
      subject = `Corrective Action Plan (${dept.name})`;
      text = `Hallo,\n\nanbei der Corrective Action Plan für die Abteilung ${dept.name} der ${company.name}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nCompliance Monitoring Manager\n${company.name}\n\n`;
    }
    await sendDocumentEmail({ module: 'audit', to, subject, text, filename: 'Corrective_Actions.pdf', buffer, qm,
      logParams: ['CAP per E-Mail gesendet', 'cap_item', '', `${ids.length} CAP-Einträge`, `An: ${to}${authority ? ' (Behörde)' : ''}`, company.name, dept.name] });
    res.json({ ok: true });
  } catch (e) {
    console.error('CAP send-email error:', e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ── CAP Item CRUD ────────────────────────────────────────
router.get('/api/cap-items/:id', (req, res) => {
  const row = stmts.getCapItem.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'CAP item not found' });
  res.json(row);
});

router.put('/api/cap-items/:id', (req, res) => {
  const b = req.body;
  const compDate = b.completion_date || null;
  stmts.updateCapItem.run(
    b.deadline || null, b.responsible_person || '', b.root_cause || '',
    b.corrective_action || '', b.preventive_action || '',
    compDate, b.evidence || '',
    compDate, compDate,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/api/cap-items/:id', (req, res) => {
  // Snapshot to trash before deleting
  try {
    const cap = snapshotCapItem(req.params.id);
    if (cap) {
      const { companyName, deptName, lineName } = capContext(cap.checklist_item_id);
      stmts.createTrashItem.run(uuidv4(), 'cap_item', req.params.id, lineName, companyName, deptName, cap.checklist_item_id, 'audit_checklist_item', JSON.stringify(cap));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteCapItem.run(req.params.id);
  res.status(204).end();
});

// ── CAP Item PDF (single) ────────────────────────────────
router.get('/api/cap-items/:id/pdf', (req, res) => {
  const cap = stmts.getCapItem.get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'CAP item not found' });

  const checklistItem = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?').get(cap.checklist_item_id);
  const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
  const plan = stmts.getAuditPlan.get(line.audit_plan_id);
  const dept = stmts.getDepartment.get(plan.department_id);
  const company = stmts.getCompany.get(dept.company_id);
  const logoRow = stmts.getCompanyLogo.get(company.id);
  const fiveWhy = capHasFiveWhy(cap) ? stmts.getFiveWhyByCapItem.get(cap.id) : null;
  const capActions = stmts.getCapActionsByCapItem.all(cap.id);
  const evidenceFiles = stmts.getEvidenceFilesByCapItem.all(cap.id);

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${capPdfFilename('CAP', cap)}"`);
  doc.pipe(res);

  renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, capActions, evidenceFiles, startY: 50 });
  addPdfFooter(doc);
  doc.end();
});

// ── Five-Why Analysis ────────────────────────────────────
router.get('/api/cap-items/:id/five-why', (req, res) => {
  const row = stmts.getFiveWhyByCapItem.get(req.params.id);
  res.json(row || null);
});

router.put('/api/cap-items/:id/five-why', (req, res) => {
  const { why1, why2, why3, why4, why5, root_cause } = req.body;
  const existing = stmts.getFiveWhyByCapItem.get(req.params.id);
  if (existing) {
    stmts.updateFiveWhy.run(why1 || '', why2 || '', why3 || '', why4 || '', why5 || '', root_cause || '', req.params.id);
  } else {
    stmts.createFiveWhy.run(uuidv4(), req.params.id, why1 || '', why2 || '', why3 || '', why4 || '', why5 || '', root_cause || '');
  }
  // Sync root_cause to cap_item
  const capItem = stmts.getCapItem.get(req.params.id);
  if (capItem) {
    const compDate2 = capItem.completion_date || null;
    stmts.updateCapItem.run(
      capItem.deadline || null, capItem.responsible_person || '', root_cause || '',
      capItem.corrective_action || '', capItem.preventive_action || '',
      compDate2, capItem.evidence || '',
      compDate2, compDate2,
      req.params.id
    );
  }
  res.json(stmts.getFiveWhyByCapItem.get(req.params.id));
});

// Eigenständiges CM-002-Formular der Beanstandung — das zweite Dokument zum selben
// Datensatz neben dem CM-003-CAP-Bericht. Alles, was das Formular braucht (five_why,
// Abteilung, Firma, Logo und den QM als Unterzeichner), liest
// generateFiveWhyPdfBuffer() selbst, damit Download und ein späterer Versand nicht
// auseinanderlaufen können. Ein fehlender five_why-Datensatz ist dabei kein Fehler,
// sondern das leere, von Hand ausfüllbare Formular — die Papierpraxis der Behörde.
router.get('/api/cap-items/:id/five-why/pdf',
  loadResource('getCapItem', 'id', 'CAP item not found'),
  async (req, res) => {
    const cap = req.resource;
    try {
      const { buffer, dept, company } = await generateFiveWhyPdfBuffer(cap.id);
      logAction('Ursachenanalyse exportiert', 'cap_item', cap.id,
        `${cap.audit_no || ''} ${cap.evaluation || ''}`.trim(), 'CM-002 PDF',
        company ? company.name : '', dept ? dept.name : '');
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${capPdfFilename('Ursachenanalyse', cap)}"`);
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

// ── CAP Actions (die n Maßnahmen einer Beanstandung) ─────
// Sie hängen am CAP-Item, nicht am audit_checklist_item, und ON DELETE CASCADE
// räumt sie mit der Beanstandung ab. /api/cap-actions/:id ist ein eigener Pfad und
// kollidiert deshalb nicht mit der Batch-vor-:id-Regel von /api/cap-items/pdf.
// Ein kind außerhalb dieser zwei Werte wird abgewiesen statt gespeichert: eine
// dritte Gruppe würde die Gruppierung und die daraus abgeleitete laufende Nummer
// zerlegen, die nirgends gespeichert ist.
const CAP_ACTION_KINDS = ['CORRECTIVE', 'PREVENTIVE'];

// Log-Zeile einer Maßnahme: Kontext, Beschriftung und Detailtext sind fürs
// Anlegen, Ändern und Löschen dieselben, also steht der Weg zum CAP-Item genau
// einmal hier. Die Beschreibung ist Freitext beliebiger Länge — das Log braucht
// nur ihren Anfang. `cap` reicht durch, wer die Beanstandung ohnehin geladen hat.
function logCapAction(verb, action, cap) {
  const capItem = cap || stmts.getCapItem.get(action.cap_item_id);
  const { companyName, deptName } = capItem
    ? capContext(capItem.checklist_item_id)
    : { companyName: '', deptName: '' };
  const desc = (action.description || '').trim();
  const finding = capItem ? `${capItem.audit_no || ''} ${capItem.evaluation || ''}`.trim() : '';
  logAction(`Maßnahme ${verb}`, 'cap_action', action.id,
    desc.length > 60 ? desc.slice(0, 60) + '…' : desc,
    finding ? `${action.kind} — ${finding}` : action.kind,
    companyName, deptName);
}

router.get('/api/cap-items/:id/actions',
  loadResource('getCapItem', 'id', 'CAP item not found'),
  (req, res) => {
    res.json(stmts.getCapActionsByCapItem.all(req.params.id));
  });

router.post('/api/cap-items/:id/actions',
  loadResource('getCapItem', 'id', 'CAP item not found'),
  (req, res) => {
    const b = req.body;
    const kind = b.kind || 'CORRECTIVE';
    if (!CAP_ACTION_KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind' });

    // sort_order zählt innerhalb der eigenen kind-Gruppe: getMaxCapActionSortOrder
    // liefert für eine leere Gruppe -1, die erste Maßnahme bekommt also 0.
    const { max_sort } = stmts.getMaxCapActionSortOrder.get(req.params.id, kind);
    const id = uuidv4();
    stmts.createCapAction.run(
      id, req.params.id, max_sort + 1, kind,
      b.description || '', b.responsible_person || '',
      b.target_date || null, b.completion_date || null
    );

    const action = stmts.getCapAction.get(id);
    logCapAction('angelegt', action, req.resource);
    res.status(201).json(action);
  });

// Partielles Update wie PUT /api/sms-meetings/:id — ausgelassene Felder behalten
// ihren Wert. Ein leerer String bei den Datumsfeldern räumt dagegen auf NULL,
// dieselbe Konvention wie bei cap_item.deadline.
router.put('/api/cap-actions/:id',
  loadResource('getCapAction', 'id', 'CAP action not found'),
  (req, res) => {
    const b = req.body;
    const existing = req.resource;
    const kind = b.kind !== undefined ? b.kind : existing.kind;
    if (!CAP_ACTION_KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind' });

    stmts.updateCapAction.run(
      b.sort_order !== undefined ? b.sort_order : existing.sort_order,
      kind,
      b.description !== undefined ? b.description : existing.description,
      b.responsible_person !== undefined ? b.responsible_person : existing.responsible_person,
      b.target_date !== undefined ? (b.target_date || null) : existing.target_date,
      b.completion_date !== undefined ? (b.completion_date || null) : existing.completion_date,
      req.params.id
    );

    const action = stmts.getCapAction.get(req.params.id);
    logCapAction('geändert', action);
    res.json(action);
  });

router.delete('/api/cap-actions/:id',
  loadResource('getCapAction', 'id', 'CAP action not found'),
  (req, res) => {
    // Kein Nachziehen der sort_order: die gedruckte Nummer ist der Index in der
    // sortierten Liste und bleibt dadurch von selbst lückenlos 1..n.
    stmts.deleteCapAction.run(req.params.id);
    logCapAction('gelöscht', req.resource);
    res.status(204).end();
  });

// ── CAP Evidence Files ───────────────────────────────────
router.get('/api/cap-items/:id/evidence-files', (req, res) => {
  res.json(stmts.getEvidenceFilesByCapItem.all(req.params.id));
});

router.post('/api/cap-items/:id/evidence-files', (req, res) => {
  const { filename, mime_type, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data is required' });
  const id = uuidv4();
  const buf = Buffer.from(data, 'base64');
  stmts.createEvidenceFile.run(id, req.params.id, filename || '', mime_type || 'image/png', buf);
  res.status(201).json({ id, filename, mime_type });
});

router.get('/api/evidence-files/:id', (req, res) => {
  const row = stmts.getEvidenceFile.get(req.params.id);
  if (!row || !row.data) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', row.mime_type || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.data);
});

router.delete('/api/evidence-files/:id', (req, res) => {
  stmts.deleteEvidenceFile.run(req.params.id);
  res.status(204).end();
});

module.exports = router;
