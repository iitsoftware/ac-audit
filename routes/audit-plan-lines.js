const express = require('express');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { db, stmts } = require('../db');
const { logAction, formatDateDE } = require('../services/audit-log');
const { calcCapDeadline } = require('../services/cap-deadlines');
const { snapshotAuditPlanLine } = require('../services/trash');
const { authorityLineDefaults } = require('../services/audit-lines');
const { getQmForDepartment } = require('../services/email');
const { renderAuditLinePdf } = require('../pdf/audit');
const { addPdfFooter } = require('../pdf/common');
const { parseAuditChecklist } = require('../imports/audit');

const router = express.Router();

router.get('/api/audit-plans/:auditPlanId/lines', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.auditPlanId);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const rawLines = stmts.getAuditPlanLinesByPlan.all(req.params.auditPlanId);
  let needsRenumber = false;
  for (let i = 0; i < rawLines.length; i++) {
    if (String(rawLines[i].audit_no) !== String(i + 1)) { needsRenumber = true; break; }
  }
  if (needsRenumber) {
    const renumber = db.prepare('UPDATE audit_plan_line SET audit_no = ? WHERE id = ?');
    db.transaction(() => { rawLines.forEach((l, i) => renumber.run(String(i + 1), l.id)); })();
  }
  const lines = needsRenumber ? stmts.getAuditPlanLinesByPlan.all(req.params.auditPlanId) : rawLines;
  const counts = stmts.getChecklistCountsByPlan.all(req.params.auditPlanId);
  const countMap = {};
  for (const c of counts) countMap[c.audit_plan_line_id] = c;
  const evidenceCounts = stmts.getEvidenceCountsByPlan.all(req.params.auditPlanId);
  const evidenceMap = {};
  for (const e of evidenceCounts) evidenceMap[e.audit_plan_line_id] = e.evidence_count;
  for (const line of lines) {
    const c = countMap[line.id];
    line.checklist_count = c ? c.checklist_count : 0;
    line.finding_count = c ? c.finding_count : 0;
    line.observation_count = c ? c.observation_count : 0;
    line.evidence_count = evidenceMap[line.id] || 0;
  }
  res.json(lines);
});

router.post('/api/audit-plans/:auditPlanId/lines', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.auditPlanId);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const b = req.body;
  const id = uuidv4();
  const maxNo = stmts.getMaxAuditNo.get(req.params.auditPlanId);
  const auditNo = String((maxNo?.max_no || 0) + 1);

  // Behördenaudit: Behörde, zuständiger Bearbeiter und Auditee kommen aus
  // authorityLineDefaults() — aber nur, wenn der Body keines der drei Felder
  // mitschickt, sonst würde die Vorbelegung eine bewusste Eingabe überschreiben.
  let auditorTeam = b.auditor_team || '';
  let authorityAuditor = b.authority_auditor || '';
  let auditee = b.auditee || '';
  if (plan.plan_type === 'AUTHORITY' && !auditorTeam && !authorityAuditor && !auditee) {
    ({ auditorTeam, authorityAuditor, auditee } = authorityLineDefaults(stmts.getDepartment.get(plan.department_id)));
  }

  stmts.createAuditPlanLine.run(
    id, req.params.auditPlanId,
    b.sort_order || 0, b.subject || '', b.regulations || '', b.location || '', b.planned_window || '',
    auditNo, b.audit_subject || '', b.audit_title || '',
    // Das Berichtsdatum hat keine Vorbelegung — es steht im Schreiben der
    // Behörde und ist erst bekannt, wenn das Schreiben da ist. Wie die übrigen
    // Datumsspalten der Zeile kommt es leer als NULL an.
    auditorTeam, authorityAuditor, b.authority_report_date || null, auditee,
    b.audit_start_date || null, b.audit_end_date || null, b.audit_location || '',
    b.document_ref || '', b.document_iss_rev || '', b.document_rev_date || null,
    b.recommendation || '', b.audit_status || 'OPEN'
  );
  res.status(201).json(stmts.getAuditPlanLine.get(id));
});

