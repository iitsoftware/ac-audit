/* ── Safety Module (AC-SMS) ────────────────────────────────── */
// API endpoints used (routes/safety.js):
//   GET/POST  /api/departments/:id/sms-meetings
//   PUT/DELETE /api/sms-meetings/:id, GET /api/sms-meetings/:id/pdf
//   GET/POST  /api/departments/:id/safety-objectives
//   PUT/DELETE /api/safety-objectives/:id
//   PATCH     /api/departments/:id/safety-objectives/reorder  body: { order: [ids] }
//   GET/POST  /api/safety-objectives/:id/spi-evaluations
//   PUT/DELETE /api/spi-evaluations/:id
//   PATCH     /api/spi-evaluations/:id/close  (sets closed_at)

(function () {
  let companies = [];
  let selectedId = null;
  let departments = [];
  let currentDeptId = null;
  let activeTab = 'meetings';
  let meetings = [];
  let objectives = [];
  let evaluations = []; // flattened across objectives, each entry carries .objective

  const NAV_STORAGE_KEY = 'ac-safety-nav-state';
  const ICON_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="12 3 12 15"/><polyline points="8 7 12 3 16 7"/></svg>';

  const MEETING_TYPE_LABELS = { MANAGEMENT_REVIEW: 'Management Review', SRB: 'SRB' };
  const MEETING_TYPE_TAG_MAP = { MANAGEMENT_REVIEW: 'tag-planned', SRB: 'tag-checklist' };
  const RESULT_LABELS = { POSITIV: 'positiv', NEGATIV: 'negativ' };
  const RESULT_TAG_MAP = { POSITIV: 'tag-done', NEGATIV: 'tag-finding' };

  const companyTabsEl = document.getElementById('company-tabs');
  const deptTabsEl = document.getElementById('dept-tabs');
  const deptTabBar = document.getElementById('dept-tab-bar');
  const emptyEl = document.getElementById('empty-state');
  const contentEl = document.getElementById('safety-content');
  const deptEmptyEl = document.getElementById('safety-dept-empty');
  const tabsWrapEl = document.getElementById('safety-tabs-wrap');

  // ── Helpers ──────────────────────────────────────────────
  const yesNo = (v) => (v ? 'ja' : 'nein');
  const isFinding = (ev) => ev.fulfilled === 0 || ev.result === 'NEGATIV' || ev.improvement === 1;
  const isOpenFinding = (ev) => isFinding(ev) && !ev.closed_at;

  function saveNav() {
    saveNavState(NAV_STORAGE_KEY, { selectedId, currentDeptId, activeTab });
  }

  // ── Company / Dept Tabs ──────────────────────────────────
  async function loadCompanies() {
    try { companies = await fetchJSON('/api/companies'); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); companies = []; }
    renderCompanyTabs(companies, selectedId, companyTabsEl, selectCompany);
  }

  async function selectCompany(id, restoreDeptId) {
    selectedId = id;
    currentDeptId = null;
    saveNav();
    renderCompanyTabs(companies, selectedId, companyTabsEl, selectCompany);
    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';
    deptEmptyEl.style.display = '';
    tabsWrapEl.style.display = 'none';
    try { departments = await fetchJSON(`/api/companies/${selectedId}/departments`); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); departments = []; }
    deptTabBar.style.display = 'flex';
    renderDeptTabs(departments, currentDeptId, deptTabsEl, selectDepartment);
    if (restoreDeptId && departments.some(d => d.id === restoreDeptId)) {
      await selectDepartment(restoreDeptId);
    }
  }

  async function selectDepartment(id) {
    currentDeptId = id;
    saveNav();
    renderDeptTabs(departments, currentDeptId, deptTabsEl, selectDepartment);
    deptEmptyEl.style.display = 'none';
    tabsWrapEl.style.display = 'block';
    await loadDeptData();
  }

  // ── Data loading ─────────────────────────────────────────
  async function loadDeptData() {
    if (!currentDeptId) return;
    try {
      [meetings, objectives] = await Promise.all([
        fetchJSON(`/api/departments/${currentDeptId}/sms-meetings`),
        fetchJSON(`/api/departments/${currentDeptId}/safety-objectives`),
      ]);
      const lists = await Promise.all(objectives.map(o =>
        fetchJSON(`/api/safety-objectives/${o.id}/spi-evaluations`).catch(() => [])
      ));
      evaluations = [];
      lists.forEach((list, i) => {
        list.forEach(ev => evaluations.push({ ...ev, objective: objectives[i] }));
      });
      evaluations.sort((a, b) => (b.eval_date || '').localeCompare(a.eval_date || ''));
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      meetings = []; objectives = []; evaluations = [];
    }
    renderAll();
  }

  function renderAll() {
    renderMeetings();
    renderObjectives();
    renderSpi();
  }

  // ── ARIA tabs ────────────────────────────────────────────
  document.querySelectorAll('#safety-tab-bar .settings-tab').forEach(tab => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  });

  function selectTab(name) {
    activeTab = name;
    saveNav();
    document.querySelectorAll('#safety-tab-bar .settings-tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    ['meetings', 'objectives', 'spi'].forEach(n => {
      document.getElementById(`tab-${n}`).classList.toggle('active', n === name);
    });
  }

  // ── Tab 1: Meetings ──────────────────────────────────────
  function renderMeetings() {
    const container = document.getElementById('meetings-table');
    if (meetings.length === 0) {
      container.innerHTML = '<div class="empty-state-inline" style="padding:16px 0">Keine Einträge</div>';
      return;
    }
    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <thead><tr>
        <th>Typ</th><th>Datum</th><th>Teilnehmer</th><th>Thematik</th><th style="width:100px"></th>
      </tr></thead><tbody>`;
    meetings.forEach(m => {
      html += `<tr class="ci-row-clickable" data-id="${m.id}">
        <td>${badge(m.meeting_type, MEETING_TYPE_TAG_MAP, MEETING_TYPE_LABELS)}</td>
        <td>${escapeHtml(formatDateDE(m.meeting_date))}</td>
        <td class="wrap-cell">${escapeHtml(m.participants || '')}</td>
        <td class="wrap-cell">${escapeHtml(m.topics || '')}</td>
        <td class="line-actions">
          <button type="button" class="btn-icon" data-action="pdf" data-id="${m.id}" title="Meeting-Protokoll als PDF" aria-label="Meeting-Protokoll als PDF exportieren">${ICON_SHARE}</button>
          <button type="button" class="pane-action-btn danger" data-action="delete" data-id="${m.id}" title="Löschen" aria-label="Meeting löschen">&#128465;</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-id]').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('button')) return;
        const meeting = meetings.find(m => m.id === row.dataset.id);
        if (meeting) openMeetingDialog(meeting);
      });
    });
    container.querySelectorAll('[data-action="pdf"]').forEach(btn => {
      btn.addEventListener('click', () => window.open(`/api/sms-meetings/${btn.dataset.id}/pdf`));
    });
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const meeting = meetings.find(m => m.id === btn.dataset.id);
        confirmDelete({
          title: 'Meeting löschen',
          message: `<p>Soll das Meeting vom <strong>${escapeHtml(formatDateDE(meeting?.meeting_date) || '—')}</strong> wirklich gelöscht werden?</p>`,
          onConfirm: async () => {
            await fetchJSON(`/api/sms-meetings/${btn.dataset.id}`, { method: 'DELETE' });
            toast('Meeting gelöscht');
            await loadDeptData();
          },
        });
      });
    });
  }

  function openMeetingDialog(meeting) {
    const isEdit = !!meeting;
    document.getElementById('meeting-dialog-title').textContent = isEdit ? 'Meeting bearbeiten' : 'Meeting hinzufügen';
    document.getElementById('meeting-form-id').value = isEdit ? meeting.id : '';
    document.getElementById('meeting-form-type').value = isEdit ? (meeting.meeting_type || 'MANAGEMENT_REVIEW') : 'MANAGEMENT_REVIEW';
    document.getElementById('meeting-form-date').value = isEdit ? (formatDateDE(meeting.meeting_date) || '') : '';
    document.getElementById('meeting-form-participants').value = isEdit ? (meeting.participants || '') : '';
    document.getElementById('meeting-form-topics').value = isEdit ? (meeting.topics || '') : '';
    document.getElementById('meeting-form-results').value = isEdit ? (meeting.results || '') : '';
    document.getElementById('meeting-form-actions').value = isEdit ? (meeting.actions || '') : '';
    openDialog('meeting-dialog');
  }

  document.getElementById('btn-add-meeting').addEventListener('click', () => openMeetingDialog(null));
  document.getElementById('meeting-btn-cancel').addEventListener('click', () => closeDialog('meeting-dialog'));
  document.getElementById('meeting-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateIso = parseDateDE(document.getElementById('meeting-form-date').value);
    if (dateIso === undefined) { toast('Ungültiges Datum (TT.MM.JJJJ)', 'error'); return; }
    const id = document.getElementById('meeting-form-id').value;
    const body = {
      meeting_type: document.getElementById('meeting-form-type').value,
      meeting_date: dateIso,
      participants: document.getElementById('meeting-form-participants').value.trim(),
      topics: document.getElementById('meeting-form-topics').value.trim(),
      results: document.getElementById('meeting-form-results').value.trim(),
      actions: document.getElementById('meeting-form-actions').value.trim(),
    };
    try {
      if (id) await fetchJSON(`/api/sms-meetings/${id}`, { method: 'PUT', body });
      else await fetchJSON(`/api/departments/${currentDeptId}/sms-meetings`, { method: 'POST', body });
      closeDialog('meeting-dialog');
      toast('Meeting gespeichert');
      await loadDeptData();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Tab 2: Safety Objectives ─────────────────────────────
  function lastSpiHtml(objectiveId) {
    const last = evaluations.find(ev => ev.safety_objective_id === objectiveId);
    if (!last) return '<span class="text-muted">—</span>';
    const date = formatDateDE(last.eval_date);
    return `${escapeHtml(last.spi_value || '—')}${date ? ` <span class="text-muted">(${date})</span>` : ''}`;
  }

  function renderObjectives() {
    const container = document.getElementById('objectives-table');
    if (objectives.length === 0) {
      container.innerHTML = '<div class="empty-state-inline" style="padding:16px 0">Keine Einträge</div>';
      return;
    }
    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <thead><tr>
        <th style="width:56px"></th><th>Ziel</th><th>SPT</th><th style="width:120px">Intervall</th><th>letzter SPI</th><th style="width:56px"></th>
      </tr></thead><tbody>`;
    objectives.forEach((o, idx) => {
      html += `<tr class="ci-row-clickable${o.active ? '' : ' text-muted'}" data-id="${o.id}">
        <td class="line-actions">
          <button type="button" class="reorder-btn" data-action="up" data-id="${o.id}" ${idx === 0 ? 'disabled' : ''} aria-label="Nach oben verschieben">&#9650;</button>
          <button type="button" class="reorder-btn" data-action="down" data-id="${o.id}" ${idx === objectives.length - 1 ? 'disabled' : ''} aria-label="Nach unten verschieben">&#9660;</button>
        </td>
        <td class="wrap-cell">${escapeHtml(o.objective || '')}</td>
        <td class="wrap-cell">${escapeHtml(o.spt || '')}</td>
        <td>${o.interval_months ? `${o.interval_months} Monate` : ''}</td>
        <td>${lastSpiHtml(o.id)}</td>
        <td class="line-actions">
          <button type="button" class="pane-action-btn danger" data-action="delete" data-id="${o.id}" title="Löschen" aria-label="Safety Objective löschen">&#128465;</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-id]').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('button')) return;
        const obj = objectives.find(o => o.id === row.dataset.id);
        if (obj) openObjectiveDialog(obj);
      });
    });
    container.querySelectorAll('[data-action="up"],[data-action="down"]').forEach(btn => {
      btn.addEventListener('click', () => moveObjective(btn.dataset.id, btn.dataset.action === 'up' ? -1 : 1));
    });
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const obj = objectives.find(o => o.id === btn.dataset.id);
        confirmDelete({
          title: 'Safety Objective löschen',
          message: `<p>Soll <strong>${escapeHtml(obj?.objective || '')}</strong> inkl. aller SPI-Bewertungen wirklich gelöscht werden?</p>`,
          onConfirm: async () => {
            await fetchJSON(`/api/safety-objectives/${btn.dataset.id}`, { method: 'DELETE' });
            toast('Safety Objective gelöscht');
            await loadDeptData();
          },
        });
      });
    });
  }

  async function moveObjective(id, dir) {
    const idx = objectives.findIndex(o => o.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= objectives.length) return;
    const order = objectives.map(o => o.id);
    [order[idx], order[target]] = [order[target], order[idx]];
    try {
      await fetchJSON(`/api/departments/${currentDeptId}/safety-objectives/reorder`, {
        method: 'PATCH', body: { order },
      });
      const [moved] = objectives.splice(idx, 1);
      objectives.splice(target, 0, moved);
      renderObjectives();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  function openObjectiveDialog(obj) {
    const isEdit = !!obj;
    document.getElementById('objective-dialog-title').textContent = isEdit ? 'Safety Objective bearbeiten' : 'Safety Objective hinzufügen';
    document.getElementById('objective-form-id').value = isEdit ? obj.id : '';
    document.getElementById('objective-form-objective').value = isEdit ? (obj.objective || '') : '';
    document.getElementById('objective-form-spt').value = isEdit ? (obj.spt || '') : '';
    document.getElementById('objective-form-interval').value = isEdit ? (obj.interval_months || 12) : 12;
    document.getElementById('objective-form-active').checked = isEdit ? !!obj.active : true;
    openDialog('objective-dialog');
  }

  document.getElementById('btn-add-objective').addEventListener('click', () => openObjectiveDialog(null));
  document.getElementById('objective-btn-cancel').addEventListener('click', () => closeDialog('objective-dialog'));
  document.getElementById('objective-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('objective-form-id').value;
    const body = {
      objective: document.getElementById('objective-form-objective').value.trim(),
      spt: document.getElementById('objective-form-spt').value.trim(),
      interval_months: parseInt(document.getElementById('objective-form-interval').value, 10) || 12,
      active: document.getElementById('objective-form-active').checked ? 1 : 0,
    };
    try {
      if (id) await fetchJSON(`/api/safety-objectives/${id}`, { method: 'PUT', body });
      else await fetchJSON(`/api/departments/${currentDeptId}/safety-objectives`, { method: 'POST', body });
      closeDialog('objective-dialog');
      toast('Safety Objective gespeichert');
      await loadDeptData();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Tab 3: SPI Bewertung ─────────────────────────────────
  function renderSpi() {
    renderOpenFindings();
    renderEvaluations();
  }

  function renderOpenFindings() {
    const container = document.getElementById('spi-findings-table');
    const open = evaluations.filter(isOpenFinding);
    if (open.length === 0) {
      container.innerHTML = '<div class="empty-state-inline" style="padding:16px 0">Keine offenen Findings</div>';
      return;
    }
    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <thead><tr>
        <th style="width:110px">Datum</th><th>Objective</th><th>SPT</th><th>SPI</th><th style="width:110px"></th>
      </tr></thead><tbody>`;
    open.forEach(ev => {
      html += `<tr class="ci-row-clickable row-finding" data-id="${ev.id}">
        <td>${escapeHtml(formatDateDE(ev.eval_date))}</td>
        <td class="wrap-cell">${escapeHtml(ev.objective?.objective || '')}</td>
        <td class="wrap-cell">${escapeHtml(ev.spt_snapshot || ev.objective?.spt || '')}</td>
        <td class="wrap-cell">${escapeHtml(ev.spi_value || '')}</td>
        <td class="line-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="close" data-id="${ev.id}">Erledigt</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-id]').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('button')) return;
        const ev = evaluations.find(x => x.id === row.dataset.id);
        if (ev) openSpiDialog(ev);
      });
    });
    container.querySelectorAll('[data-action="close"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await fetchJSON(`/api/spi-evaluations/${btn.dataset.id}/close`, { method: 'PATCH' });
          toast('Finding erledigt');
          await loadDeptData();
        } catch (err) {
          toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
          btn.disabled = false;
        }
      });
    });
  }

  function renderEvaluations() {
    const container = document.getElementById('spi-table');
    if (evaluations.length === 0) {
      container.innerHTML = '<div class="empty-state-inline" style="padding:16px 0">Keine Einträge</div>';
      return;
    }
    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <thead><tr>
        <th style="width:110px">Datum</th><th>Objective</th><th>SPT</th><th>SPI</th>
        <th style="width:80px">Erf&uuml;llt</th><th style="width:100px">Ergebnis</th><th style="width:110px">Verbesserung</th><th style="width:56px"></th>
      </tr></thead><tbody>`;
    evaluations.forEach(ev => {
      const findingClass = isFinding(ev) ? ' row-finding' : '';
      html += `<tr class="ci-row-clickable${findingClass}" data-id="${ev.id}">
        <td>${escapeHtml(formatDateDE(ev.eval_date))}</td>
        <td class="wrap-cell">${escapeHtml(ev.objective?.objective || '')}</td>
        <td class="wrap-cell">${escapeHtml(ev.spt_snapshot || ev.objective?.spt || '')}</td>
        <td class="wrap-cell">${escapeHtml(ev.spi_value || '')}</td>
        <td>${yesNo(ev.fulfilled)}</td>
        <td>${badge(ev.result, RESULT_TAG_MAP, RESULT_LABELS)}</td>
        <td>${yesNo(ev.improvement)}</td>
        <td class="line-actions">
          <button type="button" class="pane-action-btn danger" data-action="delete" data-id="${ev.id}" title="Löschen" aria-label="Bewertung löschen">&#128465;</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.querySelectorAll('tr[data-id]').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('button')) return;
        const ev = evaluations.find(x => x.id === row.dataset.id);
        if (ev) openSpiDialog(ev);
      });
    });
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ev = evaluations.find(x => x.id === btn.dataset.id);
        confirmDelete({
          title: 'SPI Bewertung löschen',
          message: `<p>Soll die Bewertung vom <strong>${escapeHtml(formatDateDE(ev?.eval_date) || '—')}</strong> wirklich gelöscht werden?</p>`,
          onConfirm: async () => {
            await fetchJSON(`/api/spi-evaluations/${btn.dataset.id}`, { method: 'DELETE' });
            toast('Bewertung gelöscht');
            await loadDeptData();
          },
        });
      });
    });
  }

  // ── SPI dialog: negative section only when the evaluation is a finding ──
  function spiFormIsNegative() {
    return document.getElementById('spi-form-fulfilled').value === '0'
      || document.getElementById('spi-form-result').value === 'NEGATIV'
      || document.getElementById('spi-form-improvement').value === '1';
  }

  function updateNegativeSection() {
    document.getElementById('spi-form-negative').style.display = spiFormIsNegative() ? '' : 'none';
  }

  ['spi-form-fulfilled', 'spi-form-result', 'spi-form-improvement'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateNegativeSection);
  });

  function fillObjectiveSelect(currentObjectiveId) {
    const select = document.getElementById('spi-form-objective');
    const selectable = objectives.filter(o => o.active || o.id === currentObjectiveId);
    select.innerHTML = selectable
      .map(o => `<option value="${o.id}">${escapeHtml(o.objective || '')}</option>`)
      .join('');
    if (currentObjectiveId) select.value = currentObjectiveId;
  }

  function openSpiDialog(ev) {
    const isEdit = !!ev;
    if (!isEdit && objectives.filter(o => o.active).length === 0) {
      toast('Bitte zuerst ein Safety Objective anlegen', 'error');
      return;
    }
    document.getElementById('spi-dialog-title').textContent = isEdit ? 'SPI Bewertung bearbeiten' : 'SPI Bewertung hinzufügen';
    document.getElementById('spi-form-id').value = isEdit ? ev.id : '';
    fillObjectiveSelect(isEdit ? ev.safety_objective_id : null);
    // Objective is fixed once the evaluation exists (snapshots belong to it)
    document.getElementById('spi-form-objective').disabled = isEdit;
    document.getElementById('spi-form-date').value = isEdit ? (formatDateDE(ev.eval_date) || '') : '';
    document.getElementById('spi-form-value').value = isEdit ? (ev.spi_value || '') : '';
    document.getElementById('spi-form-fulfilled').value = isEdit ? String(ev.fulfilled ? 1 : 0) : '1';
    document.getElementById('spi-form-result').value = isEdit ? (ev.result || 'POSITIV') : 'POSITIV';
    document.getElementById('spi-form-improvement').value = isEdit ? String(ev.improvement ? 1 : 0) : '0';
    document.getElementById('spi-form-cause').value = isEdit ? (ev.cause_analysis || '') : '';
    document.getElementById('spi-form-measures').value = isEdit ? (ev.measures || '') : '';
    document.getElementById('spi-form-decision').value = isEdit ? (ev.decision || '') : '';
    document.getElementById('spi-form-decision-place').value = isEdit ? (ev.decision_place || '') : '';
    document.getElementById('spi-form-decided-at').value = isEdit ? (formatDateDE(ev.decided_at) || '') : '';
    updateNegativeSection();
    openDialog('spi-dialog');
  }

  document.getElementById('btn-add-spi').addEventListener('click', () => openSpiDialog(null));
  document.getElementById('spi-btn-cancel').addEventListener('click', () => closeDialog('spi-dialog'));
  document.getElementById('spi-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateIso = parseDateDE(document.getElementById('spi-form-date').value);
    const decidedIso = parseDateDE(document.getElementById('spi-form-decided-at').value);
    if (dateIso === undefined || decidedIso === undefined) { toast('Ungültiges Datum (TT.MM.JJJJ)', 'error'); return; }
    const id = document.getElementById('spi-form-id').value;
    const objectiveId = document.getElementById('spi-form-objective').value;
    const existing = id ? evaluations.find(x => x.id === id) : null;
    const obj = objectives.find(o => o.id === objectiveId);
    const negative = spiFormIsNegative();
    const body = {
      eval_date: dateIso,
      spt_snapshot: existing ? (existing.spt_snapshot || '') : (obj?.spt || ''),
      interval_snapshot: existing ? (existing.interval_snapshot ?? null) : (obj?.interval_months ?? null),
      spi_value: document.getElementById('spi-form-value').value.trim(),
      fulfilled: parseInt(document.getElementById('spi-form-fulfilled').value, 10),
      result: document.getElementById('spi-form-result').value,
      improvement: parseInt(document.getElementById('spi-form-improvement').value, 10),
      // Negative-only fields are cleared when the evaluation is positive
      cause_analysis: negative ? document.getElementById('spi-form-cause').value.trim() : '',
      measures: negative ? document.getElementById('spi-form-measures').value.trim() : '',
      decision: negative ? document.getElementById('spi-form-decision').value.trim() : '',
      decision_place: negative ? document.getElementById('spi-form-decision-place').value.trim() : '',
      decided_at: negative ? decidedIso : null,
      closed_at: existing ? (existing.closed_at || null) : null,
    };
    try {
      if (id) await fetchJSON(`/api/spi-evaluations/${id}`, { method: 'PUT', body });
      else await fetchJSON(`/api/safety-objectives/${objectiveId}/spi-evaluations`, { method: 'POST', body });
      closeDialog('spi-dialog');
      toast('Bewertung gespeichert');
      await loadDeptData();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Init ─────────────────────────────────────────────────
  ['meeting-form-date', 'spi-form-date', 'spi-form-decided-at'].forEach(id => {
    initDateAutoFormat(document.getElementById(id));
  });

  async function init() {
    const saved = loadNavState(NAV_STORAGE_KEY);
    if (saved?.activeTab) selectTab(saved.activeTab);
    await loadCompanies();
    if (saved?.selectedId && companies.some(c => c.id === saved.selectedId)) {
      await selectCompany(saved.selectedId, saved.currentDeptId);
    }
  }

  init();
})();
