/* ── Safety Module (AC-SMS) ────────────────────────────────── */
// Navigation: Firma → Abteilung → Jahr → Meeting bzw. SPI-Bewertung
// API endpoints used (routes/safety.js):
//   GET/POST   /api/departments/:id/safety-years
//   PUT/DELETE /api/safety-years/:id
//   GET/POST   /api/safety-years/:id/sms-meetings
//   PUT/DELETE /api/sms-meetings/:id, GET /api/sms-meetings/:id/pdf
//   GET/POST   /api/safety-years/:id/objectives, POST .../seed-objectives
//   PATCH      /api/safety-years/:id/objectives/reorder
//   GET        /api/safety-years/:id/objectives/pdf
//   PUT/DELETE /api/safety-objectives/:id
//   GET/POST   /api/safety-objectives/:id/spi-evaluations
//   PUT        /api/spi-evaluations/:id, GET /api/spi-evaluations/:id/pdf
//   GET        /api/spi-evaluations/pdf?ids=…  (Jahrespaket fürs SRB)

(function () {
  let companies = [];
  let selectedId = null;
  let departments = [];
  let currentDeptId = null;
  let years = [];
  let currentYearId = null;
  let meetings = [];
  let objectives = [];
  // Der Katalog wird erst beim ersten Öffnen des Ziele-Tabs geladen und beim
  // Jahreswechsel wieder verworfen — die Meetings bleiben der Einstieg ins Jahr.
  let objectivesLoaded = false;
  let currentObjective = null; // Ziel, dessen Bewertung gerade im CM-006-Formular steht

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
  const spiDetailEl = document.getElementById('spi-detail');
  const objectivesTableEl = document.getElementById('objectives-table');
  const objectivesEmptyEl = document.getElementById('objectives-empty');
  const objectivesSelectHeader = document.getElementById('objectives-select-header');
  const objectivesSelectAll = document.getElementById('objectives-select-all');

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
    spiDetailEl.style.display = 'none'; // dito für das CM-006-Formular
    resetObjectives();
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
    spiDetailEl.style.display = 'none'; // dito für das CM-006-Formular
    resetObjectives();
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
    // Der Titel benennt das Jahr, die Tabs darunter Meetings bzw. Zielkatalog
    document.getElementById('year-detail-title').textContent = `Safety Year ${year.year}`;
    yearsEl.style.display = 'none';
    meetingDetailEl.style.display = 'none';
    spiDetailEl.style.display = 'none';
    resetObjectives();
    document.getElementById('year-tab-meetings').click(); // jedes Jahr startet auf den Meetings
    yearDetailEl.style.display = 'block';
    await loadMeetings();
  }

  async function closeYear() {
    currentYearId = null;
    meetings = [];
    saveNav();
    yearDetailEl.style.display = 'none';
    meetingDetailEl.style.display = 'none';
    spiDetailEl.style.display = 'none';
    resetObjectives();
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
        <th style="width:50px">Lfd.</th><th style="width:90px">SRB Nr.</th><th style="width:110px">Datum</th><th style="width:140px">Ort</th><th>Teilnehmer</th><th style="width:100px"></th>
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
    // Neues Protokoll startet mit den SRB-Standard-Themen aus dem versteckten
    // Textarea — eine einmalige Kopie, die der Anwender vor dem Speichern noch
    // ändern oder leeren kann. Bestehende Protokolle behalten ihre Themen, eine
    // spätere Änderung des Defaults schreibt sie also nicht um.
    document.getElementById('meeting-form-topics').value = isEdit
      ? (meeting.topics || '')
      : (document.getElementById('srb-default-topics')?.value || '');
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
    spiDetailEl.style.display = 'none';
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

  // ── Level 2b: Sicherheitszielkatalog des Jahres (CM-006) ──
  // Die Tabelle IST die MOE-Anhangtabelle; SPI, Datum und Bewertung stammen aus
  // den last_*-Spalten der API (jüngste Bewertung je Ziel, kein N+1-Read).

  // Inline-Spinner am Button, wie bei den anderen langlaufenden Aktionen
  // (Backup, Deadline-Recalc, E-Mail-Versand, Importe).
  async function withSpinner(btn, label, fn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`;
    try { await fn(); }
    finally { btn.disabled = false; btn.innerHTML = original; }
  }

  function resetObjectives() {
    objectives = [];
    objectivesLoaded = false;
    currentObjective = null;
    objectivesTableEl.innerHTML = '';
    objectivesEmptyEl.style.display = 'none';
    objectivesSelectAll.checked = false;
    objectivesSelectHeader.classList.remove('has-selection');
  }

  async function loadObjectives() {
    if (!currentYearId) return;
    const yearId = currentYearId;
    try {
      const loaded = await fetchJSON(`/api/safety-years/${yearId}/objectives`);
      if (yearId !== currentYearId) return; // Jahr zwischenzeitlich gewechselt
      objectives = loaded;
      objectivesLoaded = true;
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      objectives = [];
    }
    renderObjectives();
  }

  // Monatsaddition mit Klemmung aufs Monatsende: 31.01. + 1 Monat ist der 28./29.02.
  // und nicht der 02./03.03., sonst verschöbe sich die Fälligkeit um Tage.
  function addMonths(isoDate, months) {
    const d = new Date(isoDate);
    if (isNaN(d)) return null;
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  }

  // Fällig = nie bewertet oder letzte Bewertung länger als interval_months her.
  // Stillgelegte Ziele werden nicht angemahnt — sie stehen bewusst nicht mehr
  // im Turnus, sollen aber als Katalogeintrag des Jahres sichtbar bleiben.
  function isObjectiveDue(o) {
    if (!Number(o.active)) return false;
    if (!o.last_eval_date) return true;
    const due = addMonths(o.last_eval_date, o.interval_months || 12);
    return due ? due.getTime() < Date.now() : false;
  }

  function ratingBadge(rating) {
    if (rating === 'POSITIV') return '<span class="eval-badge eval-C">Positiv</span>';
    if (rating === 'NEGATIV') return '<span class="eval-badge eval-L2">Negativ</span>';
    return '';
  }

  function renderObjectives() {
    objectivesSelectAll.checked = false;
    objectivesSelectHeader.classList.remove('has-selection');

    if (objectives.length === 0) {
      objectivesTableEl.innerHTML = '';
      renderObjectivesEmptyState();
      return;
    }
    objectivesEmptyEl.style.display = 'none';

    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <thead><tr>
        <th style="width:44px">Nr.</th>
        <th>Sicherheitsziel</th>
        <th style="width:130px">SPT</th>
        <th style="width:80px">Intervall</th>
        <th style="width:70px">SPI</th>
        <th style="width:110px">Datum der Feststellung</th>
        <th style="width:90px">Bewertung</th>
        <th style="width:96px"><span class="sr-only">Reihenfolge</span></th>
        <th style="width:100px"></th>
        <th class="col-select"><span class="sr-only">Auswahl</span></th>
      </tr></thead><tbody>`;
    // Nr. = laufende Nummer im Katalog, abgeleitet aus der sortierten Liste —
    // nicht gespeichert, daher lückenlos 1..n (wie die Lfd. der SRB-Tabelle).
    objectives.forEach((o, i) => {
      const inactive = !Number(o.active);
      const subline = [o.objective, inactive ? 'inaktiv' : ''].filter(Boolean).join(' · ');
      const evalId = o.last_evaluation_id || '';
      html += `<tr class="ci-row-clickable" data-id="${o.id}">
        <td>${i + 1}</td>
        <td class="wrap-cell">
          <strong>${escapeHtml(o.title || '')}</strong>${isObjectiveDue(o) ? ' <span class="eval-badge eval-O">f&auml;llig</span>' : ''}
          ${subline ? `<div class="form-hint">${escapeHtml(subline)}</div>` : ''}
        </td>
        <td class="wrap-cell">${escapeHtml(o.spt || '')}</td>
        <td>${escapeHtml(String(o.interval_months || 12))} Mon.</td>
        <td>${escapeHtml(o.last_spi_value || '')}</td>
        <td>${escapeHtml(formatDateDE(o.last_eval_date))}</td>
        <td>${ratingBadge(o.last_rating)}</td>
        <td>
          <button type="button" class="reorder-btn" data-action="up" data-id="${o.id}" title="Nach oben" aria-label="Ziel nach oben verschieben"${i === 0 ? ' disabled' : ''}>&#9650;</button>
          <button type="button" class="reorder-btn" data-action="down" data-id="${o.id}" title="Nach unten" aria-label="Ziel nach unten verschieben"${i === objectives.length - 1 ? ' disabled' : ''}>&#9660;</button>
        </td>
        <td class="line-actions">
          <button type="button" class="pane-action-btn" data-action="new-eval" data-id="${o.id}" title="Neue Bewertung" aria-label="Neue Bewertung anlegen">+</button>
          ${evalId ? `<button type="button" class="btn-icon" data-action="pdf" data-eval-id="${evalId}" title="Letzte Bewertung als PDF" aria-label="Letzte Bewertung als PDF exportieren">${ICON_SHARE}</button>` : ''}
          <button type="button" class="pane-action-btn" data-action="edit" data-id="${o.id}" title="Katalogfelder bearbeiten" aria-label="Sicherheitsziel bearbeiten">&#9998;</button>
          <button type="button" class="pane-action-btn danger" data-action="delete" data-id="${o.id}" title="L&ouml;schen" aria-label="Sicherheitsziel l&ouml;schen">&#128465;</button>
        </td>
        <td class="col-select">${evalId ? `<input type="checkbox" class="spi-select-cb" data-eval-id="${evalId}" aria-label="Bewertung ausw&auml;hlen">` : ''}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    objectivesTableEl.innerHTML = html;

    objectivesTableEl.querySelectorAll('tr[data-id]').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('button') || e.target.closest('.col-select')) return;
        const objective = objectives.find(o => o.id === row.dataset.id);
        if (objective) openLatestEvaluation(objective);
      });
    });
    objectivesTableEl.querySelectorAll('[data-action="up"], [data-action="down"]').forEach(btn => {
      btn.addEventListener('click', () => moveObjective(btn.dataset.id, btn.dataset.action === 'up' ? -1 : 1));
    });
    objectivesTableEl.querySelectorAll('[data-action="pdf"]').forEach(btn => {
      btn.addEventListener('click', () => window.open(`/api/spi-evaluations/${btn.dataset.evalId}/pdf`));
    });
    objectivesTableEl.querySelectorAll('[data-action="new-eval"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const objective = objectives.find(o => o.id === btn.dataset.id);
        if (objective) openSpiDetail(objective, null);
      });
    });
    objectivesTableEl.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const objective = objectives.find(o => o.id === btn.dataset.id);
        if (objective) openObjectiveDialog(objective);
      });
    });
    objectivesTableEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const objective = objectives.find(o => o.id === btn.dataset.id);
        if (!objective) return;
        confirmDelete({
          title: 'Sicherheitsziel löschen',
          message: `<p>Soll das Ziel <strong>${escapeHtml(objective.title || '')}</strong> inkl. aller Bewertungen wirklich gelöscht werden?</p>`,
          onConfirm: async () => {
            await fetchJSON(`/api/safety-objectives/${objective.id}`, { method: 'DELETE' });
            toast('Sicherheitsziel gelöscht');
            await loadObjectives();
          },
        });
      });
    });
  }

  // Leerer Katalog — normal nur bei einem manuell geleerten Jahr oder bei
  // Bestandsjahren aus DBs vor dem Seeding: neue Jahre bekommen ihren Katalog
  // schon beim Anlegen. Das Vorjahr wird clientseitig gesucht, weil "Vorjahr mit
  // Katalog" nicht zwingend year - 1 ist und die API es nicht ausweist.
  async function renderObjectivesEmptyState() {
    const copyBtn = document.getElementById('btn-copy-prev-catalog');
    copyBtn.style.display = 'none';
    objectivesEmptyEl.style.display = '';
    const yearId = currentYearId;
    const prev = await findPrevYearWithObjectives();
    if (!prev || yearId !== currentYearId || objectives.length) return;
    document.getElementById('objectives-prev-year').textContent = String(prev.year);
    copyBtn.style.display = '';
  }

  async function findPrevYearWithObjectives() {
    const year = currentYear();
    if (!year) return null;
    const candidates = years.filter(y => y.year < year.year).sort((a, b) => b.year - a.year);
    for (const candidate of candidates) {
      try {
        const list = await fetchJSON(`/api/safety-years/${candidate.id}/objectives`);
        if (list.length) return candidate;
      } catch { /* Jahr inzwischen gelöscht — nächsten Kandidaten prüfen */ }
    }
    return null;
  }

  async function seedObjectives(btn, source) {
    if (!currentYearId) return;
    try {
      await withSpinner(btn, 'Lade...', async () => {
        const result = await fetchJSON(`/api/safety-years/${currentYearId}/seed-objectives`, {
          method: 'POST', body: { source },
        });
        toast(`${result.created} Ziel${result.created === 1 ? '' : 'e'} übernommen`);
      });
      await loadObjectives();
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  // Reorder schickt die komplette neue Reihenfolge; die Route antwortet mit dem
  // umsortierten Katalog, ein Nachladen erübrigt sich damit.
  async function moveObjective(id, delta) {
    const from = objectives.findIndex(o => o.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= objectives.length) return;
    const ids = objectives.map(o => o.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    try {
      objectives = await fetchJSON(`/api/safety-years/${currentYearId}/objectives/reorder`, {
        method: 'PATCH', body: { ids },
      });
      renderObjectives();
      // Der Fokus wandert mit der Zeile, sonst verliert die Tastaturbedienung
      // nach jedem Schritt ihren Platz.
      const moved = objectivesTableEl.querySelector(`[data-action="${delta < 0 ? 'up' : 'down'}"][data-id="${id}"]`);
      if (moved && !moved.disabled) moved.focus();
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  // ── Mehrfachauswahl der Bewertungen → Jahrespaket fürs SRB ──
  // Eine Zeile steht für ihre jüngste Bewertung; Ziele ohne Bewertung haben
  // deshalb gar keine Checkbox statt einer, die nichts exportieren könnte.
  function updateObjectivesSelection() {
    const any = !!objectivesTableEl.querySelector('.spi-select-cb:checked');
    objectivesSelectHeader.classList.toggle('has-selection', any);
  }

  objectivesSelectAll.addEventListener('change', () => {
    objectivesTableEl.querySelectorAll('.spi-select-cb').forEach(cb => { cb.checked = objectivesSelectAll.checked; });
    updateObjectivesSelection();
  });
  objectivesTableEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('spi-select-cb')) updateObjectivesSelection();
  });
  document.getElementById('objectives-share').addEventListener('click', () => {
    const ids = [...objectivesTableEl.querySelectorAll('.spi-select-cb:checked')].map(cb => cb.dataset.evalId);
    if (ids.length === 0) { toast('Keine Bewertungen ausgewählt', 'error'); return; }
    window.open(`/api/spi-evaluations/pdf?ids=${ids.join(',')}`);
  });

  document.getElementById('btn-objectives-pdf').addEventListener('click', () => {
    if (currentYearId) window.open(`/api/safety-years/${currentYearId}/objectives/pdf`);
  });
  document.getElementById('btn-add-objective').addEventListener('click', () => openObjectiveDialog(null));
  document.getElementById('btn-copy-prev-catalog').addEventListener('click', (e) => seedObjectives(e.currentTarget, 'previous'));
  document.getElementById('btn-load-default-catalog').addEventListener('click', (e) => seedObjectives(e.currentTarget, 'default'));
  // Der Katalog wird erst geladen, wenn sein Tab zum ersten Mal geöffnet wird.
  document.getElementById('year-tab-objectives').addEventListener('click', () => {
    if (!objectivesLoaded) loadObjectives();
  });

  // ── Ziel-Dialog (Katalogfelder CM-006) ───────────────────
  function openObjectiveDialog(objective) {
    const isEdit = !!objective;
    document.getElementById('objective-dialog-title').textContent = isEdit ? 'Sicherheitsziel bearbeiten' : 'Sicherheitsziel hinzufügen';
    document.getElementById('objective-form-id').value = isEdit ? objective.id : '';
    document.getElementById('objective-form-title').value = isEdit ? (objective.title || '') : '';
    document.getElementById('objective-form-objective').value = isEdit ? (objective.objective || '') : '';
    document.getElementById('objective-form-spt').value = isEdit ? (objective.spt || '') : '';
    document.getElementById('objective-form-spt-direction').value = isEdit ? (objective.spt_direction || '') : '';
    document.getElementById('objective-form-spt-value').value = isEdit && objective.spt_value !== null && objective.spt_value !== undefined ? objective.spt_value : '';
    document.getElementById('objective-form-spi-description').value = isEdit ? (objective.spi_description || '') : '';
    document.getElementById('objective-form-interval-months').value = isEdit ? (objective.interval_months || 12) : 12;
    document.getElementById('objective-form-active').value = isEdit && !Number(objective.active) ? '0' : '1';
    openDialog('objective-dialog');
    document.getElementById('objective-form-title').focus();
  }

  document.getElementById('objective-btn-cancel').addEventListener('click', () => closeDialog('objective-dialog'));
  document.getElementById('objective-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('objective-form-id').value;
    const title = document.getElementById('objective-form-title').value.trim();
    if (!title) { toast('Titel ist erforderlich', 'error'); return; }
    const body = {
      title,
      objective: document.getElementById('objective-form-objective').value.trim(),
      spt: document.getElementById('objective-form-spt').value.trim(),
      spt_direction: document.getElementById('objective-form-spt-direction').value,
      spt_value: document.getElementById('objective-form-spt-value').value,
      spi_description: document.getElementById('objective-form-spi-description').value.trim(),
      interval_months: document.getElementById('objective-form-interval-months').value,
      active: document.getElementById('objective-form-active').value,
    };
    try {
      if (id) await fetchJSON(`/api/safety-objectives/${id}`, { method: 'PUT', body });
      else await fetchJSON(`/api/safety-years/${currentYearId}/objectives`, { method: 'POST', body });
      closeDialog('objective-dialog');
      toast('Sicherheitsziel gespeichert');
      await loadObjectives();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Level 3: SPI-Bewertung (CM-006 Formular) ─────────────
  // Zeilenklick öffnet die jüngste Bewertung des Ziels; hat es noch keine, wird
  // ein leeres Formular für die erste angelegt.
  async function openLatestEvaluation(objective) {
    let evaluations = [];
    try {
      evaluations = await fetchJSON(`/api/safety-objectives/${objective.id}/spi-evaluations`);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      return;
    }
    // Die Liste ist chronologisch aufsteigend sortiert — die letzte ist die jüngste.
    openSpiDetail(objective, evaluations.length ? evaluations[evaluations.length - 1] : null);
  }

  // Effektive Werte wie getSpiEvaluation sie als eff_* liefert: ?? bildet die
  // COALESCE-Semantik exakt ab — nur NULL fällt auf den Katalog zurück, ein
  // leerer Snapshot ist ein gültiger Einfrierstand einer unterschriebenen
  // Bewertung und darf nicht durch den heutigen SPT ersetzt werden.
  function effectiveContext(objective, evaluation) {
    return {
      objective: evaluation?.objective_snapshot ?? objective.title,
      spt: evaluation?.spt_snapshot ?? objective.spt,
      interval: evaluation?.interval_snapshot ?? objective.interval_months,
    };
  }

  function contextRow(label, value) {
    return `<div class="cap-info-row"><span class="cap-info-label">${label}</span><span>${escapeHtml(value || '')}</span></div>`;
  }

  function openSpiDetail(objective, evaluation) {
    currentObjective = objective;
    const eff = effectiveContext(objective, evaluation);
    const signed = !!(evaluation && evaluation.decided_at);
    document.getElementById('spi-detail-title').textContent = evaluation ? 'Bewertung bearbeiten' : 'Neue Bewertung';
    document.getElementById('spi-form-id').value = evaluation ? evaluation.id : '';
    document.getElementById('spi-form-objective-id').value = objective.id;
    document.getElementById('spi-form-context').innerHTML =
      contextRow('Sicherheitsziel', eff.objective)
      + (objective.objective ? contextRow('Zielsatz', objective.objective) : '')
      + contextRow('SPT', eff.spt)
      + contextRow('Intervall', `${eff.interval || 12} Monate`)
      + (objective.spi_description ? contextRow('SPI', objective.spi_description) : '')
      // Nach der Unterschrift stehen hier die eingefrorenen Werte — sichtbar
      // machen, warum sie von einem später korrigierten Katalog abweichen können.
      + (signed ? contextRow('Stand', 'Eingefroren mit der Unterschrift') : '');

    document.getElementById('spi-form-eval-date').value = evaluation ? (formatDateDE(evaluation.eval_date) || '') : '';
    document.getElementById('spi-form-spi-value').value = evaluation ? (evaluation.spi_value || '') : '';
    document.getElementById('spi-form-result-text').value = evaluation ? (evaluation.result_text || '') : '';
    const rating = evaluation ? (evaluation.rating || '') : '';
    document.getElementById('spi-form-rating-positiv').checked = rating === 'POSITIV';
    document.getElementById('spi-form-rating-negativ').checked = rating === 'NEGATIV';
    document.getElementById('spi-form-cause-analysis').value = evaluation ? (evaluation.cause_analysis || '') : '';
    document.getElementById('spi-form-measures').value = evaluation ? (evaluation.measures || '') : '';
    document.getElementById('spi-form-decision').value = evaluation ? (evaluation.decision || '') : '';
    document.getElementById('spi-form-decision-place').value = evaluation ? (evaluation.decision_place || '') : '';
    document.getElementById('spi-form-decided-at').value = evaluation ? (formatDateDE(evaluation.decided_at) || '') : '';
    document.getElementById('spi-form-copy-to').value = evaluation ? (evaluation.copy_to || '') : '';
    document.getElementById('spi-detail-pdf').style.display = evaluation ? '' : 'none';
    updateRatingHint();

    yearDetailEl.style.display = 'none';
    meetingDetailEl.style.display = 'none';
    spiDetailEl.style.display = 'block';
  }

  function closeSpiDetail() {
    currentObjective = null;
    spiDetailEl.style.display = 'none';
    yearDetailEl.style.display = 'block';
    document.getElementById('year-tab-objectives').click(); // zurück auf den Katalog-Tab
  }

  // Nur eine reine Zahl zählt: spi_value und spt_value tragen im Original auch
  // "Erfüllt" oder "2. Quartal" — daraus darf kein Vorschlag entstehen. Das
  // deutsche Dezimalkomma wird vorher auf den Punkt normalisiert.
  function parseNumericValue(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(raw) ? parseFloat(raw) : null;
  }

  // Bewertungsvorschlag — rein clientseitig, schreibt NICHTS und setzt die Radios
  // nie: die Original-CM-006-Formulare bewerten SPT 20 / SPI 0 auch schon mal als
  // "Erfüllt / Positiv". Die fachliche Entscheidung liegt beim Safety Manager,
  // der Hinweis rechnet ihm nur den Soll-Ist-Vergleich vor.
  function updateRatingHint() {
    const hint = document.getElementById('spi-form-rating-hint');
    const direction = currentObjective ? currentObjective.spt_direction : '';
    const target = parseNumericValue(currentObjective ? currentObjective.spt_value : null);
    const raw = document.getElementById('spi-form-spi-value').value.trim();
    const spi = parseNumericValue(raw);
    if ((direction !== 'MIN' && direction !== 'MAX') || target === null || spi === null) {
      hint.textContent = '';
      return;
    }
    const met = direction === 'MIN' ? spi >= target : spi <= target;
    const operator = direction === 'MIN' ? (met ? '≥' : '<') : (met ? '≤' : '>');
    const bound = direction === 'MIN' ? 'min.' : 'max.';
    hint.textContent = `Vorschlag: ${met ? 'Positiv' : 'Negativ'} (SPI ${raw} ${operator} SPT ${bound} ${target.toLocaleString('de-DE', { maximumFractionDigits: 3 })})`;
  }

  document.getElementById('spi-form-spi-value').addEventListener('input', updateRatingHint);
  document.getElementById('spi-detail-back').addEventListener('click', closeSpiDetail);
  document.getElementById('spi-btn-cancel').addEventListener('click', closeSpiDetail);
  document.getElementById('spi-detail-pdf').addEventListener('click', () => {
    const id = document.getElementById('spi-form-id').value;
    if (id) window.open(`/api/spi-evaluations/${id}/pdf`);
  });
  document.getElementById('spi-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const evalDate = parseDateDE(document.getElementById('spi-form-eval-date').value);
    if (evalDate === undefined) { toast('Ungültiges Datum der Feststellung (TT.MM.JJJJ)', 'error'); return; }
    const decidedAt = parseDateDE(document.getElementById('spi-form-decided-at').value);
    if (decidedAt === undefined) { toast('Ungültiges Datum der Unterschrift (TT.MM.JJJJ)', 'error'); return; }
    const id = document.getElementById('spi-form-id').value;
    const objectiveId = document.getElementById('spi-form-objective-id').value;
    const checked = document.querySelector('input[name="spi-rating"]:checked');
    const body = {
      eval_date: evalDate,
      spi_value: document.getElementById('spi-form-spi-value').value.trim(),
      result_text: document.getElementById('spi-form-result-text').value.trim(),
      rating: checked ? checked.value : '',
      cause_analysis: document.getElementById('spi-form-cause-analysis').value.trim(),
      measures: document.getElementById('spi-form-measures').value.trim(),
      decision: document.getElementById('spi-form-decision').value.trim(),
      decision_place: document.getElementById('spi-form-decision-place').value.trim(),
      decided_at: decidedAt,
      copy_to: document.getElementById('spi-form-copy-to').value.trim(),
    };
    try {
      await withSpinner(document.getElementById('spi-btn-save'), 'Speichere...', async () => {
        if (id) await fetchJSON(`/api/spi-evaluations/${id}`, { method: 'PUT', body });
        else await fetchJSON(`/api/safety-objectives/${objectiveId}/spi-evaluations`, { method: 'POST', body });
      });
      closeSpiDetail();
      toast('Bewertung gespeichert');
      await loadObjectives(); // SPI, Datum und Bewertung der Katalogzeile ändern sich
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Init ─────────────────────────────────────────────────
  initDateAutoFormat(document.getElementById('meeting-form-date'));
  initDateAutoFormat(document.getElementById('spi-form-eval-date'));
  initDateAutoFormat(document.getElementById('spi-form-decided-at'));

  async function init() {
    const saved = loadNavState(NAV_STORAGE_KEY);
    await loadCompanies();
    if (saved?.selectedId && companies.some(c => c.id === saved.selectedId)) {
      await selectCompany(saved.selectedId, saved.currentDeptId, saved.currentYearId);
    }
  }

  init();
})();