// Alles, was das Blatt eines Behördenaudits über die Findingliste hinaus trägt:
// die CAP-Items des Berichts, je CAP die Ursachenanalyse und ihre Maßnahmen, die
// Fristen der Line, den QM als Unterzeichner des eingebetteten CM-002 und die
// Signaturbilder des CM-003-Unterschriftenblocks.
// Geladen wird es HIER und dem Renderer übergeben — der Renderer liest nichts
// selbst, dieselbe Hausregel, nach der routes/cap-items.js fiveWhy und capActions
// fürs CM-003 lädt. Beide PDF-Routen spreizen dasselbe Ergebnis in denselben
// renderAuditLinePdf()-Aufruf, statt die Ladeschritte zweimal auszuschreiben.
// `personsAll` kommt von dort mit herein, statt hier ein zweites Mal gelesen zu
// werden: beide Routen laden die Liste ohnehin und geben sie dem Renderer.
// Für interne Pläne bleibt es bei genau den Abfragen, die der Aufruf schon immer
// gemacht hat: die Funktion steigt am plan_type aus und gibt nichts zurück.
function authorityPdfData(line, plan, dept, company, personsAll) {
  if ((plan.plan_type || 'AUDIT') !== 'AUTHORITY') return {};

  // Wie loadLineData() im Frontend: die Abfrage liefert die CAPs des ganzen Plans,
  // gebraucht werden die dieses einen Berichts (ein Altbestand kann mehrere Lines
  // haben). Die Zeilen bringen compliance_check, regulation_ref und audit_no schon
  // mit — genau die drei, aus denen renderFiveWhyPdf() seinen Kopf schreibt.
  //
  // Ohne Gate auf capHasFiveWhy(): auf einem Behördenplan verlangt die Behörde die
  // Ursachenanalyse zu jedem Finding, das Prädikat wäre durchweg wahr, und ein CAP
  // ohne Satz ergibt das leere, von Hand ausfüllbare Formular statt eines Fehlers.
  const caps = {};
  for (const cap of stmts.getCapItemsByPlan.all(plan.id)) {
    if (cap.audit_plan_line_id !== line.id) continue;
    caps[cap.checklist_item_id] = {
      cap,
      fiveWhy: stmts.getFiveWhyByCapItem.get(cap.id) || null,
      capActions: stmts.getCapActionsByCapItem.all(cap.id),
    };
  }

  // Die Frist wird am CAP-Item gepflegt, gehört in der Findingliste aber in die
  // Zeile — eine Abfrage je Line statt eines CAP-Reads je Finding, genau wie
  // GET /api/audit-plan-lines/:lineId/checklist-items es fürs UI anreichert. Es ist
  // die EINE Karte für Übersichtstabelle und Findingseiten; hätte der Renderer sie
  // weiter selbst gelesen, liefe die Abfrage zweimal je Bogen.
  const deadlines = {};
  for (const c of stmts.getCapDeadlinesByLine.all(line.id)) deadlines[c.checklist_item_id] = c.deadline;

  // Unterzeichner des eingebetteten CM-002 — dieselbe Quelle, aus der
  // generateFiveWhyPdfBuffer() ihn zieht, damit eingebettetes und eigenständiges
  // Formular nicht verschiedene Namen tragen.
  const signer = getQmForDepartment(company.id, dept.id);

  // Die Bilder des CM-003-Unterschriftenblocks am Schluss des Bogens: QM,
  // Abteilungsleiter und Accountable Manager — dieselben drei Rollen und dieselbe
  // Quelle (stmts.getPersonSignature), aus denen der interne Zweig von
  // renderAuditLinePdf() seine Unterschriftenzeile zieht, nur eben hier gelesen.
  // Die PERSONEN reichen wir nicht mit: sie stehen dem Renderer über das
  // ohnehin übergebene personsAll schon zur Verfügung, ergänzt wird allein das
  // BLOB, das dort fehlt.
  //
  // Geschlüsselt wird deshalb nach person_id und nicht nach Rolle: so hängt das
  // Bild an genau der Zeile, deren Namen der Block druckt, und Name und
  // Unterschrift können nicht auseinanderlaufen, falls Route und Renderer bei
  // mehreren Trägern einer Rolle verschiedene Zeilen fänden. Für den QM ist das
  // ohnehin ausgeschlossen — getQmForDepartment() sucht mit demselben Prädikat
  // über dieselbe Liste.
  //
  // has_signature bringt getPersonsByCompany schon mit, ein Unterzeichner ohne
  // Unterschrift kostet also keinen BLOB-Read. Ein fehlender Schlüssel ist kein
  // Fehler, sondern der leere Unterschriftenkasten, den auch der interne Zweig
  // zeichnet, wenn die Person keine hinterlegt hat.
  const signatures = {};
  const signaturePersons = [
    signer,
    personsAll.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id),
    personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id),
  ];
  for (const person of signaturePersons) {
    if (!person || !person.has_signature || signatures[person.id]) continue;
    const sigRow = stmts.getPersonSignature.get(person.id);
    if (sigRow && sigRow.signature) signatures[person.id] = sigRow.signature;
  }

  return { caps, deadlines, signer, signatures };
}

