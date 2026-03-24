/* ── AC-Change Module ──────────────────────────────────────── */

(function () {
  let companies = [];
  let selectedId = null;
  let departments = [];
  let navPath = [];
  let changeRequests = [];
  let persons = [];
  let statusFilter = null;
  let categoryFilter = null;

  const NAV_STORAGE_KEY = 'ac-change-nav-state';
  const ICON_IMPORT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="12 15 12 3"/><polyline points="8 11 12 15 16 11"/></svg>';
  const ICON_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="12 3 12 15"/><polyline points="8 7 12 3 16 7"/></svg>';

  function saveNavState() {
    try {
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ selectedId, navPath, statusFilter, categoryFilter }));
    } catch {}
  }

  function loadNavState() {
    try {
      const raw = localStorage.getItem(NAV_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  const companyTabsEl = document.getElementById('company-tabs');
  const deptTabsEl = document.getElementById('dept-tabs');
  const deptTabBar = document.getElementById('dept-tab-bar');
  const emptyEl = document.getElementById('empty-state');
  const rightPane = document.getElementById('right-pane-content');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const headerEl = document.getElementById('pane-content-header');
  const contentEl = document.getElementById('pane-content-list');
  const changeDialog = document.getElementById('change-dialog');
  const changeDeleteDialog = document.getElementById('change-delete-dialog');

  let currentDeptId = null;

  // ── Helpers ───────────────────────────────────────────────
  function parseDateDE(val) {
    if (!val || !val.trim()) return null;
    const m = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return undefined;
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  const STATUS_LABELS = { DRAFT: 'Entwurf', IN_REVIEW: 'In Prüfung', APPROVED: 'Genehmigt', IMPLEMENTED: 'Umgesetzt', CLOSED: 'Abgeschlossen', REJECTED: 'Abgelehnt' };
  const CATEGORY_LABELS = { OFFEN: 'Offen', PRIOR: 'Prior', NON_PRIOR: 'Non-Prior' };
  const PRIORITY_LABELS = { LOW: 'Niedrig', MEDIUM: 'Mittel', HIGH: 'Hoch', CRITICAL: 'Kritisch' };
  const STATUS_TAG_MAP = { DRAFT: 'tag-open', IN_REVIEW: 'tag-planned', APPROVED: 'tag-done', IMPLEMENTED: 'tag-checklist', CLOSED: 'tag-recommendation', REJECTED: 'tag-finding' };
  const CAT_TAG_MAP = { OFFEN: 'tag-open', PRIOR: 'tag-finding', NON_PRIOR: 'tag-planned' };
  const PRIO_TAG_MAP = { LOW: 'tag-done', MEDIUM: 'tag-observation', HIGH: 'tag-progress', CRITICAL: 'tag-finding' };

  function statusBadgeHtml(status) {
    return `<span class="audit-tag ${STATUS_TAG_MAP[status] || 'tag-open'}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }
  function categoryBadgeHtml(category) {
    return `<span class="audit-tag ${CAT_TAG_MAP[category] || 'tag-open'}">${escapeHtml(CATEGORY_LABELS[category] || category)}</span>`;
  }
  function priorityBadgeHtml(priority) {
    if (!priority) return '';
    return `<span class="audit-tag ${PRIO_TAG_MAP[priority] || 'tag-open'}">${escapeHtml(PRIORITY_LABELS[priority] || priority)}</span>`;
  }

  function progressBarHtml(done, total) {
    if (!total) return '';
    const pct = Math.round((done / total) * 100);
    return `<div class="change-progress" title="${done}/${total} erledigt">
      <div class="change-progress-bar" style="width:${pct}%"></div>
      <span class="change-progress-label">${done}/${total}</span>
    </div>`;
  }

  // ── Persons ──────────────────────────────────────────────
  async function loadPersons() {
    if (!selectedId) { persons = []; return; }
    try { persons = await fetchJSON(`/api/companies/${selectedId}/persons`); }
    catch { persons = []; }
  }

  function getQmName() {
    if (!currentDeptId) return '';
    const qm = persons.find(p => p.role === 'QM' && p.department_id === currentDeptId);
    if (!qm) return '';
    return (qm.first_name + ' ' + qm.last_name).trim();
  }

  // ── Company / Dept Tabs ──────────────────────────────────
  async function loadCompanies() {
    try { companies = await fetchJSON('/api/companies'); }
    catch (e) { toast(e.message, 'error'); companies = []; }
    renderCompanyTabs();
  }

  function renderCompanyTabs() {
    let html = '';
    companies.forEach(c => {
      const active = c.id === selectedId ? ' tab-active' : '';
      html += `<button class="tab${active}" data-id="${c.id}">${escapeHtml(c.name)}</button>`;
    });
    companyTabsEl.innerHTML = html;
    companyTabsEl.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => selectCompany(btn.dataset.id));
    });
  }

  function renderDeptTabs() {
    const activeDeptId = navPath.length > 0 && navPath[0].type === 'department' ? navPath[0].id : null;
    let html = '';
    departments.forEach(d => {
      const active = d.id === activeDeptId ? ' tab-active' : '';
      html += `<button class="tab tab-secondary${active}" data-id="${d.id}">${escapeHtml(d.name)}</button>`;
    });
    deptTabsEl.innerHTML = html;
    deptTabsEl.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => selectDepartment(btn.dataset.id));
    });
  }

  async function loadDepartments() {
    if (!selectedId) return;
    try { departments = await fetchJSON(`/api/companies/${selectedId}/departments`); }
    catch (e) { toast(e.message, 'error'); departments = []; }
  }

  async function selectCompany(id) {
    selectedId = id;
    navPath = [];
    statusFilter = null;
    categoryFilter = null;
    saveNavState();
    renderCompanyTabs();
    emptyEl.style.display = 'none';
    rightPane.style.display = 'block';
    await loadDepartments();
    await loadPersons();
    deptTabBar.style.display = 'flex';
    renderDeptTabs();
    await renderCurrentLevel();
  }

  function selectDepartment(id) {
    const dept = departments.find(d => d.id === id);
    if (!dept) return;
    navPath = [{ type: 'department', id: dept.id, name: dept.name }];
    saveNavState();
    renderDeptTabs();
    renderCurrentLevel();
  }

  // ── Navigation ──────────────────────────────────────────
  function navigateTo(segment) {
    navPath.push(segment);
    saveNavState();
    renderCurrentLevel();
  }

  function navigateBack() {
    navPath.pop();
    saveNavState();
    renderDeptTabs();
    renderCurrentLevel();
  }

  async function renderCurrentLevel() {
    saveNavState();
    renderBreadcrumb();
    const lastSegment = navPath.length > 0 ? navPath[navPath.length - 1] : null;
    if (!lastSegment) {
      headerEl.innerHTML = '';
      contentEl.innerHTML = '<div class="empty-state-inline">Abteilung ausw\u00e4hlen</div>';
    } else if (lastSegment.type === 'department') {
      await renderChangeListLevel(lastSegment.id);
    } else if (lastSegment.type === 'change-detail') {
      await renderChangeDetail(lastSegment.id);
    } else if (lastSegment.type === 'risk-analysis') {
      await renderRiskAnalysisDetail(lastSegment.id, lastSegment.changeRequestId);
    } else if (lastSegment.type === 'risk-item-detail') {
      renderRiskItemDetail(lastSegment.id);
    }
  }

  function renderBreadcrumb() {
    let html = '';
    navPath.forEach((seg, idx) => {
      if (idx > 0) html += ' <span class="breadcrumb-sep">/</span> ';
      if (idx < navPath.length - 1) {
        html += `<a href="#" class="breadcrumb-link" data-nav-idx="${idx}">${escapeHtml(seg.name)}</a>`;
      } else {
        html += `<span class="breadcrumb-current">${escapeHtml(seg.name)}</span>`;
      }
    });
    breadcrumbEl.innerHTML = html;
    breadcrumbEl.querySelectorAll('.breadcrumb-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(link.dataset.navIdx);
        navPath = navPath.slice(0, idx + 1);
        saveNavState();
        renderDeptTabs();
        renderCurrentLevel();
      });
    });
  }

  // ── Change List ─────────────────────────────────────────
  async function renderChangeListLevel(departmentId) {
    currentDeptId = departmentId;
    headerEl.innerHTML = `
      <h2>Change Requests</h2>
      <button class="btn-icon" id="btn-add-change" title="Change Request hinzuf\u00fcgen">+</button>
    `;
    document.getElementById('btn-add-change').addEventListener('click', () => openChangeDialog(null));
    await loadChangeRequests();
  }

  async function loadChangeRequests() {
    if (!currentDeptId) return;
    try { changeRequests = await fetchJSON(`/api/departments/${currentDeptId}/change-requests`); }
    catch (e) { toast(e.message, 'error'); changeRequests = []; }
    renderChangeList();
  }

  function renderChangeList() {
    let html = '';

    // Filter bar
    // Count per status and category
    const statusCounts = {};
    Object.keys(STATUS_LABELS).forEach(s => { statusCounts[s] = changeRequests.filter(cr => cr.status === s).length; });
    const catCounts = { OFFEN: 0, PRIOR: 0, NON_PRIOR: 0 };
    changeRequests.forEach(cr => { if (catCounts[cr.category] != null) catCounts[cr.category]++; });

    html += '<div class="audit-filter-bar">';
    html += `<button class="audit-filter-btn audit-tag tag-open${statusFilter === null ? ' active' : ''}" data-status-filter="ALL">ALLE (${changeRequests.length})</button>`;
    Object.keys(STATUS_LABELS).forEach(s => {
      if (statusCounts[s] === 0) return;
      html += `<button class="audit-filter-btn audit-tag ${STATUS_TAG_MAP[s] || 'tag-open'}${statusFilter === s ? ' active' : ''}" data-status-filter="${s}">${escapeHtml(STATUS_LABELS[s])} (${statusCounts[s]})</button>`;
    });
    html += '<span style="flex:1"></span>';
    html += `<button class="audit-filter-btn audit-tag tag-open${categoryFilter === null ? ' active' : ''}" data-cat-filter="ALL">Alle Kat.</button>`;
    if (catCounts.OFFEN > 0) html += `<button class="audit-filter-btn audit-tag tag-open${categoryFilter === 'OFFEN' ? ' active' : ''}" data-cat-filter="OFFEN">Offen (${catCounts.OFFEN})</button>`;
    if (catCounts.PRIOR > 0) html += `<button class="audit-filter-btn audit-tag tag-finding${categoryFilter === 'PRIOR' ? ' active' : ''}" data-cat-filter="PRIOR">Prior (${catCounts.PRIOR})</button>`;
    if (catCounts.NON_PRIOR > 0) html += `<button class="audit-filter-btn audit-tag tag-planned${categoryFilter === 'NON_PRIOR' ? ' active' : ''}" data-cat-filter="NON_PRIOR">Non-Prior (${catCounts.NON_PRIOR})</button>`;
    html += '</div>';

    let filtered = changeRequests;
    if (statusFilter) filtered = filtered.filter(cr => cr.status === statusFilter);
    if (categoryFilter) filtered = filtered.filter(cr => cr.category === categoryFilter);

    if (filtered.length === 0) {
      html += '<div class="empty-state-inline">Keine Change Requests vorhanden</div>';
    } else {
      html += '<div class="lines-table-wrap"><table class="lines-table"><thead><tr>';
      html += '<th>Nr.</th><th>Titel</th><th>Kategorie</th><th>Fortschritt</th><th>Status</th><th>Zieldatum</th><th></th>';
      html += '</tr></thead><tbody>';
      filtered.forEach(cr => {
        html += `<tr class="line-row-clickable change-row" data-id="${cr.id}">
          <td>${escapeHtml(cr.change_no || '')}</td>
          <td style="white-space:normal;min-width:180px">${escapeHtml(cr.title || '')}</td>
          <td>${categoryBadgeHtml(cr.category)}</td>
          <td>${progressBarHtml(cr.task_done || 0, cr.task_total || 0)}</td>
          <td>${statusBadgeHtml(cr.status)}</td>
          <td>${formatDateDE(cr.target_date)}</td>
          <td class="line-actions">
            <button class="pane-action-btn danger" data-action="delete-change" data-id="${cr.id}" title="L\u00f6schen">&#128465;</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }

    contentEl.innerHTML = html;

    // Filter handlers
    contentEl.querySelectorAll('[data-status-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        statusFilter = btn.dataset.statusFilter === 'ALL' ? null : btn.dataset.statusFilter;
        saveNavState();
        renderChangeList();
      });
    });
    contentEl.querySelectorAll('[data-cat-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        categoryFilter = btn.dataset.catFilter === 'ALL' ? null : btn.dataset.catFilter;
        saveNavState();
        renderChangeList();
      });
    });

    // Row click → navigate to detail
    contentEl.querySelectorAll('.change-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const cr = changeRequests.find(c => c.id === row.dataset.id);
        if (cr) navigateTo({ type: 'change-detail', id: cr.id, name: cr.change_no || cr.title });
      });
    });

    // Delete buttons
    contentEl.querySelectorAll('[data-action="delete-change"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cr = changeRequests.find(c => c.id === btn.dataset.id);
        if (cr) confirmDeleteChange(cr);
      });
    });
  }

  // ── Change Dialog (Add / Edit) ──────────────────────────
  function openChangeDialog(cr) {
    const isEdit = !!cr;
    document.getElementById('change-dialog-title').textContent = isEdit ? 'Change Request bearbeiten' : 'Change Request hinzuf\u00fcgen';
    document.getElementById('change-form-id').value = isEdit ? cr.id : '';
    document.getElementById('change-form-title').value = isEdit ? (cr.title || '') : '';
    document.getElementById('change-form-description').value = isEdit ? (cr.description || '') : '';
    document.getElementById('change-form-change-type').value = isEdit ? (cr.change_type || '') : '';
    document.getElementById('change-form-category').value = isEdit ? (cr.category || 'OFFEN') : 'OFFEN';
    document.getElementById('change-form-priority').value = isEdit ? (cr.priority || 'MEDIUM') : 'MEDIUM';
    document.getElementById('change-form-requested-by').value = isEdit ? (cr.requested_by || '') : getQmName();

    const reqDateInput = document.getElementById('change-form-requested-date');
    const targetDateInput = document.getElementById('change-form-target-date');
    reqDateInput.value = isEdit ? formatDateDE(cr.requested_date) : formatDateDE(new Date().toISOString().slice(0, 10));
    targetDateInput.value = isEdit ? formatDateDE(cr.target_date) : '';
    initDateAutoFormat(reqDateInput);
    initDateAutoFormat(targetDateInput);

    changeDialog.showModal();
    document.getElementById('change-form-title').focus();
  }

  document.getElementById('change-btn-cancel').addEventListener('click', () => changeDialog.close());

  document.getElementById('change-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('change-form-id').value;
    const reqDateIso = parseDateDE(document.getElementById('change-form-requested-date').value);
    const targetDateIso = parseDateDE(document.getElementById('change-form-target-date').value);
    if (reqDateIso === undefined || targetDateIso === undefined) {
      toast('Datumsformat: TT.MM.JJJJ', 'error');
      return;
    }

    const data = {
      title: document.getElementById('change-form-title').value.trim(),
      description: document.getElementById('change-form-description').value.trim(),
      change_type: document.getElementById('change-form-change-type').value.trim(),
      category: document.getElementById('change-form-category').value,
      priority: document.getElementById('change-form-priority').value,
      requested_by: document.getElementById('change-form-requested-by').value.trim(),
      requested_date: reqDateIso,
      target_date: targetDateIso,
    };

    if (!data.title) { toast('Titel ist erforderlich', 'error'); return; }

    try {
      if (id) {
        currentCR = await fetchJSON(`/api/change-requests/${id}`, { method: 'PUT', body: data });
        toast('Change Request aktualisiert');
        changeDialog.close();
        // If we're in detail view, re-render it
        const lastSeg = navPath[navPath.length - 1];
        if (lastSeg && lastSeg.type === 'change-detail') {
          await renderChangeDetail(currentCR.id);
        } else {
          await loadChangeRequests();
        }
      } else {
        await fetchJSON(`/api/departments/${currentDeptId}/change-requests`, { method: 'POST', body: data });
        toast('Change Request erstellt');
        changeDialog.close();
        await loadChangeRequests();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Change Delete ───────────────────────────────────────
  let deleteTarget = null;

  function confirmDeleteChange(cr) {
    deleteTarget = cr;
    document.getElementById('change-delete-name').textContent = cr.change_no || cr.title || 'Change Request';
    changeDeleteDialog.showModal();
  }

  document.getElementById('change-delete-cancel').addEventListener('click', () => changeDeleteDialog.close());
  document.getElementById('change-delete-confirm').addEventListener('click', async () => {
    if (!deleteTarget) return;
    try {
      await fetchJSON(`/api/change-requests/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Change Request gel\u00f6scht');
      changeDeleteDialog.close();
      await loadChangeRequests();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ═════════════════════════════════════════════════════════
  // ── CHANGE DETAIL VIEW ──────────────────────────────────
  // ═════════════════════════════════════════════════════════

  let currentCR = null;
  let currentTasks = [];
  let currentRiskAnalysis = null;
  let taskFilter = null;
  let hasForm2 = false;

  // Task filter tag definitions (like audit plan line tags)
  const TASK_TAG_DEFS = [
    { key: 'offen',    label: 'OFFEN',    css: 'tag-open',    test: t => !t.completion_date },
    { key: 'erledigt', label: 'ERLEDIGT', css: 'tag-done',    test: t => !!t.completion_date },
  ];

  async function renderChangeDetail(crId) {
    try {
      currentCR = await fetchJSON(`/api/change-requests/${crId}`);
    } catch (e) {
      toast(e.message, 'error');
      navigateBack();
      return;
    }
    currentDeptId = currentCR.department_id;

    // Check department regulation for Form 2 availability
    const currentDept = departments.find(d => d.id === currentCR.department_id);
    const deptId = ((currentDept && currentDept.regulation || '') + ' ' + (currentDept && currentDept.name || '')).toLowerCase();
    hasForm2 = deptId.includes('camo') || deptId.includes('145') || deptId.includes('cao');

    // Header
    headerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h2>${escapeHtml(currentCR.change_no)}</h2>
        ${statusBadgeHtml(currentCR.status)}
        ${categoryBadgeHtml(currentCR.category)}
        ${priorityBadgeHtml(currentCR.priority)}
      </div>
    `;

    // Load tasks and risk analysis
    await Promise.all([loadTasks(), loadRiskAnalysisSummary()]);
    renderDetailContent();
  }

  async function loadTasks() {
    try { currentTasks = await fetchJSON(`/api/change-requests/${currentCR.id}/tasks`); }
    catch { currentTasks = []; }
  }

  async function loadRiskAnalysisSummary() {
    try { currentRiskAnalysis = await fetchJSON(`/api/change-requests/${currentCR.id}/risk-analysis`); }
    catch { currentRiskAnalysis = null; }
  }

  function renderDetailContent() {
    let html = '';

    // ── Action bar: Risikoanalyse + Form 2 ──
    html += '<div class="audit-filter-bar" style="margin-bottom:12px">';
    html += '<span style="flex:1"></span>';
    if (currentRiskAnalysis) {
      html += `<button class="btn btn-secondary btn-sm" id="btn-open-risk-detail">Risikoanalyse (${currentRiskAnalysis.item_count || 0})</button>`;
    } else {
      html += `<button class="btn btn-secondary btn-sm" id="btn-create-risk">Risikoanalyse</button>`;
    }
    if (hasForm2) {
      html += `<button class="btn btn-secondary btn-sm" id="btn-cr-form2">Form 2</button>`;
    }
    html += `<button class="btn-icon" id="btn-import-risk" title="Risikoanalyse importieren (.xlsx)">${ICON_IMPORT}</button>`;
    html += '</div>';

    // ── Section 1: Allgemein (inline-editable, auto-save) ──
    html += '<div class="detail-section">';
    html += '<div class="detail-section-header"><h3 class="detail-section-title">Allgemein</h3></div>';
    html += '<div class="inline-form-grid">';
    html += `<label>Titel</label><input class="inline-input cr-field" id="cr-title" value="${escapeHtml(currentCR.title || '')}">`;
    html += `<label>Beschreibung</label><textarea class="inline-input inline-textarea cr-field" id="cr-description" rows="2">${escapeHtml(currentCR.description || '')}</textarea>`;
    html += `<label>Änderungsart</label><input class="inline-input cr-field" id="cr-change-type" value="${escapeHtml(currentCR.change_type || '')}">`;
    html += `<label>Kategorie</label><select class="inline-input cr-field" id="cr-category">
      <option value="OFFEN"${currentCR.category === 'OFFEN' ? ' selected' : ''}>Offen</option>
      <option value="NON_PRIOR"${currentCR.category === 'NON_PRIOR' ? ' selected' : ''}>Non-Prior Approval</option>
      <option value="PRIOR"${currentCR.category === 'PRIOR' ? ' selected' : ''}>Prior Approval</option>
    </select>`;
    html += `<label>Priorität</label><select class="inline-input cr-field" id="cr-priority">
      <option value="LOW"${currentCR.priority === 'LOW' ? ' selected' : ''}>Niedrig</option>
      <option value="MEDIUM"${currentCR.priority === 'MEDIUM' ? ' selected' : ''}>Mittel</option>
      <option value="HIGH"${currentCR.priority === 'HIGH' ? ' selected' : ''}>Hoch</option>
      <option value="CRITICAL"${currentCR.priority === 'CRITICAL' ? ' selected' : ''}>Kritisch</option>
    </select>`;
    html += `<label>Status</label><select class="inline-input cr-status-field" id="cr-status">
      <option value="DRAFT"${currentCR.status === 'DRAFT' ? ' selected' : ''}>Entwurf</option>
      <option value="IN_REVIEW"${currentCR.status === 'IN_REVIEW' ? ' selected' : ''}>In Prüfung</option>
      <option value="APPROVED"${currentCR.status === 'APPROVED' ? ' selected' : ''}>Genehmigt</option>
      <option value="IMPLEMENTED"${currentCR.status === 'IMPLEMENTED' ? ' selected' : ''}>Umgesetzt</option>
      <option value="CLOSED"${currentCR.status === 'CLOSED' ? ' selected' : ''}>Abgeschlossen</option>
      <option value="REJECTED"${currentCR.status === 'REJECTED' ? ' selected' : ''}>Abgelehnt</option>
    </select>`;
    html += `<label>Beantragt von</label><input class="inline-input cr-field" id="cr-requested-by" value="${escapeHtml(currentCR.requested_by || '')}">`;
    html += `<label>Antragsdatum</label><input class="inline-input cr-field cr-date" id="cr-requested-date" value="${formatDateDE(currentCR.requested_date)}" placeholder="TT.MM.JJJJ">`;
    html += `<label>Zieldatum</label><input class="inline-input cr-field cr-date" id="cr-target-date" value="${formatDateDE(currentCR.target_date)}" placeholder="TT.MM.JJJJ">`;
    html += '</div></div>';

    // ── Section 2: Aufgabenliste ──
    html += '<div class="detail-section">';
    html += '<div class="detail-section-header">';
    html += '<h3 class="detail-section-title">Aufgabenliste</h3>';
    html += '<div style="display:flex;gap:0.25rem">';
    html += `<button class="btn-icon" id="btn-import-tasks" title="Aufgaben importieren (.xlsx)">${ICON_IMPORT}</button>`;
    html += '<button class="btn-icon" id="btn-add-task" title="Aufgabe hinzuf\u00fcgen">+</button>';
    html += '</div></div>';

    // Task filter tags (like audit tags with counts)
    const taskCounts = {};
    for (const def of TASK_TAG_DEFS) {
      taskCounts[def.key] = currentTasks.filter(def.test).length;
    }

    html += '<div class="audit-filter-bar" id="task-filter-bar">';
    for (const def of TASK_TAG_DEFS) {
      if (taskCounts[def.key] === 0) continue;
      const active = taskFilter === def.key ? ' active' : '';
      html += `<button class="audit-filter-btn audit-tag ${def.css}${active}" data-task-filter="${def.key}">${def.label} (${taskCounts[def.key]})</button>`;
    }
    // Progress right-aligned
    const done = currentTasks.filter(t => t.completion_date).length;
    html += `<span style="flex:1"></span>`;
    if (currentTasks.length > 0) {
      html += progressBarHtml(done, currentTasks.length);
    }
    html += '</div>';

    // Apply task filter
    let filteredTasks = currentTasks;
    if (taskFilter) {
      const def = TASK_TAG_DEFS.find(d => d.key === taskFilter);
      if (def) filteredTasks = currentTasks.filter(def.test);
    }

    if (currentTasks.length === 0) {
      html += '<div class="empty-state-inline">Keine Aufgaben vorhanden</div>';
    } else {
      html += '<div class="lines-table-wrap"><table class="lines-table"><thead><tr>';
      html += '<th style="min-width:40px;width:40px;text-align:right;white-space:nowrap"></th><th style="width:18%">Prozesse</th><th style="width:10%">Verantwortlich</th><th>Ziel</th><th>Status</th><th style="width:35%">eingeleitete Maßnahmen / To Do</th><th></th>';
      html += '</tr></thead><tbody>';

      let lastSection = '';
      let nr = 0;
      currentTasks.forEach((t) => {
        nr++;
        const isVisible = filteredTasks.includes(t);
        if (t.section_header && t.section_header !== lastSection) {
          lastSection = t.section_header;
          html += `<tr class="task-section-row"${!isVisible ? ' style="display:none"' : ''}><td colspan="8"><strong>${escapeHtml(t.section_header)}</strong></td></tr>`;
        }
        const isDone = t.completion_date;
        const statusTag = isDone
          ? `<span class="audit-tag tag-done">Erledigt</span>`
          : `<span class="audit-tag tag-open">Offen</span>`;
        html += `<tr class="line-row-clickable task-row${isDone ? ' task-done' : ''}" data-task-id="${t.id}"${!isVisible ? ' style="display:none"' : ''}>
          <td style="text-align:right;white-space:nowrap">${nr}</td>
          <td style="white-space:normal;min-width:160px">${escapeHtml(t.process || '')}</td>
          <td>${escapeHtml(t.responsible_person || '')}</td>
          <td>${formatDateDE(t.target_date)}</td>
          <td>${statusTag}</td>
          <td style="white-space:normal;max-width:200px">${escapeHtml(t.measures || '')}</td>
          <td class="line-actions">
            <button class="pane-action-btn danger" data-action="delete-task" data-task-id="${t.id}" title="L\u00f6schen">&#128465;</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';


    contentEl.innerHTML = html;

    // ── Auto-save for Allgemein fields ──
    contentEl.querySelectorAll('.cr-date').forEach(el => initDateAutoFormat(el));
    contentEl.querySelectorAll('.cr-field').forEach(el => {
      const event = (el.tagName === 'SELECT') ? 'change' : 'blur';
      el.addEventListener(event, saveCRFields);
    });
    // Status field saves via PATCH, then refreshes header
    const statusSelect = document.getElementById('cr-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', async () => {
        try {
          await fetchJSON(`/api/change-requests/${currentCR.id}/status`, { method: 'PATCH', body: { status: statusSelect.value } });
          currentCR.status = statusSelect.value;
          // refresh header badges
          const h2 = headerEl.querySelector('h2');
          if (h2) {
            const badges = headerEl.querySelectorAll('.audit-tag');
            if (badges[0]) badges[0].outerHTML = statusBadgeHtml(currentCR.status);
          }
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    // ── Task filter handlers ──
    contentEl.querySelectorAll('[data-task-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.taskFilter;
        taskFilter = taskFilter === key ? null : key;
        renderDetailContent();
      });
    });

    // Event handlers
    document.getElementById('btn-add-task').addEventListener('click', () => openTaskDialog(null));

    const importTasksBtn = document.getElementById('btn-import-tasks');
    importTasksBtn.addEventListener('click', () => {
      document.getElementById('import-tasks-file').value = '';
      document.getElementById('import-tasks-dialog').showModal();
    });

    const importRiskBtn = document.getElementById('btn-import-risk');
    importRiskBtn.addEventListener('click', () => {
      document.getElementById('import-risk-file').value = '';
      document.getElementById('import-risk-dialog').showModal();
    });

    const createRiskBtn = document.getElementById('btn-create-risk');
    if (createRiskBtn) createRiskBtn.addEventListener('click', createRiskAnalysis);

    const openRiskBtn = document.getElementById('btn-open-risk-detail');
    if (openRiskBtn) {
      openRiskBtn.addEventListener('click', () => {
        navigateTo({ type: 'risk-analysis', id: currentRiskAnalysis.id, changeRequestId: currentCR.id, name: 'Risikoanalyse' });
      });
    }

    const form2Btn = document.getElementById('btn-cr-form2');
    if (form2Btn) form2Btn.addEventListener('click', openEasaForm2Dialog);

    // Task row click → edit
    contentEl.querySelectorAll('.task-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const task = currentTasks.find(t => t.id === row.dataset.taskId);
        if (task) openTaskDialog(task);
      });
    });

    // Task delete
    contentEl.querySelectorAll('[data-action="delete-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteTask(btn.dataset.taskId);
      });
    });
  }

  // ── Auto-save CR fields ──────────────────────────────────
  async function saveCRFields() {
    const reqIso = parseDateDE(document.getElementById('cr-requested-date').value);
    const targetIso = parseDateDE(document.getElementById('cr-target-date').value);
    if (reqIso === undefined || targetIso === undefined) return; // invalid date, skip

    const data = {
      title: document.getElementById('cr-title').value.trim(),
      description: document.getElementById('cr-description').value.trim(),
      change_type: document.getElementById('cr-change-type').value.trim(),
      category: document.getElementById('cr-category').value,
      priority: document.getElementById('cr-priority').value,
      requested_by: document.getElementById('cr-requested-by').value.trim(),
      requested_date: reqIso,
      target_date: targetIso,
    };

    if (!data.title) return; // don't save empty title

    try {
      currentCR = await fetchJSON(`/api/change-requests/${currentCR.id}`, { method: 'PUT', body: data });
      // Update header badges
      const lastSeg = navPath[navPath.length - 1];
      if (lastSeg && lastSeg.type === 'change-detail') {
        lastSeg.name = currentCR.change_no || currentCR.title;
        saveNavState();
        renderBreadcrumb();
      }
      // Refresh header badges
      const h2 = headerEl.querySelector('h2');
      if (h2) h2.textContent = currentCR.change_no;
      // Update status/category/priority badges next to h2
      const badgeContainer = headerEl.querySelector('div');
      if (badgeContainer) {
        const badges = badgeContainer.querySelectorAll('.audit-tag');
        if (badges[0]) badges[0].outerHTML = statusBadgeHtml(currentCR.status);
        if (badges[1]) badges[1].outerHTML = categoryBadgeHtml(currentCR.category);
        if (badges[2]) badges[2].outerHTML = priorityBadgeHtml(currentCR.priority);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ── Task Dialog ──────────────────────────────────────────
  function openTaskDialog(task) {
    const isEdit = !!task;
    document.getElementById('task-dialog-title').textContent = isEdit ? 'Aufgabe bearbeiten' : 'Aufgabe hinzuf\u00fcgen';
    document.getElementById('task-form-id').value = isEdit ? task.id : '';
    document.getElementById('task-form-process').value = isEdit ? (task.process || '') : '';
    document.getElementById('task-form-area').value = isEdit ? (task.area || '') : '';
    document.getElementById('task-form-section-header').value = isEdit ? (task.section_header || '') : '';
    document.getElementById('task-form-safety-note').value = isEdit ? (task.safety_note || '') : '';
    document.getElementById('task-form-measures').value = isEdit ? (task.measures || '') : '';
    document.getElementById('task-form-responsible').value = isEdit ? (task.responsible_person || '') : '';

    const targetInput = document.getElementById('task-form-target-date');
    const completionInput = document.getElementById('task-form-completion-date');
    targetInput.value = isEdit ? formatDateDE(task.target_date) : '';
    completionInput.value = isEdit ? formatDateDE(task.completion_date) : '';
    initDateAutoFormat(targetInput);
    initDateAutoFormat(completionInput);

    document.getElementById('task-dialog').showModal();
    document.getElementById('task-form-process').focus();
  }

  document.getElementById('task-btn-cancel').addEventListener('click', () => document.getElementById('task-dialog').close());
  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('task-form-id').value;
    const targetIso = parseDateDE(document.getElementById('task-form-target-date').value);
    const completionIso = parseDateDE(document.getElementById('task-form-completion-date').value);
    if (targetIso === undefined || completionIso === undefined) {
      toast('Datumsformat: TT.MM.JJJJ', 'error');
      return;
    }

    const data = {
      process: document.getElementById('task-form-process').value.trim(),
      area: document.getElementById('task-form-area').value.trim(),
      section_header: document.getElementById('task-form-section-header').value.trim(),
      safety_note: document.getElementById('task-form-safety-note').value.trim(),
      measures: document.getElementById('task-form-measures').value.trim(),
      responsible_person: document.getElementById('task-form-responsible').value.trim(),
      target_date: targetIso,
      completion_date: completionIso,
    };

    try {
      if (id) {
        await fetchJSON(`/api/change-tasks/${id}`, { method: 'PUT', body: data });
        toast('Aufgabe aktualisiert');
      } else {
        await fetchJSON(`/api/change-requests/${currentCR.id}/tasks`, { method: 'POST', body: data });
        toast('Aufgabe erstellt');
      }
      document.getElementById('task-dialog').close();
      await loadTasks();
      renderDetailContent();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Task Delete ──────────────────────────────────────────
  let deleteTaskId = null;
  function confirmDeleteTask(taskId) {
    deleteTaskId = taskId;
    document.getElementById('task-delete-dialog').showModal();
  }

  document.getElementById('task-delete-cancel').addEventListener('click', () => document.getElementById('task-delete-dialog').close());
  document.getElementById('task-delete-confirm').addEventListener('click', async () => {
    if (!deleteTaskId) return;
    try {
      await fetchJSON(`/api/change-tasks/${deleteTaskId}`, { method: 'DELETE' });
      toast('Aufgabe gel\u00f6scht');
      document.getElementById('task-delete-dialog').close();
      await loadTasks();
      renderDetailContent();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Import Tasks ────────────────────────────────────────
  document.getElementById('import-tasks-cancel').addEventListener('click', () => document.getElementById('import-tasks-dialog').close());
  document.getElementById('import-tasks-confirm').addEventListener('click', async () => {
    const fileInput = document.getElementById('import-tasks-file');
    if (!fileInput.files.length) { toast('Datei auswählen', 'error'); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(',')[1];
      try {
        const result = await fetchJSON(`/api/change-requests/${currentCR.id}/import-tasks`, {
          method: 'POST', body: { file: base64 }
        });
        toast(`${result.imported} Aufgaben importiert`);
        document.getElementById('import-tasks-dialog').close();
        await loadTasks();
        renderDetailContent();
      } catch (err) { toast(err.message, 'error'); }
    };
    reader.readAsDataURL(file);
  });

  // ── Import Risk Analysis ────────────────────────────────
  document.getElementById('import-risk-cancel').addEventListener('click', () => document.getElementById('import-risk-dialog').close());
  document.getElementById('import-risk-confirm').addEventListener('click', async () => {
    const fileInput = document.getElementById('import-risk-file');
    if (!fileInput.files.length) { toast('Datei auswählen', 'error'); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(',')[1];
      try {
        const result = await fetchJSON(`/api/change-requests/${currentCR.id}/import-risk-analysis`, {
          method: 'POST', body: { file: base64 }
        });
        toast(`${result.imported} Risiken importiert`);
        document.getElementById('import-risk-dialog').close();
        await loadRiskAnalysisSummary();
        renderDetailContent();
      } catch (err) { toast(err.message, 'error'); }
    };
    reader.readAsDataURL(file);
  });

  // ── Create Risk Analysis ────────────────────────────────
  async function createRiskAnalysis() {
    try {
      const ra = await fetchJSON(`/api/change-requests/${currentCR.id}/risk-analysis`, {
        method: 'POST', body: { title: currentCR.title, author: getQmName(), safety_manager: getQmName() }
      });
      toast('Risikoanalyse erstellt');
      currentRiskAnalysis = ra;
      await loadRiskAnalysisSummary();
      renderDetailContent();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── EASA Form 2 Dialog ──────────────────────────────────
  let form2AutoSaveBound = false;
  function isForm2_145() {
    const dept = departments.find(d => d.id === currentCR.department_id);
    const id = ((dept && dept.regulation || '') + ' ' + (dept && dept.name || '')).toLowerCase();
    return id.includes('145') || id.includes('cao');
  }

  function openEasaForm2Dialog() {
    const is145 = isForm2_145();
    // Toggle CAMO vs 145 sections
    document.getElementById('easa-form2-scope-camo').style.display = is145 ? 'none' : '';
    document.getElementById('easa-form2-scope-145').style.display = is145 ? '' : 'none';
    document.getElementById('easa-form2-dialog-title').textContent = is145 ? 'EASA Form 2 Part-145' : 'EASA Form 2 CAMO';

    // Load saved form2 data
    let saved = {};
    try { saved = JSON.parse(currentCR.form2_data || '{}'); } catch {}

    const comp = companies.find(c => c.id === selectedId);

    document.getElementById('easa-form2-antragsart').value = saved.antragsart || 'aenderung';
    document.getElementById('easa-form2-standorte').value = saved.standorte || 'siehe oben';
    document.getElementById('easa-form2-telefon').value = saved.telefon || (comp ? comp.phone || '' : '');
    document.getElementById('easa-form2-fax').value = saved.fax || (comp ? comp.fax || '' : '');
    document.getElementById('easa-form2-fax-group').style.display = is145 ? '' : 'none';
    document.getElementById('easa-form2-genart-group').style.display = is145 ? '' : 'none';
    document.getElementById('easa-form2-genart').value = saved.genart || 'teil-145';
    document.getElementById('easa-form2-einverstaendnis').value = saved.einverstaendnis || 'ja';

    if (is145) {
      document.getElementById('easa-form2-scope-single').value = saved.scope_single || '';
    } else {
      document.getElementById('easa-form2-scope-5a').value = saved.scope_5a || '';
      document.getElementById('easa-form2-scope-5b').value = saved.scope_5b || '';
      document.getElementById('easa-form2-scope-5c').value = saved.scope_5c || '';
      document.getElementById('easa-form2-scope-5d').value = saved.scope_5d || '';
    }

    document.getElementById('easa-form2-dialog').showModal();

    // Bind auto-save on blur/change (once)
    if (!form2AutoSaveBound) {
      form2AutoSaveBound = true;
      const dialog = document.getElementById('easa-form2-dialog');
      dialog.querySelectorAll('input, textarea, select').forEach(el => {
        const ev = (el.tagName === 'SELECT') ? 'change' : 'blur';
        el.addEventListener(ev, saveForm2Data);
      });
    }
  }

  document.getElementById('easa-form2-btn-cancel').addEventListener('click', () => document.getElementById('easa-form2-dialog').close());

  function getForm2Params() {
    const is145 = isForm2_145();
    const params = {
      antragsart: document.getElementById('easa-form2-antragsart').value,
      standorte: document.getElementById('easa-form2-standorte').value,
      telefon: document.getElementById('easa-form2-telefon').value,
      fax: document.getElementById('easa-form2-fax').value,
      genart: document.getElementById('easa-form2-genart').value,
      einverstaendnis: document.getElementById('easa-form2-einverstaendnis').value,
    };
    if (is145) {
      params.scope_single = document.getElementById('easa-form2-scope-single').value;
    } else {
      params.scope_5a = document.getElementById('easa-form2-scope-5a').value;
      params.scope_5b = document.getElementById('easa-form2-scope-5b').value;
      params.scope_5c = document.getElementById('easa-form2-scope-5c').value;
      params.scope_5d = document.getElementById('easa-form2-scope-5d').value;
      params.check_5a = !!params.scope_5a.trim();
      params.check_5b = !!params.scope_5b.trim();
      params.check_5c = !!params.scope_5c.trim();
      params.check_5d = !!params.scope_5d.trim();
    }
    return params;
  }

  async function saveForm2Data() {
    const params = getForm2Params();
    try {
      await fetchJSON(`/api/change-requests/${currentCR.id}/form2-data`, { method: 'PUT', body: params });
      currentCR.form2_data = JSON.stringify(params);
    } catch {}
  }

  document.getElementById('easa-form2-btn-download').addEventListener('click', () => {
    const params = getForm2Params();
    const qs = new URLSearchParams(params).toString();
    window.open(`/api/change-requests/${currentCR.id}/easa-form2/pdf?${qs}`, '_blank');
    document.getElementById('easa-form2-dialog').close();
    saveForm2Data(); // save in background, don't block
  });

  document.getElementById('easa-form2-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveForm2Data();
    document.getElementById('easa-form2-dialog').close();
    const dept = departments.find(d => d.id === currentCR.department_id);
    const params = getForm2Params();
    let defaultTo = '';
    if (params.antragsart === 'erstgenehmigung' && dept && dept.initial_approval_email) {
      defaultTo = dept.initial_approval_email;
    } else if (dept && dept.authority_email) {
      defaultTo = dept.authority_email;
    }
    document.getElementById('change-email-to').value = defaultTo;
    document.getElementById('change-email-dialog').showModal();
  });

  // ── Email dialog ────────────────────────────────────────
  document.getElementById('change-email-cancel').addEventListener('click', () => document.getElementById('change-email-dialog').close());
  document.getElementById('change-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = document.getElementById('change-email-to').value.trim();
    if (!to) { toast('E-Mail-Adresse erforderlich', 'error'); return; }
    try {
      await fetchJSON(`/api/change-requests/${currentCR.id}/send-email`, {
        method: 'POST',
        body: { to, type: 'form2', formData: getForm2Params() }
      });
      toast('E-Mail gesendet');
      document.getElementById('change-email-dialog').close();
    } catch (err) { toast(err.message, 'error'); }
  });


  // ═════════════════════════════════════════════════════════
  // ── RISK ANALYSIS DETAIL VIEW ──────────────────────────
  // ═════════════════════════════════════════════════════════

  let riskAnalysisData = null;
  let riskItems = [];
  let riskHistory = [];

  async function renderRiskAnalysisDetail(raId, changeRequestId) {
    try {
      riskAnalysisData = await fetchJSON(`/api/risk-analysis/${raId}`);
      if (!riskAnalysisData) throw new Error('not found');
    } catch (e) {
      toast('Risikoanalyse nicht gefunden', 'error');
      navigateBack();
      return;
    }

    // Load items and history in parallel
    await Promise.all([
      (async () => { try { riskItems = await fetchJSON(`/api/risk-analysis/${raId}/items`); } catch { riskItems = []; } })(),
      (async () => { try { riskHistory = await fetchJSON(`/api/risk-analysis/${raId}/history`); } catch { riskHistory = []; } })(),
    ]);

    // Header
    headerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h2>Risikoanalyse</h2>
      </div>
    `;

    renderRiskAnalysisContent();
  }

  function computeOverallRisk(items, scoreKey, levelKey) {
    if (!items || items.length === 0) return '';
    let maxScore = 0;
    let maxLevel = '';
    for (const item of items) {
      if (item[scoreKey] && item[scoreKey] > maxScore) {
        maxScore = item[scoreKey];
        maxLevel = item[levelKey] || '';
      }
    }
    if (!maxScore) return '';
    // Derive level from max score
    if (maxScore >= 12) return 'Nicht akzeptabel';
    if (maxScore >= 4) return 'Akzeptabel';
    return 'Gering oder kein Risiko';
  }

  function riskLevelColor(text) {
    if (!text) return '';
    const t = text.toLowerCase();
    if (t.includes('nicht akzeptab')) return '#ef4444';
    if (t.includes('akzeptab')) return '#eab308';
    if (t.includes('gering')) return '#22c55e';
    return '#9ca3af';
  }

  function riskLevelIndicator(text) {
    if (!text) return '';
    const bg = riskLevelColor(text);
    return `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${bg};vertical-align:middle;margin-right:6px"></span>${escapeHtml(text)}`;
  }

  function renderRiskAnalysisContent() {
    const ra = riskAnalysisData;
    let html = '';

    // Share button bar
    html += '<div class="audit-filter-bar" style="margin-bottom:12px">';
    html += '<span style="flex:1"></span>';
    html += `<button class="btn-icon" id="btn-ra-share" title="Exportieren / Senden">${ICON_SHARE}</button>`;
    html += '</div>';

    // Metadata — inline editable
    html += '<div class="detail-section">';
    html += '<div class="detail-section-header"><h3 class="detail-section-title">Allgemein</h3></div>';
    html += '<div class="inline-form-grid">';
    html += `<label>Titel</label><input class="inline-input ra-field" id="ra-title" value="${escapeHtml(ra.title || '')}">`;
    html += `<label>Erstellt</label><input class="inline-input ra-field ra-date" id="ra-version-date" value="${formatDateDE(ra.version_date)}" placeholder="TT.MM.JJJJ">`;
    html += `<label>Freigabe</label><input class="inline-input ra-field ra-date" id="ra-signed-at" value="${formatDateDE(ra.signed_at)}" placeholder="TT.MM.JJJJ">`;
    html += `<label>Safety Manager</label><input class="inline-input ra-field" id="ra-safety-manager" value="${escapeHtml(ra.safety_manager || '')}">`;
    // Computed overall risk from items
    const overallInitial = computeOverallRisk(riskItems, 'initial_score', 'initial_level');
    const overallResidual = computeOverallRisk(riskItems, 'residual_score', 'residual_level');
    html += `<label>Gesamt-Anfangsrisiko</label><div style="display:flex;align-items:center;gap:6px">${riskLevelIndicator(overallInitial)}</div>`;
    html += `<label>Gesamt-Restrisiko</label><div style="display:flex;align-items:center;gap:6px">${riskLevelIndicator(overallResidual)}</div>`;
    html += '</div></div>';

    // Risk items
    html += '<div class="detail-section">';
    html += '<div class="detail-section-header">';
    html += '<h3 class="detail-section-title">Risiken</h3>';
    html += `<button class="btn-icon" id="btn-add-risk-item" title="Risiko hinzuf\u00fcgen">+</button>`;
    html += '</div>';

    if (riskItems.length === 0) {
      html += '<div class="empty-state-inline">Keine Risiken vorhanden</div>';
    } else {
      html += '<div class="lines-table-wrap"><table class="lines-table"><thead>';
      html += `<tr><th style="width:20px" rowspan="2"></th><th style="max-width:80px" rowspan="2">Risikotyp</th><th style="max-width:100px" rowspan="2">Beschreibung</th><th rowspan="2">Auswirkung</th>
        <th colspan="3">Anfangsrisiko</th>
        <th style="white-space:nowrap;width:90px" rowspan="2">Verantwortlich</th><th rowspan="2">Maßnahme</th><th rowspan="2">Behandlung</th>
        <th colspan="3">Restrisiko</th>
        <th rowspan="2">Nächster Schritt</th><th rowspan="2"></th></tr>`;
      html += `<tr><th style="padding:2px 4px">W</th><th style="padding:2px 4px">S</th><th style="padding:2px 4px"></th>
        <th style="padding:2px 4px">W</th><th style="padding:2px 4px">S</th><th style="padding:2px 4px"></th></tr>`;
      html += '</thead><tbody>';
      riskItems.forEach((item, idx) => {
        html += `<tr class="line-row-clickable risk-item-row" data-risk-id="${item.id}">
          <td>${idx + 1}</td>
          <td style="max-width:80px">${escapeHtml(item.risk_type || '')}</td>
          <td style="max-width:100px">${escapeHtml(item.description || '')}</td>
          <td style="white-space:normal;max-width:140px">${escapeHtml(item.consequence || '')}</td>
          <td>${item.initial_probability || '—'}</td>
          <td>${item.initial_severity || '—'}</td>
          <td>${riskColorBox(item.initial_score, item.initial_level)}</td>
          <td style="min-width:0">${escapeHtml(item.responsible_person || '')}</td>
          <td style="max-width:120px">${escapeHtml(item.mitigation_topic || '')}</td>
          <td style="max-width:140px">${escapeHtml(item.treatment || '')}</td>
          <td>${item.residual_probability || '—'}</td>
          <td>${item.residual_severity || '—'}</td>
          <td>${riskColorBox(item.residual_score, item.residual_level)}</td>
          <td style="max-width:140px">${escapeHtml(item.next_step || '')}</td>
          <td class="line-actions">
            <button class="pane-action-btn danger" data-action="delete-risk-item" data-risk-id="${item.id}" title="L\u00f6schen">&#128465;</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // Version history (auto-maintained)
    html += '<div class="detail-section">';
    html += '<div class="detail-section-header">';
    html += '<h3 class="detail-section-title">Historie</h3>';
    html += '</div>';
    if (riskHistory.length > 0) {
      html += '<div class="lines-table-wrap"><table class="lines-table"><thead><tr>';
      html += '<th>Datum</th><th>Autor</th><th>Änderungsgrund</th>';
      html += '</tr></thead><tbody>';
      [...riskHistory].sort((a, b) => (b.version_date || '').localeCompare(a.version_date || '')).forEach(h => {
        html += `<tr>
          <td>${formatDateDE(h.version_date)}</td>
          <td>${escapeHtml(h.author || '')}</td>
          <td>${escapeHtml(h.reason || '')}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="empty-state-inline">Keine Historie</div>';
    }
    html += '</div>';

    contentEl.innerHTML = html;

    // Auto-save for RA metadata fields
    contentEl.querySelectorAll('.ra-date').forEach(el => initDateAutoFormat(el));
    contentEl.querySelectorAll('.ra-field').forEach(el => {
      el.addEventListener('blur', saveRAFields);
    });
    // Event handlers
    document.getElementById('btn-add-risk-item').addEventListener('click', () => openRiskItemDialog());
    document.getElementById('btn-ra-share').addEventListener('click', () => {
      document.getElementById('ra-share-dialog').showModal();
    });

    contentEl.querySelectorAll('.risk-item-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const item = riskItems.find(r => r.id === row.dataset.riskId);
        if (item) navigateTo({ type: 'risk-item-detail', id: item.id, name: item.risk_type || item.description || 'Risiko' });
      });
    });

    contentEl.querySelectorAll('[data-action="delete-risk-item"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteRiskItem(btn.dataset.riskId);
      });
    });
  }

  function riskScoreTagClass(level) {
    if (!level) return 'tag-open';
    const l = level.toLowerCase();
    if (l.includes('nicht akzeptab')) return 'tag-finding';
    if (l.includes('akzeptab')) return 'tag-observation';
    return 'tag-done';
  }

  function riskScoreBadge(prob, sev, score, level) {
    if (!score) return '—';
    const cls = riskScoreTagClass(level);
    return `<span class="audit-tag ${cls}" title="${level || ''}">${prob}×${sev}=${score}</span>`;
  }

  function riskColorBox(score, level) {
    if (!score) return '';
    const cls = riskScoreTagClass(level);
    const colors = { 'tag-finding': '#ef4444', 'tag-observation': '#eab308', 'tag-done': '#22c55e', 'tag-open': '#9ca3af' };
    const bg = colors[cls] || '#9ca3af';
    return `<span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:${bg}" title="${score} – ${level || ''}"></span>`;
  }

  // ── Risk Analysis auto-save ────────────────────────────
  async function saveRAFields() {
    const dateIso = parseDateDE(document.getElementById('ra-version-date').value);
    const signedIso = parseDateDE(document.getElementById('ra-signed-at').value);
    if (dateIso === undefined || signedIso === undefined) return;
    try {
      riskAnalysisData = await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}`, {
        method: 'PUT',
        body: {
          title: document.getElementById('ra-title').value.trim(),
          version_date: dateIso,
          safety_manager: document.getElementById('ra-safety-manager').value.trim(),
          overall_initial: computeOverallRisk(riskItems, 'initial_score', 'initial_level'),
          overall_residual: computeOverallRisk(riskItems, 'residual_score', 'residual_level'),
          signed_at: signedIso,
        }
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── Risk Analysis Share Dialog ─────────────────────────
  document.getElementById('ra-share-cancel').addEventListener('click', () => {
    document.getElementById('ra-share-email-section').style.display = 'none';
    document.getElementById('ra-share-dialog').close();
  });

  document.getElementById('ra-share-download').addEventListener('click', () => {
    if (!riskAnalysisData) return;
    window.open(`/api/risk-analysis/${riskAnalysisData.id}/pdf`, '_blank');
    document.getElementById('ra-share-dialog').close();
  });

  let raShareEmailMode = null; // 'authority' | 'email'
  document.getElementById('ra-share-authority').addEventListener('click', () => {
    raShareEmailMode = 'authority';
    const dept = departments.find(d => d.id === currentCR.department_id);
    document.getElementById('ra-share-email-to').value = dept ? (dept.authority_email || '') : '';
    document.getElementById('ra-share-email-section').style.display = '';
  });

  document.getElementById('ra-share-email').addEventListener('click', () => {
    raShareEmailMode = 'email';
    document.getElementById('ra-share-email-to').value = '';
    document.getElementById('ra-share-email-section').style.display = '';
  });

  document.getElementById('ra-share-email-send').addEventListener('click', async () => {
    const to = document.getElementById('ra-share-email-to').value.trim();
    if (!to) { toast('E-Mail-Adresse erforderlich', 'error'); return; }
    try {
      await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/send-email`, {
        method: 'POST', body: { to, authority: raShareEmailMode === 'authority' }
      });
      toast('E-Mail gesendet');
      document.getElementById('ra-share-email-section').style.display = 'none';
      document.getElementById('ra-share-dialog').close();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Risk History Dialog ─────────────────────────────────
  function openRiskHistoryDialog() {
    document.getElementById('risk-history-version').value = (riskAnalysisData.version || 1) + 1;
    const dateInput = document.getElementById('risk-history-date');
    dateInput.value = formatDateDE(new Date().toISOString().slice(0, 10));
    initDateAutoFormat(dateInput);
    document.getElementById('risk-history-author').value = riskAnalysisData.author || '';
    document.getElementById('risk-history-reason').value = '';
    document.getElementById('risk-history-dialog').showModal();
  }

  document.getElementById('risk-history-btn-cancel').addEventListener('click', () => document.getElementById('risk-history-dialog').close());
  document.getElementById('risk-history-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateIso = parseDateDE(document.getElementById('risk-history-date').value);
    if (dateIso === undefined) { toast('Datumsformat: TT.MM.JJJJ', 'error'); return; }
    try {
      await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/history`, {
        method: 'POST',
        body: {
          version: parseInt(document.getElementById('risk-history-version').value) || 1,
          version_date: dateIso,
          author: document.getElementById('risk-history-author').value.trim(),
          reason: document.getElementById('risk-history-reason').value.trim(),
        }
      });
      toast('Eintrag hinzugefügt');
      document.getElementById('risk-history-dialog').close();
      riskHistory = await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/history`);
      renderRiskAnalysisContent();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Risk Item Dialog ────────────────────────────────────
  // ── Risk Item Detail View (full page, inline editable) ──
  let currentRiskItem = null;
  let initialMatrix = null;
  let residualMatrix = null;

  function renderRiskItemDetail(itemId) {
    currentRiskItem = riskItems.find(r => r.id === itemId);
    if (!currentRiskItem) { navigateBack(); return; }
    const item = currentRiskItem;

    headerEl.innerHTML = `<h2>${escapeHtml(item.risk_type || item.description || 'Risiko')}</h2>`;

    let html = '<div class="detail-section">';
    html += '<div class="inline-form-grid">';
    html += `<label>Risikotyp</label><input class="inline-input ri-field" id="ri-risk-type" value="${escapeHtml(item.risk_type || '')}">`;
    html += `<label>Beschreibung</label><textarea class="inline-input inline-textarea ri-field" id="ri-description" rows="2">${escapeHtml(item.description || '')}</textarea>`;
    html += `<label>Auswirkung</label><textarea class="inline-input inline-textarea ri-field" id="ri-consequence" rows="2">${escapeHtml(item.consequence || '')}</textarea>`;
    html += `<label>Verantwortlich</label><input class="inline-input ri-field" id="ri-responsible" value="${escapeHtml(item.responsible_person || '')}">`;
    html += `<label>Maßnahme</label><textarea class="inline-input inline-textarea ri-field" id="ri-mitigation" rows="2">${escapeHtml(item.mitigation_topic || '')}</textarea>`;
    html += `<label>Behandlung</label><textarea class="inline-input inline-textarea ri-field" id="ri-treatment" rows="2">${escapeHtml(item.treatment || '')}</textarea>`;
    html += `<label>Umsetzungstermin</label><input class="inline-input ri-field ri-date" id="ri-impl-date" value="${formatDateDE(item.implementation_date)}" placeholder="TT.MM.JJJJ">`;
    html += `<label>Nächster Schritt</label><textarea class="inline-input inline-textarea ri-field" id="ri-next-step" rows="2">${escapeHtml(item.next_step || '')}</textarea>`;
    html += '</div></div>';

    // Risk matrices side by side with divider
    html += '<div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">';
    html += '<div style="flex:1;padding:16px;background:var(--surface)"><h3 class="detail-section-title">Anfangsrisiko</h3><div id="ri-matrix-initial" style="margin-top:8px"></div></div>';
    html += '<div style="width:1px;background:var(--border)"></div>';
    html += '<div style="flex:1;padding:16px;background:var(--surface)"><h3 class="detail-section-title">Restrisiko</h3><div id="ri-matrix-residual" style="margin-top:8px"></div></div>';
    html += '</div>';

    contentEl.innerHTML = html;

    // Init date fields
    contentEl.querySelectorAll('.ri-date').forEach(el => initDateAutoFormat(el));

    // Init risk matrices
    initialMatrix = createRiskMatrix(document.getElementById('ri-matrix-initial'), {
      probability: item.initial_probability,
      severity: item.initial_severity,
      onChange: saveRiskItemFields,
    });
    residualMatrix = createRiskMatrix(document.getElementById('ri-matrix-residual'), {
      probability: item.residual_probability,
      severity: item.residual_severity,
      onChange: saveRiskItemFields,
    });

    // Auto-save on blur
    contentEl.querySelectorAll('.ri-field').forEach(el => {
      el.addEventListener('blur', saveRiskItemFields);
    });
  }

  async function saveRiskItemFields() {
    if (!currentRiskItem) return;
    const implIso = parseDateDE(document.getElementById('ri-impl-date').value);
    if (implIso === undefined) return;

    const initVals = initialMatrix.getValues();
    const resVals = residualMatrix.getValues();

    const data = {
      risk_type: document.getElementById('ri-risk-type').value.trim(),
      description: document.getElementById('ri-description').value.trim(),
      consequence: document.getElementById('ri-consequence').value.trim(),
      responsible_person: document.getElementById('ri-responsible').value.trim(),
      mitigation_topic: document.getElementById('ri-mitigation').value.trim(),
      treatment: document.getElementById('ri-treatment').value.trim(),
      next_step: document.getElementById('ri-next-step').value.trim(),
      implementation_date: implIso,
      initial_probability: initVals.probability,
      initial_severity: initVals.severity,
      residual_probability: resVals.probability,
      residual_severity: resVals.severity,
    };

    try {
      currentRiskItem = await fetchJSON(`/api/risk-items/${currentRiskItem.id}`, { method: 'PUT', body: data });
      // Update header
      headerEl.querySelector('h2').textContent = data.risk_type || data.description || 'Risiko';
      // Update breadcrumb name
      const lastSeg = navPath[navPath.length - 1];
      if (lastSeg) { lastSeg.name = data.risk_type || data.description || 'Risiko'; renderBreadcrumb(); }
    } catch (err) { toast(err.message, 'error'); }
  }

  // Keep dialog-based add for new items (lightweight)
  function openRiskItemDialog() {
    document.getElementById('risk-item-form-id').value = '';
    document.getElementById('risk-item-form-risk-type').value = '';
    document.getElementById('risk-item-form-description').value = '';
    document.getElementById('risk-item-form-consequence').value = '';
    document.getElementById('risk-item-form-responsible').value = '';
    document.getElementById('risk-item-form-mitigation').value = '';
    document.getElementById('risk-item-form-treatment').value = '';
    document.getElementById('risk-item-form-next-step').value = '';
    document.getElementById('risk-item-form-impl-date').value = '';

    const initContainer = document.getElementById('risk-item-matrix-initial');
    const resContainer = document.getElementById('risk-item-matrix-residual');
    initContainer.innerHTML = '';
    resContainer.innerHTML = '';
    createRiskMatrix(initContainer, {});
    createRiskMatrix(resContainer, {});

    document.getElementById('risk-item-dialog').showModal();
  }

  document.getElementById('risk-item-btn-cancel').addEventListener('click', () => document.getElementById('risk-item-dialog').close());
  document.getElementById('risk-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const implIso = parseDateDE(document.getElementById('risk-item-form-impl-date').value);
    if (implIso === undefined) { toast('Datumsformat: TT.MM.JJJJ', 'error'); return; }

    const initC = document.getElementById('risk-item-matrix-initial');
    const resC = document.getElementById('risk-item-matrix-residual');
    // Read matrix values from the dialog's matrices (last created)
    const data = {
      risk_type: document.getElementById('risk-item-form-risk-type').value.trim(),
      description: document.getElementById('risk-item-form-description').value.trim(),
      consequence: document.getElementById('risk-item-form-consequence').value.trim(),
      responsible_person: document.getElementById('risk-item-form-responsible').value.trim(),
      mitigation_topic: document.getElementById('risk-item-form-mitigation').value.trim(),
      treatment: document.getElementById('risk-item-form-treatment').value.trim(),
      next_step: document.getElementById('risk-item-form-next-step').value.trim(),
      implementation_date: implIso,
    };

    try {
      await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/items`, { method: 'POST', body: data });
      toast('Risiko hinzugef\u00fcgt');
      document.getElementById('risk-item-dialog').close();
      riskItems = await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/items`);
      riskHistory = await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/history`);
      renderRiskAnalysisContent();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Risk Item Delete ────────────────────────────────────
  let deleteRiskItemId = null;
  function confirmDeleteRiskItem(riskId) {
    deleteRiskItemId = riskId;
    document.getElementById('risk-item-delete-dialog').showModal();
  }

  document.getElementById('risk-item-delete-cancel').addEventListener('click', () => document.getElementById('risk-item-delete-dialog').close());
  document.getElementById('risk-item-delete-confirm').addEventListener('click', async () => {
    if (!deleteRiskItemId) return;
    try {
      await fetchJSON(`/api/risk-items/${deleteRiskItemId}`, { method: 'DELETE' });
      toast('Risiko gel\u00f6scht');
      document.getElementById('risk-item-delete-dialog').close();
      riskItems = await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/items`);
      riskHistory = await fetchJSON(`/api/risk-analysis/${riskAnalysisData.id}/history`);
      renderRiskAnalysisContent();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await loadCompanies();
    const saved = loadNavState();
    if (saved && saved.selectedId && companies.find(c => c.id === saved.selectedId)) {
      selectedId = saved.selectedId;
      navPath = Array.isArray(saved.navPath) ? saved.navPath : [];
      statusFilter = saved.statusFilter || null;
      categoryFilter = saved.categoryFilter || null;
      renderCompanyTabs();
      emptyEl.style.display = 'none';
      rightPane.style.display = 'block';
      await loadDepartments();
      await loadPersons();
      deptTabBar.style.display = 'flex';
      renderDeptTabs();
      await renderCurrentLevel();
    }
  }

  init();
})();
