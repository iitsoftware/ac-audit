/* ── Safety Module (AC-SMS) ────────────────────────────────── */
// Navigation: Firma → Abteilung → Jahr → Meeting
// API endpoints used (routes/safety.js):
//   GET/POST   /api/departments/:id/safety-years
//   PUT/DELETE /api/safety-years/:id
//   GET/POST   /api/safety-years/:id/sms-meetings
//   PUT/DELETE /api/sms-meetings/:id, GET /api/sms-meetings/:id/pdf

(function () {
  let companies = [];
  let selectedId = null;
  let departments = [];
  let currentDeptId = null;
  let years = [];
  let currentYearId = null;
  let meetings = [];

  const NAV_STORAGE_KEY = 'ac-safety-nav-state';
  const ICON_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="12 3 12 15"/><polyline points="8 7 12 3 16 7"/></svg>';

  const companyTabsEl = document.getElementById('company-tabs');
  const deptTabsEl = document.getElementById('dept-tabs');
  const deptTabBar = document.getElementById('dept-tab-bar');
  const emptyEl = document.getElementById('empty-state');
  const contentEl = document.getElementById('safety-content');
  const deptEmptyEl = document.getElementById('safety-dept-empty');
  const yearsEl = document.getElementById('safety-years');
  const yearDetailEl = document.getElementById('year-detail');
  const meetingDetailEl = document.getElementById('meeting-detail');

  // ── Helpers ──────────────────────────────────────────────
  function saveNav() {
    saveNavState(NAV_STORAGE_KEY, { selectedId, currentDeptId, currentYearId });
  }

  function currentYear() {
    return years.find(y => y.id === currentYearId) || null;
  }

  // ── Company / Dept Tabs ──────────────────────────────────
  async function loadCompanies() {
    try { companies = await fetchJSON('/api/companies'); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); companies = []; }
    renderCompanyTabs(companies, selectedId, companyTabsEl, selectCompany);
  }

  async function selectCompany(id, restoreDeptId, restoreYearId) {
    selectedId = id;
    currentDeptId = null;
    currentYearId = null;
    saveNav();
    renderCompanyTabs(companies, selectedId, companyTabsEl, selectCompany);
    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';
    deptEmptyEl.style.display = '';
    yearsEl.style.display = 'none';
    yearDetailEl.style.display = 'none'; // stale year detail must not survive a company switch
    meetingDetailEl.style.display = 'none'; // stale detail form must not survive a company switch
    try { departments = await fetchJSON(`/api/companies/${selectedId}/departments`); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); departments = []; }
    deptTabBar.style.display = 'flex';
    renderDeptTabs(departments, currentDeptId, deptTabsEl, selectDepartment);
    if (restoreDeptId && departments.some(d => d.id === restoreDeptId)) {
      await selectDepartment(restoreDeptId, restoreYearId);
    }
  }

  async function selectDepartment(id, restoreYearId) {
    currentDeptId = id;
    currentYearId = null;
    saveNav();
    renderDeptTabs(departments, currentDeptId, deptTabsEl, selectDepartment);
    deptEmptyEl.style.display = 'none';
    yearDetailEl.style.display = 'none'; // stale year detail must not survive a department switch
    meetingDetailEl.style.display = 'none'; // stale detail form must not survive a department switch
    yearsEl.style.display = 'block';
    await loadYears();
    if (restoreYearId) {
      const year = years.find(y => y.id === restoreYearId);
      if (year) await openYear(year);
    }
  }

  // ── Level 1: Jahre ───────────────────────────────────────
  async function loadYears() {
    if (!currentDeptId) return;
    try {
      years = await fetchJSON(`/api/departments/${currentDeptId}/safety-years`);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      years = [];
    }
    renderYears();
  }

  function renderYears() {
    const grid = document.getElementById('years-grid');
    if (years.length === 0) {
      grid.innerHTML = '<div class="empty-state-inline">Keine Jahre vorhanden</div>';
      return;
    }
    grid.innerHTML = years.map(y => {
      const count = y.meeting_count || 0;
      // A year counts as done as soon as it holds at least one meeting record
      const stateCss = count > 0 ? 'plan-tile-done' : 'plan-tile-wip';
      return `
      <div class="plan-tile ${stateCss}" data-id="${y.id}">
        <div class="plan-tile-year">${y.year}</div>
        <div class="plan-tile-status">${count} Meeting${count === 1 ? '' : 's'}</div>
        <div class="plan-tile-actions">
          <button type="button" class="pane-action-btn" data-action="edit" data-id="${y.id}" title="Bearbeiten" aria-label="Jahr bearbeiten">&#9998;</button>
          <button type="button" class="pane-action-btn danger" data-action="delete" data-id="${y.id}" title="L&ouml;schen" aria-label="Jahr l&ouml;schen">&#128465;</button>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.plan-tile').forEach(tile => {
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const year = years.find(y => y.id === tile.dataset.id);
        if (year) openYear(year);
      });
    });
    grid.querySelectorAll('.pane-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const year = years.find(y => y.id === btn.dataset.id);
        if (!year) return;
        if (btn.dataset.action === 'edit') openYearDialog(year);
        else confirmDeleteYear(year);
      });
    });
  }

  async function openYear(year) {
    currentYearId = year.id;
    saveNav();
    document.getElementById('year-detail-title').textContent = `SRB Meetings ${year.year}`;
    yearsEl.style.display = 'none';
    meetingDetailEl.style.display = 'none';
    yearDetailEl.style.display = 'block';
    await loadMeetings();
  }

  async function closeYear() {
    currentYearId = null;
    meetings = [];
    saveNav();
    yearDetailEl.style.display = 'none';
    meetingDetailEl.style.display = 'none';
    yearsEl.style.display = 'block';
    await loadYears(); // meeting counts on the tiles may have changed
  }

  document.getElementById('year-detail-back').addEventListener('click', closeYear);

  // ── Jahr Dialog (Add / Edit) ─────────────────────────────
  function openYearDialog(year) {
    const isEdit = !!year;
    document.getElementById('year-dialog-title').textContent = isEdit ? 'Jahr bearbeiten' : 'Jahr hinzufügen';
    document.getElementById('year-form-id').value = isEdit ? year.id : '';
    document.getElementById('year-form-year').value = isEdit ? year.year : new Date().getFullYear();
    openDialog('year-dialog');
    document.getElementById('year-form-year').focus();
  }

  function confirmDeleteYear(year) {
    confirmDelete({
      title: 'Jahr löschen',
      message: `<p>Soll das Jahr <strong>${escapeHtml(String(year.year))}</strong> inkl. aller Meetings wirklich gelöscht werden?</p>`,
      onConfirm: async () => {
        await fetchJSON(`/api/safety-years/${year.id}`, { method: 'DELETE' });
        toast('Jahr gelöscht');
        if (currentYearId === year.id) currentYearId = null;
        saveNav();
        await loadYears();
      },
    });
  }

  document.getElementById('btn-add-year').addEventListener('click', () => openYearDialog(null));
  document.getElementById('year-btn-cancel').addEventListener('click', () => closeDialog('year-dialog'));
  document.getElementById('year-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('year-form-id').value;
    const year = parseInt(document.getElementById('year-form-year').value, 10);
    if (!year || isNaN(year)) { toast('Jahr ist erforderlich', 'error'); return; }
    try {
      if (id) await fetchJSON(`/api/safety-years/${id}`, { method: 'PUT', body: { year } });
      else await fetchJSON(`/api/departments/${currentDeptId}/safety-years`, { method: 'POST', body: { year } });
      closeDialog('year-dialog');
      toast('Jahr gespeichert');
      await loadYears();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Level 2: Meetings des Jahres ─────────────────────────
  async function loadMeetings() {
    if (!currentYearId) return;
    try {
      meetings = await fetchJSON(`/api/safety-years/${currentYearId}/sms-meetings`);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      meetings = [];
    }
    renderMeetings();
  }

  function renderMeetings() {
    const container = document.getElementById('meetings-table');
    if (meetings.length === 0) {
      container.innerHTML = '<div class="empty-state-inline" style="padding:16px 0">Keine Einträge</div>';
      return;
    }
    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <thead><tr>
        <th style="width:50px">Lfd.</th><th style="width:90px">SRB Nr.</th><th style="width:110px">Datum</th><th style="width:140px">Ort</th><th>Teilnehmer</th><th>Themen</th><th style="width:100px"></th>
      </tr></thead><tbody>`;
    // Lfd. = laufende Nummer innerhalb des Jahres, abgeleitet aus der
    // chronologischen Reihenfolge — nicht gespeichert, daher lückenlos 1..n.
    meetings.forEach((m, i) => {
      html += `<tr class="ci-row-clickable" data-id="${m.id}">
        <td>${i + 1}</td>
        <td>${escapeHtml(m.meeting_no || '')}</td>
        <td>${escapeHtml(formatDateDE(m.meeting_date))}</td>
        <td class="wrap-cell">${escapeHtml(m.location || '')}</td>
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
        if (meeting) openMeetingDetail(meeting);
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
            await loadMeetings();
          },
        });
      });
    });
  }

  // ── Level 3: Meeting Detail (CM-025) ─────────────────────
  function openMeetingDetail(meeting) {
    const isEdit = !!meeting;
    const year = currentYear();
    document.getElementById('meeting-detail-title').textContent = isEdit ? 'Meeting bearbeiten' : 'Meeting hinzufügen';
    document.getElementById('meeting-form-id').value = isEdit ? meeting.id : '';
    document.getElementById('meeting-form-date').value = isEdit ? (formatDateDE(meeting.meeting_date) || '') : '';
    document.getElementById('meeting-form-location').value = isEdit ? (meeting.location || '') : '';
    document.getElementById('meeting-form-meeting-no').value = isEdit ? (meeting.meeting_no || '') : '';
    document.getElementById('meeting-form-participants').value = isEdit ? (meeting.participants || '') : '';
    document.getElementById('meeting-form-participants-excused').value = isEdit ? (meeting.participants_excused || '') : '';
    document.getElementById('meeting-form-topics').value = isEdit ? (meeting.topics || '') : '';
    document.getElementById('meeting-form-general-result').value = isEdit ? (meeting.general_result || '') : '';
    document.getElementById('meeting-form-positives').value = isEdit ? (meeting.positives || '') : '';
    document.getElementById('meeting-form-negatives').value = isEdit ? (meeting.negatives || '') : '';
    document.getElementById('meeting-form-improvements').value = isEdit ? (meeting.improvements || '') : '';
    document.getElementById('meeting-form-remarks').value = isEdit ? (meeting.remarks || '') : '';
    document.getElementById('meeting-form-outlook').value = isEdit ? (meeting.outlook || '') : '';
    // CM-025 asks for the outlook on the year following the meeting year
    document.getElementById('meeting-form-outlook-year').textContent = year ? String(year.year + 1) : '';
    document.getElementById('meeting-detail-pdf').style.display = isEdit ? '' : 'none';
    yearDetailEl.style.display = 'none';
    meetingDetailEl.style.display = 'block';
  }

  function closeMeetingDetail() {
    meetingDetailEl.style.display = 'none';
    yearDetailEl.style.display = 'block';
  }

  document.getElementById('btn-add-meeting').addEventListener('click', () => openMeetingDetail(null));
  document.getElementById('meeting-detail-back').addEventListener('click', closeMeetingDetail);
  document.getElementById('meeting-btn-cancel').addEventListener('click', closeMeetingDetail);
  document.getElementById('meeting-detail-pdf').addEventListener('click', () => {
    const id = document.getElementById('meeting-form-id').value;
    if (id) window.open(`/api/sms-meetings/${id}/pdf`);
  });
  document.getElementById('meeting-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateIso = parseDateDE(document.getElementById('meeting-form-date').value);
    if (dateIso === undefined) { toast('Ungültiges Datum (TT.MM.JJJJ)', 'error'); return; }
    const id = document.getElementById('meeting-form-id').value;
    const body = {
      meeting_date: dateIso,
      location: document.getElementById('meeting-form-location').value.trim(),
      meeting_no: document.getElementById('meeting-form-meeting-no').value.trim(),
      participants: document.getElementById('meeting-form-participants').value.trim(),
      participants_excused: document.getElementById('meeting-form-participants-excused').value.trim(),
      topics: document.getElementById('meeting-form-topics').value.trim(),
      general_result: document.getElementById('meeting-form-general-result').value.trim(),
      positives: document.getElementById('meeting-form-positives').value.trim(),
      negatives: document.getElementById('meeting-form-negatives').value.trim(),
      improvements: document.getElementById('meeting-form-improvements').value.trim(),
      remarks: document.getElementById('meeting-form-remarks').value.trim(),
      outlook: document.getElementById('meeting-form-outlook').value.trim(),
    };
    try {
      if (id) await fetchJSON(`/api/sms-meetings/${id}`, { method: 'PUT', body });
      else await fetchJSON(`/api/safety-years/${currentYearId}/sms-meetings`, { method: 'POST', body });
      closeMeetingDetail();
      toast('Meeting gespeichert');
      await loadMeetings();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Init ─────────────────────────────────────────────────
  initDateAutoFormat(document.getElementById('meeting-form-date'));

  async function init() {
    const saved = loadNavState(NAV_STORAGE_KEY);
    await loadCompanies();
    if (saved?.selectedId && companies.some(c => c.id === saved.selectedId)) {
      await selectCompany(saved.selectedId, saved.currentDeptId, saved.currentYearId);
    }
  }

  init();
})();