// Fußzeile des Behördenblatts: sie benennt den Besuch, zu dem das Blatt gehört,
// wie CM-025 und CM-002 ihre Formularreferenz benennen. Zwei ausdrücklich in Kauf
// genommene Folgen:
//   - addPdfFooter() läuft über bufferedPageRange() und beschriftet ALLE Seiten
//     gleich, die eingebetteten CM-002-Seiten tragen hier also diesen Text statt
//     'CM-002, Grundursachenanalyse, Rev. 0, 28.08.2024'. Das ist gewollt — hier
//     sind sie Seiten eines Behördenberichts und keine eigenständigen Formulare;
//     die Formularreferenz bleibt dem Einzeldownload
//     GET /api/cap-items/:id/five-why/pdf, der sein eigenes doc hat. Eine Fußzeile
//     je Seitenbereich wäre ein zweiter addPdfFooter()-Vertrag für diesen einen
//     Bogen — mehr, als der Fall wert ist.
//   - Nur die Einzelroute ruft das hier: eine Mehrfachauswahl hat keinen EINEN
//     Besuch, dessen Behörde und Datum dort stehen könnten, die Batch-Route behält
//     also den Default 'Erstellt mit ac-audit'.
// Ohne Datum endet das Label bei der Behörde, statt ein leeres 'am ' zu drucken.
// Interne Pläne liefern null und bleiben beim Default.
function authorityFooterLabel(line, plan) {
  if ((plan.plan_type || 'AUDIT') !== 'AUTHORITY') return null;
  const date = formatDateDE(line.audit_end_date);
  return `Behördenaudit ${line.auditor_team || 'LBA'}${date ? ` am ${date}` : ''}`;
}

// Multi-select Audit Checklist PDF (must be before :id routes)
router.get('/api/audit-plan-lines/pdf', (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="Audit_Checklists.pdf"');
  doc.pipe(res);

  for (let idx = 0; idx < ids.length; idx++) {
    const line = stmts.getAuditPlanLine.get(ids[idx]);
    if (!line) continue;
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    if (!plan) continue;
    const dept = stmts.getDepartment.get(plan.department_id);
    if (!dept) continue;
    const company = stmts.getCompany.get(dept.company_id);
    if (!company) continue;
    const logoRow = stmts.getCompanyLogo.get(company.id);
    const checklistItems = stmts.getChecklistItemsByLine.all(line.id);
    const personsAll = stmts.getPersonsByCompany.all(company.id);

    if (idx > 0) doc.addPage();
    renderAuditLinePdf(doc, {
      line, plan, dept, company, logoRow, checklistItems, personsAll,
      ...authorityPdfData(line, plan, dept, company, personsAll),
      startY: 50,
    });
  }

  addPdfFooter(doc);
  doc.end();
});

// Audit Checklist PDF (Einzelaudit)
router.get('/api/audit-plan-lines/:id/pdf', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.id);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });

  const plan = stmts.getAuditPlan.get(line.audit_plan_id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });

  const dept = stmts.getDepartment.get(plan.department_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const company = stmts.getCompany.get(dept.company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const logoRow = stmts.getCompanyLogo.get(company.id);
  const checklistItems = stmts.getChecklistItemsByLine.all(line.id);
  const personsAll = stmts.getPersonsByCompany.all(company.id);

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="Audit_${line.audit_no || 'X'}_${(line.subject || 'Checklist').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
  doc.pipe(res);

  renderAuditLinePdf(doc, {
    line, plan, dept, company, logoRow, checklistItems, personsAll,
    ...authorityPdfData(line, plan, dept, company, personsAll),
    startY: 50,
  });
  const footerLabel = authorityFooterLabel(line, plan);
  addPdfFooter(doc, footerLabel ? { label: footerLabel } : {});
  doc.end();
});

router.get('/api/audit-plan-lines/:id', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.id);
  if (!line) return res.status(404).json({ error: 'Not found' });
  res.json(line);
});

router.put('/api/audit-plan-lines/:id', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  const b = req.body;
  // Der zuständige Bearbeiter der Behörde hat noch kein Eingabefeld: der Kopfblock
  // der Berichtsebene zeigt Behörde, Datum und Ort. Ein ausgelassenes Feld behält
  // deshalb seinen Wert, statt wie die übrigen Spalten auf '' zu fallen — sonst
  // löschte das erste Speichern die Vorbelegung aus authorityLineDefaults(). Ein
  // ausdrücklich mitgeschickter Wert (auch der leere) schreibt dagegen durch.
  const authorityAuditor = b.authority_auditor ?? existing.authority_auditor ?? '';
  // Dasselbe für das Berichtsdatum, und aus demselben Grund: das Datum des
  // Beanstandungsberichts steht nur im Kopfblock der Berichtsebene, jeder andere
  // Aufrufer dieser Route kennt das Feld nicht und löschte es sonst mit dem
  // nächsten Speichern. Auch hier schreibt ein ausdrücklich gesendeter Wert
  // durch — der leere String eingeschlossen.
  const authorityReportDate = b.authority_report_date ?? existing.authority_report_date ?? '';
  stmts.updateAuditPlanLine.run(
    b.sort_order || 0, b.subject || '', b.regulations || '', b.location || '', b.planned_window || '', b.signature || '',
    b.auditor_team || '', authorityAuditor, authorityReportDate, b.auditee || '',
    b.audit_start_date || null, b.audit_end_date || null, b.audit_location || '',
    b.document_ref || '', b.document_iss_rev || '', b.document_rev_date || null,
    b.recommendation || '',
    req.params.id
  );
  res.json(stmts.getAuditPlanLine.get(req.params.id));
});

router.patch('/api/audit-plan-lines/:id/performed', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  const { performed_date } = req.body;
  stmts.updateAuditPlanLinePerformed.run(performed_date || null, req.params.id);
  res.json(stmts.getAuditPlanLine.get(req.params.id));
});

router.delete('/api/audit-plan-lines/:id', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  try {
    const snapshot = snapshotAuditPlanLine(req.params.id);
    if (snapshot) {
      const plan = stmts.getAuditPlan.get(existing.audit_plan_id);
      const dept = plan ? stmts.getDepartment.get(plan.department_id) : null;
      const comp = dept ? stmts.getCompany.get(dept.company_id) : null;
      stmts.createTrashItem.run(uuidv4(), 'audit_plan_line', req.params.id, existing.subject || existing.audit_no || '', comp ? comp.name : '', dept ? dept.name : '', existing.audit_plan_id, 'audit_plan', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  const planId = existing.audit_plan_id;
  stmts.deleteAuditPlanLine.run(req.params.id);
  // Renumber remaining lines
  const remaining = stmts.getAuditPlanLinesByPlan.all(planId);
  const renumber = db.prepare(`UPDATE audit_plan_line SET audit_no = ? WHERE id = ?`);
  const renumberTx = db.transaction(() => {
    remaining.forEach((line, idx) => {
      renumber.run(String(idx + 1), line.id);
    });
  });
  renumberTx();
  res.status(204).end();
});

// Checklist items under audit-plan-lines
router.get('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });
  const items = stmts.getChecklistItemsByLine.all(req.params.lineId);
  const evCounts = stmts.getEvidenceCountsByLine.all(req.params.lineId);
  const evMap = {};
  for (const e of evCounts) evMap[e.checklist_item_id] = e.evidence_count;
  for (const item of items) item.evidence_count = evMap[item.id] || 0;
  // Die Frist wird am CAP-Item gepflegt, gehört in der Beanstandungsliste der
  // Behördenaudits aber in die Zeile — wie evidence_count hier angereichert,
  // damit die Tabelle nicht pro Zeile ein CAP-Item nachlädt.
  const capDeadlines = stmts.getCapDeadlinesByLine.all(req.params.lineId);
  const capMap = {};
  for (const c of capDeadlines) capMap[c.checklist_item_id] = c.deadline;
  for (const item of items) item.cap_deadline = capMap[item.id] || '';
  res.json(items);
});

router.post('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });
  const b = req.body;
  const id = uuidv4();
  // Die laufende Nummer wird vergeben, nicht abgeleitet: ohne mitgeschickte
  // sort_order zählt die Line weiter (max+1), wie die Maßnahmen eines Findings.
  // Ein ausdrücklich gesendeter Wert gewinnt — interne Audits schicken ihre
  // Sortierung aus dem Dialog und bleiben deshalb unverändert.
  const sortOrder = b.sort_order ?? (stmts.getMaxChecklistItemSortOrder.get(req.params.lineId).max_sort + 1);
  stmts.createChecklistItem.run(
    id, req.params.lineId,
    b.section || 'THEORETICAL', sortOrder,
    b.regulation_ref || '', b.compliance_check || '',
    b.evaluation || '', b.auditor_comment || '', b.document_ref || ''
  );
  const evalVal = b.evaluation || '';
  if (['O', 'L1', 'L2', 'L3'].includes(evalVal)) {
    // Fremdaudits bringen die Frist des Auditors mit — sie wird unverändert
    // übernommen. Ohne Angabe bleibt es bei der konfigurierten CAP-Regel.
    const dl = b.cap_deadline || calcCapDeadline(evalVal, line.performed_date);
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    const deptId = plan ? plan.department_id : null;
    stmts.createCapItem.run(uuidv4(), id, dl, '', '', '', '', 'OPEN', null, '', deptId, 'audit', null);
  }
  res.status(201).json(stmts.getChecklistItem.get(id));
});

// Bulk Import Audit XLSX per Audit Plan
router.post('/api/audit-plans/:id/import-audits', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });

  const { files, mappings } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }
  if (!mappings || typeof mappings !== 'object') {
    return res.status(400).json({ error: 'No mappings provided' });
  }

  const dept = stmts.getDepartment.get(plan.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  const fallbackCity = (company && company.city) || '';

  const planLines = stmts.getAuditPlanLinesByPlan.all(req.params.id);
  const matched = [];
  const skipped = [];

  const importAll = db.transaction(() => {
    for (const file of files) {
      const lineId = mappings[file.name];
      if (!lineId) {
        skipped.push({ filename: file.name });
        continue;
      }

      const line = planLines.find(l => l.id === lineId);
      if (!line) {
        skipped.push({ filename: file.name, error: 'Themenbereich nicht gefunden' });
        continue;
      }

      try {
        const buf = Buffer.from(file.data, 'base64');
        const wb = XLSX.read(buf, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        const { meta, items } = parseAuditChecklist(rows);

        stmts.updateAuditPlanLine.run(
          line.sort_order,
          line.subject,
          line.regulations || '',
          meta.audit_location || line.location || fallbackCity,
          line.planned_window || '',
          line.signature || '',
          meta.auditor_team || line.auditor_team || '',
          line.authority_auditor || '',
          // Das xlsx einer Checkliste kennt kein Berichtsdatum — der Sync reicht
          // den gespeicherten Wert unverändert durch, wie den Bearbeiter darüber.
          line.authority_report_date || null,
          meta.auditee || line.auditee || '',
          meta.audit_start_date || line.audit_start_date || null,
          meta.audit_end_date || line.audit_end_date || null,
          meta.audit_location || fallbackCity,
          meta.document_ref || line.document_ref || '',
          meta.document_iss_rev || line.document_iss_rev || '',
          meta.document_rev_date || line.document_rev_date || null,
          meta.recommendation || line.recommendation || '',
          line.id
        );

        stmts.deleteChecklistItemsByLine.run(line.id);
        for (const item of items) {
          const ciId = uuidv4();
          stmts.createChecklistItem.run(
            ciId, line.id,
            item.section, item.sort_order,
            item.regulation_ref, item.compliance_check,
            item.evaluation, item.auditor_comment, item.document_ref
          );
          if (['O', 'L1', 'L2', 'L3'].includes(item.evaluation)) {
            const perfDate = line.performed_date || meta.audit_end_date || line.audit_end_date;
            const dl = calcCapDeadline(item.evaluation, perfDate);
            const planForImport = stmts.getAuditPlan.get(req.params.id);
            const deptIdForImport = planForImport ? planForImport.department_id : null;
            stmts.createCapItem.run(uuidv4(), ciId, dl, '', '', '', '', 'OPEN', null, '', deptIdForImport, 'audit', null);
          }
        }

        matched.push({ filename: file.name, lineSubject: line.subject, itemCount: items.length });
      } catch (err) {
        skipped.push({ filename: file.name, error: err.message });
      }
    }
  });

  try {
    importAll();
    const biDept = stmts.getDepartment.get(plan.department_id);
    const biCompany = biDept ? stmts.getCompany.get(biDept.company_id) : null;
    logAction('Audit-Checklisten importiert', 'audit_plan', req.params.id, '', matched.length + ' Dateien importiert', biCompany ? biCompany.name : '', biDept ? biDept.name : '');
    res.json({ matched, skipped });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: 'Import fehlgeschlagen: ' + err.message });
  }
});

module.exports = router;
