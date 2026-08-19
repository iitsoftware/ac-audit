/* ── Companies Page ───────────────────────────────────────── */

(function () {
  let companies = [];
  let selectedId = null;

  // Drill-down path: [{type, id, name}, ...]
  // Empty = show departments for selected company
  let navPath = [];
  let capFilter = null; // null = all, 'OPEN', 'CLOSED'
  let auditLineFilters = new Set(); // tag filter keys for audit plan detail

  // ── Reusable SVG Icons ──────────────────────────────────────
  const ICON_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="12 3 12 15"/><polyline points="8 7 12 3 16 7"/></svg>';
  const ICON_IMPORT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/><polyline points="12 15 12 3"/><polyline points="8 11 12 15 16 11"/></svg>';

  // ── LocalStorage Persistence ────────────────────────────────
  const NAV_STORAGE_KEY = 'ac-audit-nav-state';

  function saveNav() {
    saveNavState(NAV_STORAGE_KEY, {
      selectedId,
      navPath,
      capFilter,
      auditLineFilters: [...auditLineFilters],
    });
  }

  function loadNav() {
    return loadNavState(NAV_STORAGE_KEY);
  }

  const companyTabsEl = document.getElementById('company-tabs');
  const companyTabBar = document.getElementById('company-tab-bar');
  const deptTabsEl = document.getElementById('dept-tabs');
  const deptTabBar = document.getElementById('dept-tab-bar');
  const emptyEl = document.getElementById('empty-state');
  const rightPane = document.getElementById('right-pane-content');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const headerEl = document.getElementById('pane-content-header');
  const contentEl = document.getElementById('pane-content-list');
  const planDialog = document.getElementById('plan-dialog');
  const planDeleteDialog = document.getElementById('plan-delete-dialog');
  const lineDeleteDialog = document.getElementById('line-delete-dialog');
  const ciDialog = document.getElementById('checklist-item-dialog');
  const ciDeleteDialog = document.getElementById('checklist-item-delete-dialog');
  const newPlanDialog = document.getElementById('new-plan-dialog');
  const revisionSelectDialog = document.getElementById('revision-select-dialog');
  const templateSelectDialog = document.getElementById('template-select-dialog');

  let persons = [];

  const MONTH_ORDER = {
    'Januar': 1, 'Februar': 2, 'März': 3, 'April': 4,
    'Mai': 5, 'Juni': 6, 'Juli': 7, 'August': 8,
    'September': 9, 'Oktober': 10, 'November': 11, 'Dezember': 12
  };

  // ── Load & Render Company List ────────────────────────────
  async function loadCompanies() {
    try {
      companies = await fetchJSON('/api/companies');
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      companies = [];
    }
    renderCompanyTabsLocal();
  }

  function renderCompanyTabsLocal() {
    renderCompanyTabs(companies, selectedId, companyTabsEl, selectCompany);
  }

  function renderDeptTabsLocal() {
    const activeDeptId = navPath.length > 0 && navPath[0].type === 'department' ? navPath[0].id : null;
    renderDeptTabs(departments, activeDeptId, deptTabsEl, selectDepartment);
  }

  function selectDepartment(id) {
    const dept = departments.find(d => d.id === id);
    if (!dept) return;
    navPath = [{ type: 'department', id: dept.id, name: dept.name }];
    saveNav();
    renderDeptTabsLocal();
    renderCurrentLevel();
  }

  // ── Navigation ────────────────────────────────────────────
  function getSelectedCompany() {
    return companies.find(c => c.id === selectedId);
  }

  async function selectCompany(id) {
    selectedId = id;
    navPath = [];
    auditLineFilters = new Set();
    capFilter = null;
    saveNav();
    renderCompanyTabsLocal();
    emptyEl.style.display = 'none';
    rightPane.style.display = 'block';
    await loadDepartments();
    deptTabBar.style.display = 'flex';
    renderDeptTabsLocal();
    await renderCurrentLevel();
  }

  function showEmpty() {
    selectedId = null;
    navPath = [];
    auditLineFilters = new Set();
    capFilter = null;
    saveNav();
    emptyEl.style.display = 'flex';
    rightPane.style.display = 'none';
    deptTabBar.style.display = 'none';
    contentEl.innerHTML = '';
    renderCompanyTabsLocal();
  }

  // Eine Ebene tiefer springen: Segment anhängen und neu rendern. renderCurrentLevel()
  // schreibt den Nav-Pfad selbst weg, deshalb bleibt hier nur der Push.
  function pushNavSegment(segment) {
    navPath.push(segment);
    return renderCurrentLevel();
  }

  async function navigateTo(index) {
    if (index < 0) {
      navPath = [];
    } else {
      navPath = navPath.slice(0, index + 1);
    }
    saveNav();
    renderDeptTabsLocal();
    await renderCurrentLevel();
  }

  function paintBreadcrumb() {
    const company = getSelectedCompany();
    if (!company) return;

    // Breadcrumb skips department (shown as tab)
    const bcSegments = navPath.filter(s => s.type !== 'department');
    // If the only segment is audit-plan itself, don't show breadcrumb
    if (bcSegments.length === 1 && bcSegments[0].type === 'audit-plan') {
      breadcrumbEl.innerHTML = '';
      return;
    }

    const segments = bcSegments.map(seg => ({ label: seg.name, navIdx: navPath.indexOf(seg) }));
    renderBreadcrumb(segments, breadcrumbEl, (seg) => navigateTo(seg.navIdx), {
      backButton: { title: 'Zur\u00fcck zur \u00dcbersicht', onClick: () => { window.location.href = '/home'; } }
    });
  }

  async function renderCurrentLevel() {
    saveNav();
    paintBreadcrumb();

    const lastSegment = navPath.length > 0 ? navPath[navPath.length - 1] : null;

    if (!lastSegment) {
      headerEl.innerHTML = '';
      contentEl.innerHTML = '<div class="empty-state-inline">Abteilung ausw\u00e4hlen</div>';
      return;
    } else if (lastSegment.type === 'department') {
      await renderAuditPlanLevel(lastSegment.id);
    } else if (lastSegment.type === 'audit-plan') {
      await renderAuditPlanDetailLevel(lastSegment.id);
    } else if (lastSegment.type === 'audit-plan-line') {
      await renderLineDetailLevel(lastSegment.id);
    } else if (lastSegment.type === 'finding') {
      await renderFindingLevel(lastSegment.id);
    } else if (lastSegment.type === 'cap-item') {
      await renderCapDetailLevel(lastSegment.id);
    }
  }

  // ── Department Level ──────────────────────────────────────
  let departments = [];

  async function loadDepartments() {
    if (!selectedId) return;
    try {
      departments = await fetchJSON(`/api/companies/${selectedId}/departments`);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      departments = [];
    }
    renderDeptTabsLocal();
  }

  async function loadPersons() {
    if (!selectedId) return;
    try {
      persons = await fetchJSON(`/api/companies/${selectedId}/persons`);
    } catch { persons = []; }
  }

  // ── Audit Plan Level ───────────────────────────────────────
  let auditPlans = [];
  let currentDeptId = null;

  async function renderAuditPlanLevel(departmentId) {
    currentDeptId = departmentId;
    headerEl.innerHTML = `
      <h2>Auditpl&auml;ne</h2>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" id="btn-import-plan" title="Auditplan aus .docx importieren">${ICON_IMPORT}</button>
        <button class="btn-icon" id="btn-add-plan" title="Auditplan hinzuf&uuml;gen">+</button>
      </div>
    `;
    document.getElementById('btn-add-plan').addEventListener('click', () => openNewPlanDialog());
    document.getElementById('btn-import-plan').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });

    await loadAuditPlans();
  }

  async function loadAuditPlans() {
    if (!currentDeptId) return;
    try {
      auditPlans = await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      auditPlans = [];
    }
    renderAuditPlans();
  }

  // ── Beschriftung eines Behördenaudits ──────────────────────
  // Ein Behördenaudit wird ausschließlich aus seinem Beanstandungsbericht
  // beschriftet, nie aus audit_plan.year: das Jahr bleibt Pflicht- und Sortierspalte
  // der Route, hat in der Oberfläche aber keine Bedeutung — ein frisch angelegter
  // Besuch hieße sonst schlicht "2026". Quelle sind Datum und Behörde des Berichts;
  // solange er noch kein Datum trägt, sagt die Beschriftung genau das, statt eine
  // Jahreszahl zu erfinden.
  const AUTHORITY_NO_DATE = 'Behördenaudit (ohne Datum)';

  // Titelzeile der Kachel: das Datum des Besuchs — die Behörde steht darunter.
  function authorityTitle(dateIso) {
    return formatDateDE(dateIso) || AUTHORITY_NO_DATE;
  }

  // Breadcrumb-Segment und Überschrift: dasselbe Datum, aber mit dem Wort davor —
  // außerhalb der Kachel wäre die Beschriftung sonst ein nacktes Datum — und der
  // Behörde dahinter, soweit sie auf dem Bericht steht.
  function authorityName(dateIso, auditorTeam) {
    const date = formatDateDE(dateIso);
    const head = date ? `Behördenaudit ${date}` : AUTHORITY_NO_DATE;
    return auditorTeam ? `${head} – ${auditorTeam}` : head;
  }

  // Die Plan-Liste bringt Datum und Behörde als authority_date /
  // authority_auditor_team mit. Die Plan-Ebene erreicht nur noch der Altbestand
  // (0 oder mehrere Berichte — genau der Fall, in dem das Statement die beiden
  // Spalten NULL liefert); sie hat aber ihre Zeilen geladen und leitet dasselbe
  // Datum in derselben COALESCE-Reihenfolge daraus ab.
  function authorityInfoFromLines(lines) {
    const list = lines || [];
    const dated = list.find(l => l.performed_date || l.audit_end_date || l.audit_start_date);
    const teamed = list.find(l => l.auditor_team);
    return {
      date: dated ? (dated.performed_date || dated.audit_end_date || dated.audit_start_date) : '',
      team: teamed ? teamed.auditor_team : '',
    };
  }

  function renderAuditPlans() {
    if (auditPlans.length === 0) {
      contentEl.innerHTML = '<div class="empty-state-inline">Keine Auditpl\u00e4ne vorhanden</div>';
      return;
    }
    // Sort by year desc, then revision desc
    const byYear = (a, b) => b.year - a.year || (b.revision || 0) - (a.revision || 0);
    // Ein Behördenaudit sortiert nach dem Datum seines Besuchs statt nach dem Jahr:
    // die Jahreszahl steht auf keiner seiner Kacheln, und pro Besuch existiert ein
    // eigener Plan — nach year sortiert stünden mehrere Besuche desselben Jahres in
    // beliebiger Reihenfolge. authority_date liefert die Plan-Liste bereits mit
    // (COALESCE aus performed_date / audit_end_date / audit_start_date), es ist ein
    // ISO-Datum, dessen String-Vergleich chronologisch ist. Ein Bericht ohne Datum —
    // also ein frisch angelegter — sortiert ans Ende seiner Gruppe, statt zwischen
    // datierten Besuchen zu verschwinden; sind beide ohne Datum, bleibt die alte
    // Ordnung nach Jahr und Revision als stabiler Rest.
    const byAuthorityDate = (a, b) => {
      const da = a.authority_date || '';
      const db = b.authority_date || '';
      if (da && db) return db.localeCompare(da);
      if (da || db) return da ? -1 : 1;
      return byYear(a, b);
    };
    function derivePlanStatus(p) {
      if ((p.plan_type || 'AUDIT') === 'AUTHORITY') return { css: 'plan-tile-authority', label: 'Aktiv' };
      if (p.submitted_at) return { css: 'plan-tile-done', label: 'Erledigt' };
      if (p.approved_at || p.submitted_planned_at) return { css: 'plan-tile-planned', label: 'Geplant' };
      return { css: 'plan-tile-wip', label: 'In Arbeit' };
    }
    function renderTile(p) {
      const total = p.audit_total || 0;
      const done = p.audit_done || 0;
      const pct = total > 0 ? Math.round(done / total * 100) : 0;
      const isAuthority = (p.plan_type || 'AUDIT') === 'AUTHORITY';
      const progressHtml = total > 0
        ? `<div class="plan-progress">
            <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${pct}%"></div></div>
            <span class="plan-progress-label">${done}/${total}</span>
           </div>`
        : '';
      const st = derivePlanStatus(p);
      // Ein Behördenaudit kennt keine Revision: die Kachel zeigt stattdessen Datum
      // und Behörde des Besuchs, soweit sie auf der Beanstandungsberichts-Zeile
      // stehen (authority_date / authority_auditor_team aus der Plan-Liste). Fehlt
      // das Datum, sagt der Titel das — die Jahreszahl taucht bei einem
      // Behördenaudit nirgends auf; die zweite Zeile entfällt ohne Behörde.
      const tileTitle = isAuthority ? authorityTitle(p.authority_date) : String(p.year);
      const tileSub = isAuthority ? (p.authority_auditor_team || '') : `Rev. ${p.revision || 0}`;
      return `
      <div class="plan-tile ${st.css}" data-id="${p.id}">
        <div class="plan-tile-year">${escapeHtml(tileTitle)}</div>
        ${tileSub ? `<div class="plan-tile-rev">${escapeHtml(tileSub)}</div>` : ''}
        <div class="plan-tile-status">${st.label}</div>
        ${progressHtml}
        <div class="plan-tile-actions">
          ${isAuthority ? '' : `<button class="pane-action-btn" data-action="edit-plan" data-id="${p.id}" title="Bearbeiten">&#9998;</button>`}
          <button class="pane-action-btn danger" data-action="delete-plan" data-id="${p.id}" title="L\u00f6schen">&#128465;</button>
        </div>
      </div>`;
    }
    const isAuthorityPlan = p => (p.plan_type || 'AUDIT') === 'AUTHORITY';
    const auditSorted = auditPlans.filter(p => !isAuthorityPlan(p)).sort(byYear);
    const authoritySorted = auditPlans.filter(isAuthorityPlan).sort(byAuthorityDate);
    let gridHtml = '';
    if (auditSorted.length > 0) {
      if (authoritySorted.length > 0) gridHtml += '<div class="plan-group-label">Auditpl\u00e4ne</div>';
      gridHtml += '<div class="plan-tile-grid">' + auditSorted.map(renderTile).join('') + '</div>';
    }
    if (authoritySorted.length > 0) {
      if (auditSorted.length > 0) gridHtml += '<div class="plan-group-label">Beh\u00f6rdenaudits</div>';
      gridHtml += '<div class="plan-tile-grid">' + authoritySorted.map(renderTile).join('') + '</div>';
    }
    contentEl.innerHTML = gridHtml;

    contentEl.querySelectorAll('.plan-tile').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const id = card.dataset.id;
        const plan = auditPlans.find(p => p.id === id);
        if (!plan) return;
        const isAuthority = (plan.plan_type || 'AUDIT') === 'AUTHORITY';
        // Ein Behördenaudit hat genau einen Beanstandungsbericht — die Plan-Ebene
        // wäre eine Liste mit einer Zeile. Der Klick springt deshalb direkt auf die
        // Line. Fehlt die Line-ID (Altbestand mit 0 oder mehreren Zeilen, dann liefert
        // das Statement NULL), bleibt es bei der Plan-Ebene.
        if (isAuthority && plan.authority_line_id) {
          pushNavSegment({ type: 'audit-plan-line', id: plan.authority_line_id, name: authorityName(plan.authority_date, plan.authority_auditor_team) });
        } else {
          const pName = isAuthority ? authorityName(plan.authority_date, plan.authority_auditor_team) : `Auditplan ${plan.year} Rev. ${plan.revision || 0}`;
          pushNavSegment({ type: 'audit-plan', id: plan.id, name: pName });
        }
      });
    });

    contentEl.querySelectorAll('.pane-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const plan = auditPlans.find(p => p.id === id);
        if (!plan) return;
        if (btn.dataset.action === 'edit-plan') openPlanDialog(plan);
        else if (btn.dataset.action === 'delete-plan') confirmDeletePlan(plan);
      });
    });
  }

  // ── Audit Plan Dialog (Add / Edit) ────────────────────────
  function openPlanDialog(plan) {
    const isEdit = !!plan;
    document.getElementById('plan-dialog-title').textContent = isEdit ? 'Auditplan bearbeiten' : 'Auditplan hinzuf\u00fcgen';
    document.getElementById('plan-form-id').value = isEdit ? plan.id : '';
    document.getElementById('plan-form-year').value = isEdit ? plan.year : new Date().getFullYear();
    planDialog.showModal();
    document.getElementById('plan-form-year').focus();
  }

  document.getElementById('plan-btn-cancel').addEventListener('click', () => planDialog.close());

  document.getElementById('plan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('plan-form-id').value;
    const data = {
      year: parseInt(document.getElementById('plan-form-year').value, 10),
    };

    if (!data.year || isNaN(data.year)) { toast('Jahr ist erforderlich', 'error'); return; }

    const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (id) {
        await fetchJSON(`/api/audit-plans/${id}`, { method: 'PUT', body: data });
        toast('Auditplan aktualisiert');
      } else {
        await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`, { method: 'POST', body: data });
        toast('Auditplan erstellt');
      }
      planDialog.close();
      await loadAuditPlans();
    } catch (err) {
      toast(err?.message || 'Speichern fehlgeschlagen', 'error');
    } finally { if (submitBtn) submitBtn.disabled = false; }
  });

  // ── Audit Plan Delete ─────────────────────────────────────
  let planDeleteTarget = null;

  function confirmDeletePlan(plan) {
    planDeleteTarget = plan;
    // Der Löschen-Knopf sitzt auf derselben Kachel — der Dialog nennt den Plan
    // deshalb genauso wie sie: beim Behördenaudit aus dem Bericht, sonst das Jahr.
    const isAuthority = (plan.plan_type || 'AUDIT') === 'AUTHORITY';
    document.getElementById('plan-delete-name').textContent = isAuthority
      ? authorityName(plan.authority_date, plan.authority_auditor_team)
      : plan.year;
    planDeleteDialog.showModal();
  }

  document.getElementById('plan-delete-cancel').addEventListener('click', () => planDeleteDialog.close());
  document.getElementById('plan-delete-confirm').addEventListener('click', async (e) => {
    if (!planDeleteTarget) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await fetchJSON(`/api/audit-plans/${planDeleteTarget.id}`, { method: 'DELETE' });
      toast('Auditplan gel\u00f6scht');
      planDeleteDialog.close();
      await loadAuditPlans();
    } catch (err) {
      toast(err?.message || 'L\u00f6schen fehlgeschlagen', 'error');
    } finally { btn.disabled = false; }
  });

  // ── Plan Type Dialog ───────────────────────────────────────
  const planTypeDialog = document.getElementById('plan-type-dialog');
  document.getElementById('plan-type-cancel').addEventListener('click', () => planTypeDialog.close());

  document.getElementById('plan-type-audit').addEventListener('click', () => {
    planTypeDialog.close();
    openNewAuditPlanDialog();
  });

  document.getElementById('plan-type-authority').addEventListener('click', async () => {
    planTypeDialog.close();
    try {
      const plan = await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`, {
        method: 'POST',
        body: { year: new Date().getFullYear(), plan_type: 'AUTHORITY' }
      });
      toast('Behördenaudit erstellt');
      await loadAuditPlans();
      // Der Plan bringt seinen Beanstandungsbericht mit — direkt hinein springen,
      // statt den Anwender auf die Kachel zu schicken, die genau dorthin führt.
      // Der frische Bericht trägt noch kein Datum, das Segment heißt deshalb
      // "ohne Datum" und wird von loadLineData() aus dem geladenen Bericht
      // nachgezogen, sobald dieser einen Betreff hat.
      if (plan && plan.authority_line_id) {
        pushNavSegment({ type: 'audit-plan-line', id: plan.authority_line_id, name: authorityName(plan.authority_date, plan.authority_auditor_team) });
      }
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── New Plan Dialog (3 options) ──────────────────────────────
  async function openNewPlanDialog() {
    planTypeDialog.showModal();
  }

  async function openNewAuditPlanDialog() {
    const regularPlans = auditPlans.filter(p => (p.plan_type || 'AUDIT') !== 'AUTHORITY');
    if (regularPlans.length === 0) {
      // No regular audit plans exist — create empty one directly
      try {
        await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`, {
          method: 'POST',
          body: { year: new Date().getFullYear() }
        });
        toast('Auditplan erstellt');
        await loadAuditPlans();
      } catch (err) {
        toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
      }
      return;
    }
    newPlanDialog.showModal();
  }

  document.getElementById('new-plan-cancel').addEventListener('click', () => newPlanDialog.close());

  document.getElementById('new-plan-empty').addEventListener('click', async () => {
    newPlanDialog.close();
    try {
      await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`, {
        method: 'POST',
        body: { year: new Date().getFullYear() }
      });
      toast('Leerer Auditplan erstellt');
      await loadAuditPlans();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  document.getElementById('new-plan-revision').addEventListener('click', async () => {
    newPlanDialog.close();
    // Show revision select dialog with department plans
    try {
      const plans = await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`);
      const listEl = document.getElementById('revision-select-list');
      if (plans.length === 0) {
        listEl.innerHTML = '<div class="empty-state-inline">Keine Pl\u00e4ne vorhanden</div>';
      } else {
        listEl.innerHTML = plans.map(p => `
          <div class="template-list-item" data-id="${p.id}">
            <span class="template-list-name">${p.year} Rev. ${p.revision || 0}</span>
          </div>
        `).join('');
        listEl.querySelectorAll('.template-list-item').forEach(item => {
          item.addEventListener('click', async () => {
            revisionSelectDialog.close();
            try {
              const result = await fetchJSON(`/api/audit-plans/${item.dataset.id}/copy`, {
                method: 'POST',
                body: { mode: 'revision' }
              });
              toast('Neue Revision erstellt');
              await loadAuditPlans();
            } catch (err) {
              toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
            }
          });
        });
      }
      revisionSelectDialog.showModal();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  document.getElementById('revision-select-cancel').addEventListener('click', () => revisionSelectDialog.close());

  document.getElementById('new-plan-template').addEventListener('click', async () => {
    newPlanDialog.close();
    try {
      const plans = await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`);
      const listEl = document.getElementById('template-select-list');
      if (plans.length === 0) {
        listEl.innerHTML = '<div class="empty-state-inline">Keine Auditpläne vorhanden</div>';
      } else {
        listEl.innerHTML = plans.map(p => `
          <div class="template-list-item" data-id="${p.id}">
            <span class="template-list-name">${p.year} Rev. ${p.revision || 0}</span>
          </div>
        `).join('');
        listEl.querySelectorAll('.template-list-item').forEach(item => {
          item.addEventListener('click', async () => {
            templateSelectDialog.close();
            try {
              await fetchJSON(`/api/audit-plans/${item.dataset.id}/copy`, {
                method: 'POST',
                body: { mode: 'template', department_id: currentDeptId }
              });
              toast('Plan von Vorlage erstellt');
              await loadAuditPlans();
            } catch (err) {
              toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
            }
          });
        });
      }
      templateSelectDialog.showModal();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  document.getElementById('template-select-cancel').addEventListener('click', () => templateSelectDialog.close());

  // ── Audit Plan Detail Level ────────────────────────────────
  let currentPlan = null;
  let planLines = [];

  async function renderAuditPlanDetailLevel(planId) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = '<div class="empty-state-inline">Lade...</div>';
    await loadAuditPlanDetail(planId);
  }

  async function loadAuditPlanDetail(planId) {
    try {
      currentPlan = await fetchJSON(`/api/audit-plans/${planId}`);
      planLines = await fetchJSON(`/api/audit-plans/${planId}/lines`);
      // Update navPath name to include full title. Ein Behördenaudit wird dabei aus
      // seinen Berichten beschriftet statt aus dem Jahr: die Plan-Ebene erreicht nur
      // der Altbestand, dessen authority_date die Plan-Liste nicht mitliefert.
      const seg = navPath.find(s => s.type === 'audit-plan' && s.id === planId);
      if (seg) {
        const info = authorityInfoFromLines(planLines);
        seg.name = (currentPlan.plan_type || 'AUDIT') === 'AUTHORITY' ? authorityName(info.date, info.team) : `Auditplan ${currentPlan.year} Rev. ${currentPlan.revision || 0}`;
        saveNav();
      }
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      currentPlan = null;
      planLines = [];
    }
    renderAuditPlanDetail();
  }

  function renderAuditPlanDetail() {
    if (!currentPlan) {
      contentEl.innerHTML = '<div class="empty-state-inline">Auditplan nicht gefunden</div>';
      return;
    }

    const isAuthority = (currentPlan.plan_type || 'AUDIT') === 'AUTHORITY';
    // Überschrift wie das Breadcrumb-Segment: beim Behördenaudit aus dem Bericht,
    // beim internen Auditplan aus Jahr und Revision.
    const authorityInfo = isAuthority ? authorityInfoFromLines(planLines) : null;
    const planTitle = isAuthority ? authorityName(authorityInfo.date, authorityInfo.team) : `Auditplan ${currentPlan.year}`;
    const planSubtitle = isAuthority ? '' : ` <small style="font-weight:400;color:var(--text-muted)">Rev. ${currentPlan.revision ?? 0}</small>`;

    headerEl.innerHTML = `
      <h2>${escapeHtml(planTitle)}${planSubtitle}</h2>
    `;

    let html = `<div class="plan-detail">`;

    if (!isAuthority) {
      const approvedDisplay = formatDateDE(currentPlan.approved_at);
      const submittedPlannedDisplay = formatDateDE(currentPlan.submitted_planned_at);
      const submittedDisplay = formatDateDE(currentPlan.submitted_at);

      // Meta info as inline editable row
      html += `<div class="plan-meta">`;
      html += `<div class="plan-meta-item"><span class="plan-meta-label">Datum Freigabe</span> <input type="text" class="plan-date-input" id="plan-approved-at" value="${escapeHtml(approvedDisplay)}" placeholder="TT.MM.JJJJ"></div>`;
      html += `<div class="plan-meta-item"><span class="plan-meta-label">Weitergabe LBA (geplant)</span> <input type="text" class="plan-date-input" id="plan-submitted-planned-at" value="${escapeHtml(submittedPlannedDisplay)}" placeholder="TT.MM.JJJJ"></div>`;
      html += `<div class="plan-meta-item"><span class="plan-meta-label">Weitergabe LBA (durchgef\u00fchrt)</span> <input type="text" class="plan-date-input" id="plan-submitted-at" value="${escapeHtml(submittedDisplay)}" placeholder="TT.MM.JJJJ"></div>`;
      html += `</div>`;
    }

    // Lines are already sorted by audit_no from the server
    const sortedLines = planLines;

    // Compute tags per line
    const tagDefs = [
      { key: 'open',           label: 'OFFEN',       css: 'tag-open',           test: l => !l.audit_end_date && !l.audit_start_date && !l.planned_window },
      { key: 'planned',        label: 'GEPLANT',     css: 'tag-planned',        test: l => !l.audit_end_date && !l.audit_start_date && !!l.planned_window },
      { key: 'progress',       label: 'IN ARBEIT',   css: 'tag-progress',       test: l => !!l.audit_start_date && !l.audit_end_date },
      { key: 'done',           label: 'DURCHGEFÜHRT', css: 'tag-done',          test: l => !!l.audit_end_date },
      { key: 'finding',        label: 'FINDINGS',      css: 'tag-finding',        test: l => l.finding_count > 0 },
      { key: 'observation',    label: 'OBSERVATIONS', css: 'tag-observation',    test: l => l.observation_count > 0 },
      { key: 'recommendation', label: 'EMPFEHLUNG',   css: 'tag-recommendation', test: l => !!l.recommendation },
      { key: 'checklist',      label: 'CHECKLISTE',  css: 'tag-checklist',      test: l => l.checklist_count > 0 },
      { key: 'evidence',       label: 'BEWEISE',     css: 'tag-evidence',       test: l => l.evidence_count > 0 },
    ];

    function getLineTags(line) {
      const result = [];
      for (const def of tagDefs) {
        if (def.test(line)) result.push(def);
      }
      return result;
    }

    // Precompute tags for each line
    const lineTagsMap = new Map();
    const presentTagKeys = new Set();
    for (const line of sortedLines) {
      const lt = getLineTags(line);
      lineTagsMap.set(line.id, lt);
      for (const t of lt) presentTagKeys.add(t.key);
    }

    // Lines section
    const linesTitle = isAuthority ? 'Findings' : 'Themenbereiche';
    const addLineTitle = isAuthority ? 'Finding hinzuf\u00fcgen' : 'Themenbereich hinzuf\u00fcgen';
    // Ein Beh\u00f6rdenaudit hat genau EINEN Beanstandungsbericht, und der entsteht
    // seit der Plananlage mit dem Plan zusammen \u2014 der +-Button entf\u00e4llt dort.
    // Er bleibt nur f\u00fcr den Altbestand stehen, der die Plan-Ebene \u00fcberhaupt noch
    // erreicht: ein Beh\u00f6rdenplan ohne Line (authority_line_id = NULL, siehe
    // renderAuditPlans()) h\u00e4tte sonst keinen Weg mehr zu seinem Bericht.
    // Interne Pl\u00e4ne behalten den Button unver\u00e4ndert.
    const showAddLine = !isAuthority || sortedLines.length === 0;
    html += `<div class="plan-lines-header">
      <h3>${linesTitle}</h3>
      <div style="display:flex;gap:0.25rem">
        ${isAuthority ? '' : `<button class="btn-icon" id="btn-pdf-export" title="PDF exportieren">${ICON_SHARE}</button>`}
        <button class="btn-icon" id="btn-import-audits" title="Audit-Checklisten importieren (.xlsx)">${ICON_IMPORT}</button>
        ${showAddLine ? `<button class="btn-icon" id="btn-add-line" title="${addLineTitle}">+</button>` : ''}
      </div>
    </div>`;

    // Filter bar (only tags that exist)
    if (sortedLines.length > 0 && presentTagKeys.size > 0) {
      html += '<div class="audit-filter-bar" id="audit-filter-bar">';
      for (const def of tagDefs) {
        if (presentTagKeys.has(def.key)) {
          html += `<button class="audit-filter-btn audit-tag ${def.css}" data-filter="${def.key}">${def.label}</button>`;
        }
      }
      html += '</div>';
    }

    if (sortedLines.length === 0) {
      html += `<div class="empty-state-inline">Keine ${isAuthority ? 'Findings' : 'Themenbereiche'} vorhanden</div>`;
    } else if (isAuthority) {
      html += `<div class="lines-table-wrap"><table class="lines-table">
        <thead>
          <tr>
            <th>Nr.</th>
            <th>Finding</th>
            <th>Vorschriften</th>
            <th>Ort</th>
            <th></th>
          </tr>
        </thead>
        <tbody>`;
      sortedLines.forEach(line => {
        const lt = lineTagsMap.get(line.id);
        const tagKeys = lt.map(t => t.key).join(' ');
        let tagsHtml = '';
        for (const t of lt) {
          let label = t.label;
          if (t.key === 'finding') label += ` (${line.finding_count})`;
          if (t.key === 'observation') label += ` (${line.observation_count})`;
          if (t.key === 'checklist') label += ` (${line.checklist_count})`;
          if (t.key === 'evidence') label += ` (${line.evidence_count})`;
          tagsHtml += `<span class="audit-tag ${t.css}">${label}</span>`;
        }
        html += `<tr data-id="${line.id}" data-tags="${tagKeys}" class="line-row-clickable${line.audit_end_date ? ' task-done' : ''}">
          <td>${escapeHtml(line.audit_no || '')}</td>
          <td>${escapeHtml(line.subject)}<div class="audit-tags">${tagsHtml}</div></td>
          <td class="regulations-cell">${escapeHtml(line.regulations || '').replace(/\n/g, '<br>')}</td>
          <td>${escapeHtml(line.location || '')}</td>
          <td class="line-actions">
            <button class="pane-action-btn danger" data-action="delete-line" data-id="${line.id}" title="L\u00f6schen">&#128465;</button>
          </td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    } else {
      html += `<div class="lines-table-wrap"><table class="lines-table">
        <thead>
          <tr>
            <th>Nr.</th>
            <th>Themenbereich</th>
            <th>Vorschriften</th>
            <th>Ort</th>
            <th>Geplant</th>
            <th>Durchgef\u00fchrt</th>
            <th class="col-select"><span class="select-header"><label><input type="checkbox" class="select-all-lines" title="Alle ausw\u00e4hlen"><span class="sr-only">Alle ausw\u00e4hlen</span></label><button type="button" class="icon-btn select-share-btn" aria-label="Ausgew\u00e4hlte Themenbereiche als PDF exportieren">${ICON_SHARE}</button></span></th>
            <th></th>
          </tr>
        </thead>
        <tbody>`;
      sortedLines.forEach(line => {
        const endDateDisplay = formatDateDE(line.audit_end_date || '');
        const lt = lineTagsMap.get(line.id);
        const tagKeys = lt.map(t => t.key).join(' ');
        let tagsHtml = '';
        for (const t of lt) {
          let label = t.label;
          if (t.key === 'finding') label += ` (${line.finding_count})`;
          if (t.key === 'observation') label += ` (${line.observation_count})`;
          if (t.key === 'checklist') label += ` (${line.checklist_count})`;
          if (t.key === 'evidence') label += ` (${line.evidence_count})`;
          tagsHtml += `<span class="audit-tag ${t.css}">${label}</span>`;
        }

        html += `<tr data-id="${line.id}" data-tags="${tagKeys}" class="line-row-clickable${line.audit_end_date ? ' task-done' : ''}">
          <td>${escapeHtml(line.audit_no || '')}</td>
          <td>${escapeHtml(line.subject)}<div class="audit-tags">${tagsHtml}</div></td>
          <td class="regulations-cell">${escapeHtml(line.regulations || '').replace(/\n/g, '<br>')}</td>
          <td>${escapeHtml(line.location || '')}</td>
          <td>${escapeHtml(line.planned_window)}</td>
          <td>${escapeHtml(endDateDisplay)}</td>
          <td class="col-select"><input type="checkbox" class="line-select-cb" data-line-id="${line.id}"></td>
          <td class="line-actions">
            <button class="pane-action-btn danger" data-action="delete-line" data-id="${line.id}" title="L\u00f6schen">&#128465;</button>
          </td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    // CAP section placeholder
    html += `<div class="cap-section" id="cap-section"></div>`;

    html += `</div>`;
    contentEl.innerHTML = html;

    // Load and render CAP section
    loadCapSection(currentPlan.id);

    // Remove stale filters that no longer match any line
    for (const f of [...auditLineFilters]) {
      if (!presentTagKeys.has(f)) auditLineFilters.delete(f);
    }

    // Filter bar handlers
    const filterBar = document.getElementById('audit-filter-bar');
    if (filterBar) {
      // Restore saved filter state
      filterBar.querySelectorAll('[data-filter]').forEach(btn => {
        if (auditLineFilters.has(btn.dataset.filter)) btn.classList.add('active');
      });
      // Apply restored filters to table rows
      if (auditLineFilters.size > 0) {
        document.querySelectorAll('.lines-table tr[data-tags]').forEach(row => {
          const rowTags = row.dataset.tags.split(' ');
          const visible = [...auditLineFilters].every(f => rowTags.includes(f));
          row.style.display = visible ? '' : 'none';
        });
      }
      filterBar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        const key = btn.dataset.filter;
        if (auditLineFilters.has(key)) {
          auditLineFilters.delete(key);
          btn.classList.remove('active');
        } else {
          auditLineFilters.add(key);
          btn.classList.add('active');
        }
        saveNav();
        // Apply AND filter to table rows
        document.querySelectorAll('.lines-table tr[data-tags]').forEach(row => {
          const rowTags = row.dataset.tags.split(' ');
          const visible = auditLineFilters.size === 0 || [...auditLineFilters].every(f => rowTags.includes(f));
          row.style.display = visible ? '' : 'none';
        });
      });
    }

    // Helper: parse dd.mm.yyyy → yyyy-mm-dd
    function parseDateInput(val) {
      if (!val.trim()) return null;
      const m = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (!m) { toast('Format: TT.MM.JJJJ', 'error'); return undefined; }
      return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }

    // Save all dates (no auto-status)
    async function savePlanDates() {
      const approvedRaw = document.getElementById('plan-approved-at').value;
      const submittedPlannedRaw = document.getElementById('plan-submitted-planned-at').value;
      const submittedRaw = document.getElementById('plan-submitted-at').value;
      const approvedIso = parseDateInput(approvedRaw);
      const submittedPlannedIso = parseDateInput(submittedPlannedRaw);
      const submittedIso = parseDateInput(submittedRaw);
      if (approvedIso === undefined || submittedPlannedIso === undefined || submittedIso === undefined) return;

      try {
        currentPlan = await fetchJSON(`/api/audit-plans/${currentPlan.id}/dates`, {
          method: 'PATCH',
          body: { approved_at: approvedIso, submitted_planned_at: submittedPlannedIso, submitted_at: submittedIso }
        });
      } catch (err) {
        toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
      }
    }

    const planApprovedInput = document.getElementById('plan-approved-at');
    const planSubmittedPlannedInput = document.getElementById('plan-submitted-planned-at');
    const planSubmittedInput = document.getElementById('plan-submitted-at');
    if (planApprovedInput) {
      initDateAutoFormat(planApprovedInput);
      initDateAutoFormat(planSubmittedPlannedInput);
      initDateAutoFormat(planSubmittedInput);
      planApprovedInput.addEventListener('blur', savePlanDates);
      planSubmittedPlannedInput.addEventListener('blur', savePlanDates);
      planSubmittedInput.addEventListener('blur', savePlanDates);
    }

    // Bind add line: create empty line, then navigate to detail
    // (bei einem Behördenplan mit vorhandenem Bericht gibt es den Button nicht)
    const addLineBtn = document.getElementById('btn-add-line');
    if (addLineBtn) {
      addLineBtn.addEventListener('click', async () => {
        try {
          const defaultCity = getSelectedCompany()?.city || '';
          const isAuth = (currentPlan.plan_type || 'AUDIT') === 'AUTHORITY';
          const defaultSubject = isAuth ? 'Neues Finding' : 'Neuer Themenbereich';
          const created = await fetchJSON(`/api/audit-plans/${currentPlan.id}/lines`, {
            method: 'POST',
            body: { subject: defaultSubject, location: defaultCity, sort_order: planLines.length + 1 }
          });
          pushNavSegment({ type: 'audit-plan-line', id: created.id, name: created.subject || (isAuth ? 'Finding' : 'Themenbereich') });
        } catch (err) {
          toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
        }
      });
    }

    // Bind row click → drill-down to line detail
    contentEl.querySelectorAll('.line-row-clickable').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('.pane-action-btn') || e.target.closest('.col-select')) return;
        const lineId = row.dataset.id;
        const line = planLines.find(l => l.id === lineId);
        if (!line) return;
        pushNavSegment({ type: 'audit-plan-line', id: line.id, name: line.subject || 'Themenbereich' });
      });
    });

    // ── Line multi-select + export ──
    const selectAllLines = contentEl.querySelector('.select-all-lines');
    const lineCbs = contentEl.querySelectorAll('.line-select-cb');
    if (selectAllLines) {
      const lineHeader = selectAllLines.closest('.select-header');
      const updateLineSelection = () => {
        const anyChecked = [...lineCbs].some(cb => cb.checked);
        lineHeader.classList.toggle('has-selection', anyChecked);
      };
      selectAllLines.addEventListener('change', () => {
        const checked = selectAllLines.checked;
        lineCbs.forEach(cb => {
          if (cb.closest('tr').style.display !== 'none') cb.checked = checked;
        });
        updateLineSelection();
      });
      lineCbs.forEach(cb => cb.addEventListener('change', updateLineSelection));
      lineHeader.querySelector('.select-share-btn').addEventListener('click', () => {
        const ids = [...lineCbs].filter(cb => cb.checked).map(cb => cb.dataset.lineId);
        if (ids.length === 0) { toast('Keine Themenbereiche ausgew\u00e4hlt', 'error'); return; }
        window.open(`/api/audit-plan-lines/pdf?ids=${ids.join(',')}`);
      });
    }

    // Bind PDF export button (not present for authority plans)
    const pdfExportBtn = document.getElementById('btn-pdf-export');
    if (pdfExportBtn) {
      pdfExportBtn.addEventListener('click', () => {
        document.getElementById('pdf-export-all-audits').checked = false;
        document.getElementById('pdf-export-dialog').showModal();
      });
    }

    // Bind import audits button
    document.getElementById('btn-import-audits').addEventListener('click', () => {
      document.getElementById('import-audits-input').click();
    });

    // Bind line delete actions
    contentEl.querySelectorAll('.pane-action-btn[data-action="delete-line"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const line = planLines.find(l => l.id === id);
        if (line) confirmDeleteLine(line);
      });
    });
  }

  // ── Audit Plan Line Delete ─────────────────────────────────
  let lineDeleteTarget = null;

  function confirmDeleteLine(line) {
    lineDeleteTarget = line;
    lineDeleteDialog.showModal();
  }

  document.getElementById('line-delete-cancel').addEventListener('click', () => lineDeleteDialog.close());
  document.getElementById('line-delete-confirm').addEventListener('click', async (e) => {
    if (!lineDeleteTarget) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await fetchJSON(`/api/audit-plan-lines/${lineDeleteTarget.id}`, { method: 'DELETE' });
      toast('Themenbereich gel\u00f6scht');
      lineDeleteDialog.close();
      await loadAuditPlanDetail(currentPlan.id);
    } catch (err) {
      toast(err?.message || 'L\u00f6schen fehlgeschlagen', 'error');
    } finally { btn.disabled = false; }
  });

  // ── Line Detail Level (Checklist + Audit Summary) ──────────
  let currentLine = null;
  let checklistItems = [];

  async function renderLineDetailLevel(lineId) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = '<div class="empty-state-inline">Lade...</div>';
    await loadLineDetail(lineId);
  }

  async function loadLineDetail(lineId) {
    await loadLineData(lineId);
    renderLineDetail();
  }

  // Reines Laden ohne Rendern: die Beanstandungsebene braucht dieselben Daten
  // (Bericht, Plan, Beanstandungsliste), zeichnet daraus aber ihren eigenen Screen.
  async function loadLineData(lineId) {
    try {
      currentLine = await fetchJSON(`/api/audit-plan-lines/${lineId}`);
      // Die Behörden-Kachel springt die Plan-Ebene über, und ein Reload landet über
      // den gespeicherten Nav-Pfad ebenfalls direkt hier. Ohne dieses Nachladen wäre
      // currentPlan null und der Beanstandungsbericht würde stillschweigend als
      // internes Audit mit drei Sektionen rendern.
      if (!currentPlan || currentPlan.id !== currentLine.audit_plan_id) {
        currentPlan = await fetchJSON(`/api/audit-plans/${currentLine.audit_plan_id}`);
      }
      checklistItems = await fetchJSON(`/api/audit-plan-lines/${lineId}/checklist-items`);
      // Breadcrumb-Label aus dem geladenen Bericht nachziehen — der Sprung von der
      // Kachel kennt den Betreff noch nicht.
      const seg = navPath.find(s => s.type === 'audit-plan-line' && s.id === lineId);
      const segName = currentLine.subject || ((currentPlan.plan_type || 'AUDIT') === 'AUTHORITY' ? 'Beanstandungsbericht' : 'Themenbereich');
      if (seg && seg.name !== segName) {
        seg.name = segName;
        saveNav();
        paintBreadcrumb();
      }
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      currentLine = null;
      checklistItems = [];
    }
  }

  function renderLineDetail() {
    if (!currentLine) {
      contentEl.innerHTML = '<div class="empty-state-inline">Themenbereich nicht gefunden</div>';
      return;
    }

    headerEl.innerHTML = `
      <h2>${escapeHtml(currentLine.subject || 'Themenbereich')}</h2>
      <button class="btn-icon" title="Audit Checklist PDF" onclick="window.open('/api/audit-plan-lines/${currentLine.id}/pdf')">${ICON_SHARE}</button>
    `;

    const monthOptions = ['', 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember', 'Nach Bedarf', 'Unangek\u00fcndigt'];
    function monthSelect(id, val) {
      return `<select class="inline-input" id="${id}">${monthOptions.map(m =>
        `<option value="${escapeHtml(m)}" ${m === (val || '') ? 'selected' : ''}>${m || '--'}</option>`
      ).join('')}</select>`;
    }
    let html = '<div class="audit-detail">';

    // ── Themenbereich Meta ──
    const isAuthorityLine = currentPlan && (currentPlan.plan_type || 'AUDIT') === 'AUTHORITY';
    const sectionLabel = isAuthorityLine ? 'Finding' : 'Themenbereich';
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>${sectionLabel}</h3></div>
      <div class="inline-form-grid">
        <label for="ld-subject">${sectionLabel}</label><input class="inline-input" id="ld-subject" value="${escapeHtml(currentLine.subject || '')}">
        <label for="ld-regulations">Vorschriften</label><textarea class="inline-input inline-textarea" id="ld-regulations" rows="2">${escapeHtml(currentLine.regulations || '')}</textarea>
        <label for="ld-location">Ort</label><input class="inline-input" id="ld-location" value="${escapeHtml(currentLine.location || '')}">
        ${isAuthorityLine ? '' : `<label for="ld-planned-window">Monat geplant</label>${monthSelect('ld-planned-window', currentLine.planned_window)}`}
      </div>
    </div>`;

    // ── Audit-Informationen ──
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Audit-Informationen</h3></div>
      <div class="inline-form-grid">
        <label for="ld-auditor-team">Auditor Team</label><input class="inline-input" id="ld-auditor-team" value="${escapeHtml(currentLine.auditor_team || '')}">
        <label for="ld-auditee">Auditee</label><input class="inline-input" id="ld-auditee" value="${escapeHtml(currentLine.auditee || '')}">
        <label for="ld-audit-start-date">Start</label><input class="inline-input" id="ld-audit-start-date" value="${escapeHtml(formatDateDE(currentLine.audit_start_date))}" placeholder="TT.MM.JJJJ">
        <label for="ld-audit-end-date">Ende</label><input class="inline-input" id="ld-audit-end-date" value="${escapeHtml(formatDateDE(currentLine.audit_end_date))}" placeholder="TT.MM.JJJJ">
        <label for="ld-audit-location">Audit Ort</label><input class="inline-input" id="ld-audit-location" value="${escapeHtml(currentLine.audit_location || '')}">
        <label for="ld-doc-ref">Dokument Ref.</label><input class="inline-input" id="ld-doc-ref" value="${escapeHtml(currentLine.document_ref || '')}">
        <label for="ld-doc-iss-rev">Iss/Rev</label><input class="inline-input" id="ld-doc-iss-rev" value="${escapeHtml(currentLine.document_iss_rev || '')}">
        <label for="ld-doc-rev-date">Rev Datum</label><input class="inline-input" id="ld-doc-rev-date" value="${escapeHtml(formatDateDE(currentLine.document_rev_date))}" placeholder="TT.MM.JJJJ">
        <label for="ld-recommendation">Empfehlung</label><textarea class="inline-input inline-textarea" id="ld-recommendation" rows="2">${escapeHtml(currentLine.recommendation || '')}</textarea>
      </div>
    </div>`;

    // ── Eval Summary ──
    html += renderEvalSummary();

    // ── Checkliste ──
    // Ein Behördenaudit kennt keine Sektionen: die Behörde übergibt eine flache
    // Beanstandungsliste in der Spaltenfolge ihres Berichts. Die Beanstandung Nr.
    // ist wie das `Lfd.` der AC-SMS-Tabellen aus dem Zeilenindex abgeleitet und
    // nie gespeichert, damit sie beim Löschen lückenlos 1..n bleibt.
    // Interne Pläne behalten die drei Sektionen unverändert.
    if (isAuthorityLine) {
      html += `<div class="audit-section">
        <div class="audit-section-header">
          <h3>Beanstandungen</h3>
          <button class="btn-icon btn-add-section-ci" data-section="THEORETICAL" title="Beanstandung hinzuf\u00fcgen">+</button>
        </div>`;

      if (checklistItems.length === 0) {
        html += '<div class="empty-state-inline" style="padding:16px 0">Keine Beanstandungen</div>';
      } else {
        html += `<div class="lines-table-wrap"><table class="lines-table checklist-table">
          <colgroup>
            <col style="width:120px"><col style="width:16%"><col style="width:auto"><col style="width:110px"><col style="width:100px"><col style="width:56px">
          </colgroup>
          <thead><tr>
            <th>Beanstandung Nr.</th><th>Referenz Paragraph</th><th>Beanstandung Beschreibung</th><th>Stufe</th><th>Frist</th><th></th>
          </tr></thead><tbody>`;
        checklistItems.forEach((item, idx) => {
          const evalClass = item.evaluation ? `eval-${item.evaluation}` : '';
          // Der Beweis-Clip hängt an der Beschreibung statt in einer eigenen Spalte —
          // die Spaltenfolge der Beanstandungsliste gibt die Behörde vor.
          const clipIcon = item.evidence_count > 0 ? ` <span class="ci-clip" title="${item.evidence_count} Beweise">&#128206;</span>` : '';
          html += `<tr class="ci-row-clickable" data-id="${item.id}">
            <td>${idx + 1}</td>
            <td>${escapeHtml(item.regulation_ref)}</td>
            <td class="wrap-cell">${escapeHtml(item.compliance_check)}${clipIcon}</td>
            <td>${item.evaluation ? `<span class="eval-badge ${evalClass}">${escapeHtml(evalLabel(item.evaluation, true))}</span>` : ''}</td>
            <td>${escapeHtml(formatDateDE(item.cap_deadline))}</td>
            <td class="line-actions">
              <button class="pane-action-btn danger" data-action="delete-ci" data-id="${item.id}" title="L\u00f6schen">&#128465;</button>
            </td>
          </tr>`;
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    } else {
      // ── Three Checklist Sections ──
      const sections = [
        { key: 'THEORETICAL', label: 'Theoretical / Documentation Verification' },
        { key: 'PRACTICAL', label: 'Practical Review' },
        { key: 'PROCEDURE', label: 'Procedure' },
      ];

      sections.forEach(sec => {
        const items = checklistItems.filter(ci => ci.section === sec.key);
        html += `<div class="audit-section">
          <div class="audit-section-header">
            <h3>${sec.label}</h3>
            <button class="btn-icon btn-add-section-ci" data-section="${sec.key}" title="Eintrag hinzuf\u00fcgen">+</button>
          </div>`;

        if (items.length === 0) {
          html += '<div class="empty-state-inline" style="padding:16px 0">Keine Eintr\u00e4ge</div>';
        } else {
          html += `<div class="lines-table-wrap"><table class="lines-table checklist-table">
            <colgroup>
              <col style="width:36px"><col style="width:30px"><col style="width:11%"><col style="width:25%"><col style="width:110px"><col style="width:10%"><col style="width:auto"><col style="width:56px">
            </colgroup>
            <thead><tr>
              <th>#</th><th>A</th><th>Regulation</th><th>Compliance Check</th><th>Bewertung</th><th>Dok. Ref.</th><th>Kommentar</th><th></th>
            </tr></thead><tbody>`;
          items.forEach((item, idx) => {
            const evalClass = item.evaluation ? `eval-${item.evaluation}` : '';
            const clipIcon = item.evidence_count > 0 ? `<span class="ci-clip" title="${item.evidence_count} Beweise">&#128206;</span>` : '';
            html += `<tr class="ci-row-clickable" data-id="${item.id}">
              <td>${idx + 1}</td>
              <td class="ci-clip-cell">${clipIcon}</td>
              <td>${escapeHtml(item.regulation_ref)}</td>
              <td class="wrap-cell">${escapeHtml(item.compliance_check)}</td>
              <td>${item.evaluation ? `<span class="eval-badge ${evalClass}">${escapeHtml(item.evaluation)}</span>` : ''}</td>
              <td class="wrap-cell">${escapeHtml(item.document_ref)}</td>
              <td class="wrap-cell">${escapeHtml(item.auditor_comment)}</td>
              <td class="line-actions">
                <button class="pane-action-btn danger" data-action="delete-ci" data-id="${item.id}" title="L\u00f6schen">&#128465;</button>
              </td>
            </tr>`;
          });
          html += '</tbody></table></div>';
        }
        html += '</div>';
      });
    }

    // ── Offene Beanstandungen ──
    // Die CAP-Sektion der Plan-Ebene, die beim Behördenaudit niemand mehr erreicht,
    // seit die Kachel direkt in den Bericht springt. Sie trägt hier Status, Filter
    // und den Sammel-Export, die die Beanstandungstabelle darüber nicht kennt.
    // `audit-section` nur hier: auf der Berichtsebene stehen alle Blöcke in Karten,
    // auf der Plan-Ebene steht die Sektion frei unter der Zeilenliste.
    if (isAuthorityLine) html += `<div class="audit-section cap-section" id="cap-section"></div>`;

    html += '</div>';
    contentEl.innerHTML = html;

    if (isAuthorityLine) loadCapSection(currentLine.audit_plan_id, currentLine);

    // ── Auto-save on blur for all inline fields ──
    // Init date auto-format for all date text inputs
    ['ld-audit-start-date', 'ld-audit-end-date', 'ld-doc-rev-date'].forEach(id => {
      initDateAutoFormat(document.getElementById(id));
    });

    async function saveLineFields() {
      const startIso = parseDateDE(document.getElementById('ld-audit-start-date').value);
      const endIso = parseDateDE(document.getElementById('ld-audit-end-date').value);
      const revDateIso = parseDateDE(document.getElementById('ld-doc-rev-date').value);
      // Skip save if any date is invalid format
      if (startIso === undefined || endIso === undefined || revDateIso === undefined) return;

      const data = {
        subject: document.getElementById('ld-subject').value.trim(),
        regulations: document.getElementById('ld-regulations').value.trim(),
        location: document.getElementById('ld-location').value.trim(),
        planned_window: (document.getElementById('ld-planned-window') || {}).value || '',
        auditor_team: document.getElementById('ld-auditor-team').value.trim(),
        auditee: document.getElementById('ld-auditee').value.trim(),
        audit_start_date: startIso,
        audit_end_date: endIso,
        audit_location: document.getElementById('ld-audit-location').value.trim(),
        document_ref: document.getElementById('ld-doc-ref').value.trim(),
        document_iss_rev: document.getElementById('ld-doc-iss-rev').value.trim(),
        document_rev_date: revDateIso,
        recommendation: document.getElementById('ld-recommendation').value.trim(),
      };

      try {
        currentLine = await fetchJSON(`/api/audit-plan-lines/${currentLine.id}`, { method: 'PUT', body: data });
        // Update breadcrumb name
        const lastSeg = navPath[navPath.length - 1];
        if (lastSeg && lastSeg.type === 'audit-plan-line') {
          lastSeg.name = data.subject || 'Themenbereich';
          saveNav();
          paintBreadcrumb();
        }
        // Update header
        headerEl.querySelector('h2').textContent = data.subject || 'Themenbereich';
      } catch (err) {
        toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
      }
    }

    // Attach blur/change handlers to all inline inputs
    contentEl.querySelectorAll('.inline-input').forEach(el => {
      const event = (el.tagName === 'SELECT') ? 'change' : 'blur';
      el.addEventListener(event, saveLineFields);
    });

    // ── Section "+" buttons → open ciDialog with pre-set section ──
    contentEl.querySelectorAll('.btn-add-section-ci').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        // Die flache Beanstandungsliste zählt über alle Zeilen, die Sektionsansicht
        // nur innerhalb ihrer Sektion — sonst kollidieren die sort_order-Werte.
        const count = isAuthorityLine
          ? checklistItems.length
          : checklistItems.filter(ci => ci.section === section).length;
        openChecklistItemDialog(null, section, count + 1);
      });
    });

    // ── Checklist item row click → edit, delete button → delete ──
    // Eine Beanstandung ist beim Behördenaudit ein eigener Screen (Stammdaten,
    // Maßnahme, Ursachenanalyse, Nachweise) und passt nicht mehr in einen Dialog —
    // der Zeilenklick navigiert deshalb eine Ebene tiefer. Interne Audits behalten
    // den Modal-Dialog.
    contentEl.querySelectorAll('.ci-row-clickable').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const idx = checklistItems.findIndex(ci => ci.id === row.dataset.id);
        if (idx < 0) return;
        if (isAuthorityLine) {
          pushNavSegment({ type: 'finding', id: checklistItems[idx].id, name: findingSegmentName(idx) });
        } else {
          openChecklistItemDialog(checklistItems[idx]);
        }
      });
    });

    contentEl.querySelectorAll('.pane-action-btn[data-action="delete-ci"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = checklistItems.find(ci => ci.id === btn.dataset.id);
        if (item) confirmDeleteChecklistItem(item);
      });
    });
  }

  function renderEvalSummary() {
    const counts = { C: 0, NA: 0, O: 0, L1: 0, L2: 0, L3: 0 };
    checklistItems.forEach(item => {
      if (item.evaluation && counts.hasOwnProperty(item.evaluation)) {
        counts[item.evaluation]++;
      }
    });
    const total = checklistItems.length;
    let html = `<div class="eval-summary">
      <h4>Zusammenfassung</h4>
      <div class="eval-summary-grid">`;
    const labels = { C: 'Compliant', NA: 'Not Applicable', O: 'Observation', L1: 'Level 1', L2: 'Level 2', L3: 'Level 3' };
    for (const [key, label] of Object.entries(labels)) {
      html += `<div class="eval-summary-item">
        <span class="eval-badge eval-${key}">${key}</span>
        <span class="eval-summary-count">${counts[key]}</span>
        <span class="eval-summary-label">${label}</span>
      </div>`;
    }
    html += `</div>`;
    html += `<div class="eval-summary-total">Gesamt: ${total} Eintr\u00e4ge</div>`;
    html += `</div>`;
    return html;
  }

  // ── Checklist Item Dialog (Add / Edit) ─────────────────────
  const allEvalOptions = [
    { value: '', label: '--' },
    { value: 'C', label: 'C (Compliant)' },
    { value: 'NA', label: 'NA (Not Applicable)' },
    { value: 'O', label: 'O (Observation)' },
    { value: 'L1', label: 'L1 (Level 1)' },
    { value: 'L2', label: 'L2 (Level 2)' },
    { value: 'L3', label: 'L3 (Level 3)' },
  ];
  // Authority audits only know Bemerkung/Level 1/Level 2 — C/NA/L3 are no categories there
  const authorityEvalValues = ['', 'O', 'L1', 'L2'];
  const authorityEvalLabels = { O: 'Bemerkung', L1: 'Level 1', L2: 'Level 2' };

  // Labeling only: the stored value stays 'O'/'L1'/'L2', just the wording follows
  // the authority's language. No migration, no effect on badge classes or statistics.
  function evalLabel(value, isAuthority) {
    if (isAuthority && authorityEvalLabels[value]) return authorityEvalLabels[value];
    const opt = allEvalOptions.find(o => o.value === value);
    return opt ? opt.label : value;
  }

  function openChecklistItemDialog(item, defaultSection, defaultSortOrder) {
    const isEdit = !!item;
    const isAuthorityPlan = currentPlan && (currentPlan.plan_type || 'AUDIT') === 'AUTHORITY';

    // Filter evaluation options for authority plans
    const evalSelect = document.getElementById('ci-form-evaluation');
    // An already stored value stays selectable even after it left the menu (legacy 'L3' on an
    // authority plan) — otherwise it would silently collapse to '' on the next save.
    const allowedValues = isAuthorityPlan
      ? (isEdit && item.evaluation && !authorityEvalValues.includes(item.evaluation)
        ? [...authorityEvalValues, item.evaluation]
        : authorityEvalValues)
      : allEvalOptions.map(o => o.value);
    evalSelect.innerHTML = allEvalOptions
      .filter(o => allowedValues.includes(o.value))
      .map(o => `<option value="${o.value}">${evalLabel(o.value, isAuthorityPlan)}</option>`)
      .join('');

    const noun = isAuthorityPlan ? 'Beanstandung' : 'Eintrag';
    document.getElementById('checklist-item-dialog-title').textContent = isEdit ? `${noun} bearbeiten` : `${noun} hinzuf\u00fcgen`;
    document.getElementById('ci-form-id').value = isEdit ? item.id : '';
    // Die Behörde spricht nicht von Regulation Ref. / Compliance Check, sondern von
    // Referenz Paragraph und Beanstandung Beschreibung — wie in der Beanstandungstabelle.
    document.querySelector('label[for="ci-form-regulation-ref"]').textContent =
      isAuthorityPlan ? 'Referenz Paragraph' : 'Regulation Ref.';
    document.querySelector('label[for="ci-form-compliance-check"]').textContent =
      isAuthorityPlan ? 'Beanstandung Beschreibung' : 'Compliance Check';
    // Ein Behördenaudit hat keine Sektionen: jede Beanstandung wird als 'THEORETICAL'
    // gespeichert, damit Sortier- und Speicherlogik unverändert bleiben. Sektion und
    // Sortierung wären dort ohne Bedeutung, deshalb verschwindet ihre ganze Zeile —
    // die Werte werden weiter gesetzt und unverändert mitgeschickt.
    const sectionSelect = document.getElementById('ci-form-section');
    const metaRow = sectionSelect.closest('.form-row');
    if (metaRow) metaRow.style.display = isAuthorityPlan ? 'none' : '';
    sectionSelect.value = isAuthorityPlan
      ? 'THEORETICAL'
      : (isEdit ? (item.section || 'THEORETICAL') : (defaultSection || 'THEORETICAL'));
    document.getElementById('ci-form-sort-order').value = isEdit ? (item.sort_order || 0) : (defaultSortOrder || checklistItems.length + 1);
    document.getElementById('ci-form-regulation-ref').value = isEdit ? (item.regulation_ref || '') : '';
    document.getElementById('ci-form-compliance-check').value = isEdit ? (item.compliance_check || '') : '';
    document.getElementById('ci-form-evaluation').value = isEdit ? (item.evaluation || '') : '';
    document.getElementById('ci-form-doc-ref').value = isEdit ? (item.document_ref || '') : '';
    document.getElementById('ci-form-comment').value = isEdit ? (item.auditor_comment || '') : '';
    // Frist: nur beim Behördenaudit — die Behörde gibt die Frist der Beanstandung vor,
    // intern rechnet sie die CAP-Regel aus. Der Wert kommt als `cap_deadline` aus der
    // Listen-Route und wird beim Speichern wieder als `cap_deadline` (ISO) geschickt.
    document.getElementById('ci-form-deadline-group').style.display = isAuthorityPlan ? '' : 'none';
    document.getElementById('ci-form-deadline').value = isAuthorityPlan && isEdit ? formatDateDE(item.cap_deadline) : '';
    // Evidence section: show only in edit mode — und beim Behördenaudit gar nicht.
    // Dort werden die Beweismittel auf der Beanstandungs-Ebene am CAP-Item gepflegt
    // (cap_evidence_file); checklist_evidence_file wäre ein zweiter Topf für
    // dieselbe Sache. Interne Audits behalten beide Töpfe unverändert.
    const evSection = document.getElementById('ci-evidence-section');
    const evThumbs = document.getElementById('ci-evidence-thumbs');
    evThumbs.innerHTML = '';
    if (isEdit && !isAuthorityPlan) {
      evSection.style.display = '';
      loadChecklistEvidenceThumbs(item.id);
    } else {
      evSection.style.display = 'none';
    }
    ciDialog.showModal();
    document.getElementById('ci-form-regulation-ref').focus();
  }

  document.getElementById('ci-btn-cancel').addEventListener('click', () => ciDialog.close());
  // Einmalig: das Frist-Feld des Dialogs lebt im EJS, der Listener darf nicht pro Öffnen wachsen.
  initDateAutoFormat(document.getElementById('ci-form-deadline'));

  document.getElementById('checklist-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('ci-form-id').value;
    const data = {
      section: document.getElementById('ci-form-section').value,
      sort_order: parseInt(document.getElementById('ci-form-sort-order').value, 10) || 0,
      regulation_ref: document.getElementById('ci-form-regulation-ref').value.trim(),
      compliance_check: document.getElementById('ci-form-compliance-check').value.trim(),
      evaluation: document.getElementById('ci-form-evaluation').value,
      auditor_comment: document.getElementById('ci-form-comment').value.trim(),
      document_ref: document.getElementById('ci-form-doc-ref').value.trim(),
    };
    // Beim Behördenaudit reicht die Frist als `cap_deadline` (ISO) mit — die Route legt
    // damit das CAP-Item an bzw. überschreibt dessen Frist. Ein leeres Feld schickt nichts:
    // die am CAP-Item gepflegte Frist bleibt dann unangetastet.
    if (currentPlan && (currentPlan.plan_type || 'AUDIT') === 'AUTHORITY') {
      const deadlineIso = parseDateDE(document.getElementById('ci-form-deadline').value);
      if (deadlineIso === undefined) return toast('Frist bitte im Format TT.MM.JJJJ eingeben', 'error');
      if (deadlineIso) data.cap_deadline = deadlineIso;
    }

    const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (id) {
        await fetchJSON(`/api/checklist-items/${id}`, { method: 'PUT', body: data });
        toast('Eintrag aktualisiert');
      } else {
        await fetchJSON(`/api/audit-plan-lines/${currentLine.id}/checklist-items`, { method: 'POST', body: data });
        toast('Eintrag erstellt');
      }
      ciDialog.close();
      await loadLineDetail(currentLine.id);
    } catch (err) {
      toast(err?.message || 'Speichern fehlgeschlagen', 'error');
    } finally { if (submitBtn) submitBtn.disabled = false; }
  });

  // ── Checklist Item Delete ──────────────────────────────────
  let ciDeleteTarget = null;

  function confirmDeleteChecklistItem(item) {
    ciDeleteTarget = item;
    ciDeleteDialog.showModal();
  }

  document.getElementById('ci-delete-cancel').addEventListener('click', () => ciDeleteDialog.close());
  document.getElementById('ci-delete-confirm').addEventListener('click', async (e) => {
    if (!ciDeleteTarget) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await fetchJSON(`/api/checklist-items/${ciDeleteTarget.id}`, { method: 'DELETE' });
      toast('Eintrag gel\u00f6scht');
      ciDeleteDialog.close();
      await loadLineDetail(currentLine.id);
    } catch (err) {
      toast(err?.message || 'L\u00f6schen fehlgeschlagen', 'error');
    } finally { btn.disabled = false; }
  });

  // ── Finding Level (eine Beanstandung eines Behördenaudits) ──
  // Die flache Beanstandungstabelle drillt in einen eigenen Screen statt in einen
  // Dialog: Stammdaten, Maßnahme, Ursachenanalyse und Nachweise einer Beanstandung
  // gehören auf eine Seite. Hier steht das Gerüst — die Sektions-Container füllen
  // die Folge-Tasks.
  let currentFinding = null;      // audit_checklist_item
  let currentFindingIndex = -1;   // Zeilenindex im Bericht → abgeleitete Beanstandung Nr.
  let currentFindingCap = null;   // cap_item der Beanstandung, null solange keine Stufe gesetzt ist
  let currentFindingActions = []; // cap_action-Zeilen des CAP-Items, in Server-Reihenfolge

  // Die Beanstandung Nr. ist wie in renderLineDetail() aus dem Zeilenindex abgeleitet
  // und nie gespeichert — sie bleibt beim Löschen lückenlos 1..n.
  function findingSegmentName(idx) {
    return `Beanstandung ${idx + 1}`;
  }

  // Der Breadcrumb der Ebene ist Abteilung → Bericht → Beanstandung; die Abteilung
  // steht wie auf allen anderen Ebenen als aktiver Tab über dem Breadcrumb
  // (paintBreadcrumb() filtert sie heraus), die beiden übrigen Segmente kommen aus
  // dem Nav-Pfad — renderCurrentLevel() zeichnet ihn vor dem Laden.
  async function renderFindingLevel(findingId) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = '<div class="empty-state-inline">Lade...</div>';
    await loadFinding(findingId);
    renderFindingDetail();
  }

  async function loadFinding(findingId) {
    currentFinding = null;
    currentFindingIndex = -1;
    currentFindingCap = null;
    currentFindingActions = [];

    // Eine Beanstandung hängt immer unter ihrem Bericht, dessen Segment im
    // persistierten Nav-Pfad steht — so findet auch ein Reload direkt auf dieser
    // Ebene die Zeile wieder. Die Liste des Berichts wird ohnehin gebraucht: die
    // Beanstandung Nr. ist aus dem Zeilenindex abgeleitet.
    const lineSeg = [...navPath].reverse().find(s => s.type === 'audit-plan-line');
    if (!lineSeg) return;

    if (!currentLine || currentLine.id !== lineSeg.id) await loadLineData(lineSeg.id);
    if (!currentLine) return;

    const idx = checklistItems.findIndex(ci => ci.id === findingId);
    if (idx < 0) return;
    currentFinding = checklistItems[idx];
    currentFindingIndex = idx;

    // Das CAP-Item hängt am Checklisten-Eintrag. Die Plan-Route liefert alle CAPs
    // des Plans in einem Zug — beim Behördenaudit sind das genau die des Berichts.
    // Ohne Bewertung existiert keines, das ist kein Fehler.
    try {
      const caps = await fetchJSON(`/api/audit-plans/${currentLine.audit_plan_id}/cap-items`);
      currentFindingCap = (caps.items || []).find(c => c.checklist_item_id === findingId) || null;
      if (currentFindingCap) await loadFindingActions(currentFindingCap);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
    }

    // Nummer im Breadcrumb nachziehen: der Sprung aus der Tabelle kennt sie zwar,
    // ein Reload auf dem gespeicherten Pfad aber nicht — und nach dem Löschen einer
    // vorangehenden Beanstandung stimmt sie ohnehin neu.
    const seg = navPath[navPath.length - 1];
    if (seg && seg.type === 'finding' && seg.id === findingId && seg.name !== findingSegmentName(idx)) {
      seg.name = findingSegmentName(idx);
      saveNav();
      paintBreadcrumb();
    }
  }

  function renderFindingDetail() {
    if (!currentFinding) {
      headerEl.innerHTML = '';
      contentEl.innerHTML = '<div class="empty-state-inline">Beanstandung nicht gefunden</div>';
      return;
    }

    const item = currentFinding;
    const cap = currentFindingCap;

    // ── Teilen ── (CM-003-CAP-PDF genau dieser Beanstandung)
    // Das Dokument der Beanstandung ist das CAP-PDF: bei einem Behördenaudit
    // trägt es die 5-Why-Sektion und den Stufen-Klartext bereits (capHasFiveWhy()
    // und capEvalLabel() in pdf/cap.js), an der Erzeugung ist also nichts zu tun.
    // Es hängt aber — wie Maßnahme, Ursachenanalyse und Beweismittel — am
    // CAP-Item, und das entsteht erst mit der Stufe. Statt zu verschwinden bleibt
    // der Button dann sichtbar und deaktiviert, damit der Grund dort steht, wo
    // man ihn sucht, genau wie in den sprechenden Leerzuständen der Sektionen.
    headerEl.innerHTML = `<h2>${escapeHtml(findingSegmentName(currentFindingIndex))}</h2>
      <span id="finding-share"><button class="btn-icon" id="btn-finding-export" title="${cap ? 'Beanstandung als PDF exportieren' : 'Kein PDF — die Beanstandung hat noch keine Stufe'}"${cap ? '' : ' disabled'}>${ICON_SHARE}</button></span>`;
    if (cap) {
      document.getElementById('btn-finding-export').addEventListener('click', () => {
        // Derselbe Dialog und dieselbe Auswahl-Variable wie auf der CAP-Ebene:
        // Download, Behördenversand und freier Empfänger sind für eine einzelne
        // Beanstandung genau das, was sie für ein einzelnes CAP-Item sind. Weil
        // es genau ein Eintrag ist, bietet der Dialog hier zusätzlich die Wahl
        // zwischen CM-003 und dem CM-002-Formular derselben Beanstandung an.
        openCapExportDialog([cap.id]);
      });
    }

    let html = '<div class="audit-detail">';

    // ── Beanstandung ── (Stammdaten)
    // Die Stufe kennt beim Behördenaudit nur '', 'O', 'L1', 'L2' und wird über
    // evalLabel(value, true) beschriftet — gespeichert bleibt der rohe Wert. Ein
    // bereits gespeicherter Wert außerhalb der Liste (Altbestand 'L3') bleibt
    // wählbar, sonst fiele er beim nächsten Speichern still auf '' zurück.
    const evalOptionsHtml = allEvalOptions
      .filter(o => authorityEvalValues.includes(o.value) || o.value === item.evaluation)
      .map(o => `<option value="${escapeAttr(o.value)}"${o.value === (item.evaluation || '') ? ' selected' : ''}>${escapeHtml(evalLabel(o.value, true))}</option>`)
      .join('');

    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Beanstandung</h3></div>
      <div id="finding-basics" class="inline-form-grid">
        <span class="inline-form-label">Beanstandung Nr.</span><span>${currentFindingIndex + 1}</span>
        <label for="fd-regulation-ref">Referenz Paragraph</label><input class="inline-input finding-field" id="fd-regulation-ref" value="${escapeAttr(item.regulation_ref || '')}">
        <label for="fd-compliance-check">Beanstandung Beschreibung</label><textarea class="inline-input inline-textarea finding-field" id="fd-compliance-check" rows="4">${escapeHtml(item.compliance_check || '')}</textarea>
        <label for="fd-evaluation">Stufe</label><select class="inline-input finding-field" id="fd-evaluation">${evalOptionsHtml}</select>
        <label for="fd-deadline">Frist</label><input class="inline-input finding-field" id="fd-deadline" value="${escapeAttr(formatDateDE(item.cap_deadline))}" placeholder="TT.MM.JJJJ" pattern="\\d{2}\\.\\d{2}\\.\\d{4}" inputmode="numeric" title="TT.MM.JJJJ">
      </div>
    </div>`;

    // ── Maßnahmen ── (cap_action-Zeilen + CAP-Item der Beanstandung)
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Maßnahmen</h3></div>
      <div id="finding-actions">${findingActionsHtml(cap)}</div>
    </div>`;

    // ── Ursachenanalyse ── (5-Why, CM-002)
    // Hier gilt keine L1/L2-Grenze: die Behörde verlangt die Ursachenanalyse für
    // jede Beanstandung bis hinunter zur Stufe "Bemerkung" — der Screen existiert
    // ohnehin nur für Behördenaudits. Die L1/L2-Grenze bleibt damit allein Sache
    // der CAP-Ebene (renderCapDetailLevel()) und der internen Audits.
    // Der Datensatz hängt aber am CAP-Item, und das entsteht erst mit der Stufe.
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Ursachenanalyse</h3></div>
      <div id="finding-rootcause">${cap ? fiveWhyHtml() : '<div class="empty-state-inline" style="padding:16px 0">Keine Ursachenanalyse — die Beanstandung hat noch keine Stufe</div>'}</div>
    </div>`;

    // ── Beweismittel ── (cap_evidence_file)
    // Auf diesem Screen gibt es genau EINEN Beweismittel-Topf, den des CAP-Items:
    // der checklist_evidence_file-Bereich des Dialogs ist beim Behördenaudit
    // ausgeblendet, sonst gäbe es zwei Orte für dieselbe Sache. Interne Audits
    // behalten beide Töpfe unverändert.
    // Der Topf hängt damit — wie die Ursachenanalyse — am CAP-Item, und das
    // entsteht erst mit der Stufe.
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Beweismittel</h3></div>
      <div id="finding-evidence">${cap ? capEvidenceHtml() : '<div class="empty-state-inline" style="padding:16px 0">Keine Beweismittel — die Beanstandung hat noch keine Stufe</div>'}</div>
    </div>`;

    html += '</div>';
    contentEl.innerHTML = html;

    initDateAutoFormat(document.getElementById('fd-deadline'));
    contentEl.querySelectorAll('.finding-field').forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'blur', saveFindingFields);
    });
    if (cap) {
      initDateAutoFormat(document.getElementById('fa-completion-date'));
      contentEl.querySelectorAll('.finding-cap-field').forEach(el => {
        el.addEventListener('blur', saveFindingCapFields);
      });
      initFindingActions();
      // Die Route spiegelt den Root Cause nach cap_item.root_cause — der lokale
      // Datensatz wird mitgeführt, damit saveFindingCapFields() ihn unverändert
      // mitschickt statt den Stand vor dem Speichern zurückzuschreiben.
      initFiveWhy(cap.id, rc => { cap.root_cause = rc; });
      initCapEvidence(cap.id);
    }
  }

  // Der Status ist aus completion_date abgeleitet und nirgends gespeichert.
  function capStatus(cap) { return cap.completion_date ? 'CLOSED' : 'OPEN'; }

  // Eine Beanstandung trägt mehrere durchnummerierte Maßnahmen je Art — das ist
  // die Mehrzahl, für die cap_action angelegt wurde. Die zwei Gruppen stehen hier
  // an genau EINER Stelle: Beschriftung, Reihenfolge und die Zuordnung zum
  // gespeicherten `kind` würden sonst zwischen Liste, "+"-Button und Lese-
  // Migration auseinanderlaufen.
  const CAP_ACTION_GROUPS = [
    { kind: 'CORRECTIVE', label: 'Behebungsmaßnahmen', single: 'Behebungsmaßnahme', legacy: 'corrective_action' },
    { kind: 'PREVENTIVE', label: 'Präventivmaßnahmen', single: 'Präventivmaßnahme', legacy: 'preventive_action' },
  ];

  // Lädt die Maßnahmen des CAP-Items und holt dabei den Altbestand einmalig nach:
  // vor cap_action trug das CAP-Item je Art EINEN Maßnahmentext. Steht dort etwas
  // und ist die Liste leer, wird daraus beim ersten Öffnen je eine Maßnahme — ein
  // zweites Mal kann das nicht greifen, weil die Liste danach nicht mehr leer ist.
  // Die beiden Textspalten bleiben stehen: sie sind der CM-003-Fallback für alles,
  // was nie über diesen Screen läuft, und das PDF druckt sie nur, solange es keine
  // cap_action-Zeilen gibt — doppelt gedruckt wird also nichts.
  // Die leere Liste ist deshalb der richtige Auslöser und kein fehlendes Merker-
  // Feld: solange sie leer ist, SIND die beiden Texte die Maßnahmen der
  // Beanstandung, weil genau sie gedruckt werden. Ein Screen, der daneben "keine
  // Maßnahmen" zeigte, widerspräche dem eigenen CM-003.
  async function loadFindingActions(cap) {
    currentFindingActions = await fetchJSON(`/api/cap-items/${cap.id}/actions`);
    if (currentFindingActions.length) return;
    for (const g of CAP_ACTION_GROUPS) {
      const description = (cap[g.legacy] || '').trim();
      if (!description) continue;
      currentFindingActions.push(await fetchJSON(`/api/cap-items/${cap.id}/actions`, {
        method: 'POST', body: { kind: g.kind, description }
      }));
    }
  }

  // Eigene Funktion, weil die Sektion nach einem Stufenwechsel auch für sich allein
  // gezeichnet werden muss: das CAP-Item entsteht und vergeht mit der Stufe.
  // Die Frist steht bewusst nicht hier, sondern als einziges Feld in den Stammdaten
  // (dieselbe Spalte cap_item.deadline) — zweimal sichtbar wäre eine der beiden
  // Anzeigen nach jedem Speichern veraltet. Verantwortlicher, Erledigt am und der
  // daraus abgeleitete Status bleiben am CAP-Item: sie gelten für die Beanstandung
  // als Ganzes, und genau diese Spalten lesen Fristen-Mails und Home-Dashboard.
  function findingActionsHtml(cap) {
    if (!cap) return '<div class="empty-state-inline" style="padding:16px 0">Keine Maßnahmen — die Beanstandung hat noch keine Stufe</div>';
    let html = '';
    for (const g of CAP_ACTION_GROUPS) {
      html += `<div class="cap-action-group">
        <div class="audit-section-header">
          <h4>${g.label}</h4>
          <button type="button" class="btn-icon" id="fa-add-${g.kind}" title="${g.single} hinzufügen">+</button>
        </div>
        <div id="fa-list-${g.kind}">${capActionListHtml(g.kind)}</div>
      </div>`;
    }
    // Eigene Gruppe mit eigener Überschrift, weil die drei Felder am CAP-Item
    // hängen und nicht an einer Maßnahme: Verantwortlicher und Erledigt am gibt es
    // in den Zeilen darüber ein zweites Mal, direkt untergeschoben läsen sie sich
    // als weitere Spalte der Präventivmaßnahmen.
    return html + `<div class="cap-action-group">
      <div class="audit-section-header"><h4>Erledigung der Beanstandung</h4></div>
      <div class="inline-form-grid">
        <label for="fa-responsible">Verantwortlicher</label><input class="inline-input finding-cap-field" id="fa-responsible" value="${escapeAttr(cap.responsible_person || '')}">
        <label for="fa-completion-date">Erledigt am</label><input class="inline-input finding-cap-field" id="fa-completion-date" value="${escapeAttr(formatDateDE(cap.completion_date))}" placeholder="TT.MM.JJJJ" pattern="\\d{2}\\.\\d{2}\\.\\d{4}" inputmode="numeric" title="TT.MM.JJJJ">
        <span class="inline-form-label">Status</span><span><span class="cap-status-${capStatus(cap)}" id="fa-status">${capStatus(cap)}</span></span>
      </div>
    </div>`;
  }

  // Die laufende Nr. ist wie die Beanstandung Nr. und das Nr. des Zielkatalogs aus
  // dem Zeilenindex abgeleitet und nirgends gespeichert — sie zählt innerhalb der
  // eigenen Gruppe und bleibt beim Löschen einer Maßnahme lückenlos 1..n.
  // Die Felder tragen keine IDs, sondern Klassen: es sind n Zeilen, und die Zeile
  // findet ihren Datensatz über data-cap-action.
  function capActionListHtml(kind) {
    const group = CAP_ACTION_GROUPS.find(g => g.kind === kind);
    const actions = currentFindingActions.filter(a => a.kind === kind);
    if (!actions.length) return `<div class="empty-state-inline" style="padding:12px 0">Keine ${group.label} erfasst</div>`;

    let html = `<div class="lines-table-wrap"><table class="lines-table">
      <colgroup>
        <col style="width:48px"><col style="width:auto"><col style="width:16%"><col style="width:120px"><col style="width:120px"><col style="width:48px">
      </colgroup>
      <thead><tr>
        <th>Nr.</th><th>Maßnahme</th><th>Verantwortlicher</th><th>Zieldatum</th><th>Erledigt am</th><th></th>
      </tr></thead><tbody>`;
    actions.forEach((a, idx) => {
      // aria-label statt <label>: die Spaltenüberschrift beschriftet die Spalte,
      // nicht das einzelne Feld, und in n Zeilen wäre jede ID doppelt.
      const who = `${group.single} ${idx + 1}`;
      html += `<tr data-cap-action="${a.id}">
        <td>${idx + 1}</td>
        <td><textarea class="inline-input inline-textarea cap-action-field cap-action-desc" rows="2" aria-label="${who} — Beschreibung">${escapeHtml(a.description || '')}</textarea></td>
        <td><input class="inline-input cap-action-field cap-action-responsible" value="${escapeAttr(a.responsible_person || '')}" aria-label="${who} — Verantwortlicher"></td>
        <td><input class="inline-input cap-action-field cap-action-date cap-action-target" value="${escapeAttr(formatDateDE(a.target_date))}" placeholder="TT.MM.JJJJ" pattern="\\d{2}\\.\\d{2}\\.\\d{4}" inputmode="numeric" title="TT.MM.JJJJ" aria-label="${who} — Zieldatum"></td>
        <td><input class="inline-input cap-action-field cap-action-date cap-action-completion" value="${escapeAttr(formatDateDE(a.completion_date))}" placeholder="TT.MM.JJJJ" pattern="\\d{2}\\.\\d{2}\\.\\d{4}" inputmode="numeric" title="TT.MM.JJJJ" aria-label="${who} — Erledigt am"></td>
        <td class="cap-action-remove"><button type="button" class="pane-action-btn danger" data-cap-action-delete="${a.id}" title="Löschen">&#128465;</button></td>
      </tr>`;
    });
    return html + '</tbody></table></div>';
  }

  // Der "+"-Button steht in der Gruppen-Kopfzeile und überlebt jedes Neuzeichnen
  // der Liste darunter — er wird deshalb einmal je Screen verdrahtet, die Zeilen
  // dagegen nach jedem Neuzeichnen ihrer Liste.
  function initFindingActions() {
    CAP_ACTION_GROUPS.forEach(g => {
      const addBtn = contentEl.querySelector(`#fa-add-${g.kind}`);
      if (addBtn) addBtn.addEventListener('click', () => addCapAction(g.kind));
      wireCapActionRows(g.kind);
    });
  }

  function wireCapActionRows(kind) {
    const list = contentEl.querySelector(`#fa-list-${kind}`);
    if (!list) return;
    list.querySelectorAll('.cap-action-date').forEach(initDateAutoFormat);
    // Auto-Save auf Blur wie überall auf diesem Screen — keine Speichern-Buttons.
    list.querySelectorAll('.cap-action-field').forEach(el => {
      el.addEventListener('blur', () => saveCapAction(el.closest('tr').dataset.capAction));
    });
    list.querySelectorAll('[data-cap-action-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteCapAction(btn.dataset.capActionDelete));
    });
  }

  // Nur die Liste EINER Gruppe wird neu gezeichnet: die andere Gruppe und die
  // CAP-Felder darunter behalten dabei ihren Zustand samt Fokus.
  function renderCapActionList(kind) {
    const list = contentEl.querySelector(`#fa-list-${kind}`);
    if (!list) return;
    list.innerHTML = capActionListHtml(kind);
    wireCapActionRows(kind);
  }

  async function addCapAction(kind) {
    const cap = currentFindingCap;
    if (!cap) return;
    try {
      const created = await fetchJSON(`/api/cap-items/${cap.id}/actions`, { method: 'POST', body: { kind } });
      // Ans Ende der Liste: innerhalb der eigenen Gruppe ist das die neue letzte
      // Nummer, und die Gruppierung entsteht ohnehin erst beim Filtern.
      currentFindingActions.push(created);
      renderCapActionList(kind);
      const desc = contentEl.querySelector(`tr[data-cap-action="${created.id}"] .cap-action-desc`);
      if (desc) desc.focus();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  // PUT /api/cap-actions/:id ist ein partielles Update — die Zeile schickt genau
  // ihre vier Felder, kind und sort_order behalten ihren Wert. Ein geleertes
  // Datumsfeld räumt hier wirklich auf NULL (die Konvention der Route): anders als
  // die Frist der Beanstandung steht das Datum nur auf diesem einen Screen.
  async function saveCapAction(id) {
    const action = currentFindingActions.find(a => a.id === id);
    const row = contentEl.querySelector(`tr[data-cap-action="${id}"]`);
    if (!action || !row) return;

    const targetIso = parseDateDE(row.querySelector('.cap-action-target').value);
    if (targetIso === undefined) return toast('Zieldatum bitte im Format TT.MM.JJJJ eingeben', 'error');
    const completionIso = parseDateDE(row.querySelector('.cap-action-completion').value);
    if (completionIso === undefined) return toast('Erledigt am bitte im Format TT.MM.JJJJ eingeben', 'error');

    const data = {
      description: row.querySelector('.cap-action-desc').value.trim(),
      responsible_person: row.querySelector('.cap-action-responsible').value.trim(),
      target_date: targetIso,
      completion_date: completionIso,
    };

    // Fortschreiben statt neu zeichnen: ein Re-Render auf Blur würde den Fokus des
    // gerade angesprungenen Feldes verlieren. Die laufende Nr. hängt an der
    // Reihenfolge, nicht am Inhalt, und ändert sich beim Speichern nicht.
    // Der lokale Stand wird schon vor der Antwort gesetzt: ein "+"-Klick löst
    // dieses Speichern per Blur aus und zeichnet die Liste neu, noch während die
    // Antwort unterwegs ist — aus dem alten Datensatz gezeichnet stünde dann
    // wieder der Text von vor der Eingabe im Feld.
    Object.assign(action, data);
    try {
      Object.assign(action, await fetchJSON(`/api/cap-actions/${id}`, { method: 'PUT', body: data }));
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  function deleteCapAction(id) {
    const action = currentFindingActions.find(a => a.id === id);
    if (!action) return;
    const desc = (action.description || '').trim();
    confirmDelete({
      title: 'Maßnahme löschen',
      message: `<p>Soll die Maßnahme <strong>${escapeHtml(desc.length > 80 ? desc.slice(0, 80) + '…' : (desc || 'ohne Beschreibung'))}</strong> wirklich gelöscht werden?</p>`,
      onConfirm: async () => {
        await fetchJSON(`/api/cap-actions/${id}`, { method: 'DELETE' });
        currentFindingActions = currentFindingActions.filter(a => a.id !== id);
        // Die Nummern der Gruppe rücken nach — sie sind der Zeilenindex.
        renderCapActionList(action.kind);
        toast('Maßnahme gelöscht');
      },
    });
  }

  // Auto-Save auf Blur wie die Stammdaten darüber. PUT /api/cap-items/:id ersetzt
  // den Datensatz vollständig, deshalb reisen Frist, Ursache, Nachweis-Text und
  // die beiden alten Maßnahmentexte unverändert aus currentFindingCap mit: die
  // Frist wird in den Stammdaten gepflegt, die Ursache vom 5-Why gespiegelt, den
  // Nachweis-Text zeigt dieser Screen gar nicht, und die Maßnahmen stehen seit
  // cap_action in eigenen Zeilen — die zwei Spalten bleiben als CM-003-Fallback
  // des Altbestands stehen und dürfen von hier nicht geleert werden.
  async function saveFindingCapFields() {
    const cap = currentFindingCap;
    if (!cap) return;
    const completionIso = parseDateDE(document.getElementById('fa-completion-date').value);
    if (completionIso === undefined) return toast('Erledigt am bitte im Format TT.MM.JJJJ eingeben', 'error');

    const data = {
      deadline: cap.deadline || null,
      responsible_person: document.getElementById('fa-responsible').value.trim(),
      root_cause: cap.root_cause || '',
      corrective_action: cap.corrective_action || '',
      preventive_action: cap.preventive_action || '',
      completion_date: completionIso,
      evidence: cap.evidence || '',
    };

    try {
      await fetchJSON(`/api/cap-items/${cap.id}`, { method: 'PUT', body: data });
      // Fortschreiben statt neu zeichnen: ein Re-Render auf Blur würde den Fokus
      // des gerade angesprungenen Feldes verlieren. Nur der abgeleitete Status
      // hängt an einem Feld dieser Sektion und wird deshalb nachgezogen.
      Object.assign(cap, data);
      const statusEl = document.getElementById('fa-status');
      if (statusEl) {
        statusEl.textContent = capStatus(cap);
        statusEl.className = `cap-status-${capStatus(cap)}`;
      }
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  // Auto-Save auf Blur bzw. change wie auf der Bericht- und der CAP-Ebene.
  // PUT /api/checklist-items/:id ersetzt die Zeile vollständig, deshalb reisen
  // Sektion, Sortierung, Dokument-Ref. und Kommentar unverändert mit — dieser
  // Screen zeigt sie nicht, darf sie aber auch nicht leeren.
  async function saveFindingFields() {
    const item = currentFinding;
    if (!item) return;
    const deadlineInput = document.getElementById('fd-deadline');
    const deadlineIso = parseDateDE(deadlineInput.value);
    if (deadlineIso === undefined) return toast('Frist bitte im Format TT.MM.JJJJ eingeben', 'error');

    const data = {
      section: item.section || 'THEORETICAL',
      sort_order: item.sort_order || 0,
      regulation_ref: document.getElementById('fd-regulation-ref').value.trim(),
      compliance_check: document.getElementById('fd-compliance-check').value.trim(),
      evaluation: document.getElementById('fd-evaluation').value,
      auditor_comment: item.auditor_comment || '',
      document_ref: item.document_ref || '',
    };
    // Die Behörde gibt ihre Frist vor — sie geht als `cap_deadline` (ISO) mit und
    // legt das CAP-Item damit an bzw. überschreibt dessen Frist. Ein leeres Feld
    // schickt nichts und lässt die am CAP gepflegte Frist stehen (derselbe
    // Vertrag wie im Checklisten-Dialog).
    if (deadlineIso) data.cap_deadline = deadlineIso;

    try {
      const saved = await fetchJSON(`/api/checklist-items/${item.id}`, { method: 'PUT', body: data });
      // Die Stufe entscheidet über die Existenz des CAP-Items: kippt sie über die
      // Grenze, legt die Route eines an oder löscht es — dann stimmen Maßnahme und
      // Frist nur nach einem echten Nachladen. Sonst wird der lokale Datensatz
      // fortgeschrieben, damit der Fokus beim Durchtabben nicht verloren geht.
      const needsCap = ['O', 'L1', 'L2', 'L3'].includes(data.evaluation);
      if (needsCap !== !!currentFindingCap) {
        // loadLineData() vor loadFinding(): die Frist steht am CAP-Item und kommt
        // über die Listen-Route des Berichts: eine frisch angelegte Maßnahme hat
        // sie womöglich selbst gerechnet, eine gelöschte gar keine mehr.
        // loadFinding() allein würde die Liste aus dem Cache nehmen.
        await loadLineData(currentLine.id);
        await loadFinding(item.id);
        renderFindingDetail();
        return;
      }
      // `saved` ist die rohe Zeile; cap_deadline und evidence_count kommen aus der
      // Listen-Route und fehlen dort, werden von Object.assign also nicht überschrieben.
      // currentFinding ist dasselbe Objekt wie in checklistItems — die Beanstandungs-
      // tabelle des Berichts zeigt beim Zurücknavigieren denselben Stand.
      Object.assign(item, saved);
      if (deadlineIso) {
        item.cap_deadline = deadlineIso;
        // Dieselbe Frist steht am CAP-Item, das die Maßnahme-Sektion vollständig
        // zurückschreibt — der lokale Datensatz muss sie also mitbekommen, sonst
        // setzt das nächste Speichern dort die alte Frist wieder ein. Gezeichnet
        // wird sie nur in den Stammdaten, es bleibt beim reinen Nachziehen.
        if (currentFindingCap) currentFindingCap.deadline = deadlineIso;
      // Ein leer gelassenes Feld hat nichts geschickt: die gespeicherte Frist steht
      // weiter am CAP-Item, also darf der Screen sie nicht als gelöscht ausgeben.
      } else if (!deadlineInput.value.trim()) {
        deadlineInput.value = formatDateDE(item.cap_deadline);
      }
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  // ── 5-Why (CM-002) ──────────────────────────────────────────
  // Der Block hängt am CAP-Item und wird von der CAP-Ebene und der Beanstandungs-
  // Ebene gezeichnet. Beide teilen sich Markup und Verdrahtung, damit die zwei
  // Screens nicht auseinanderlaufen — die Feld-IDs dürfen sie teilen, weil immer
  // nur eine der beiden Ebenen in contentEl steht.
  function fiveWhyHtml() {
    return `<div class="inline-form-grid" id="five-why-grid">
      <label for="fw-why1">1. Warum?</label><textarea class="inline-input inline-textarea five-why-field" id="fw-why1" rows="2" placeholder="Warum ist das Problem aufgetreten?"></textarea>
      <label for="fw-why2">2. Warum?</label><textarea class="inline-input inline-textarea five-why-field" id="fw-why2" rows="2" placeholder="Warum war das so?"></textarea>
      <label for="fw-why3">3. Warum?</label><textarea class="inline-input inline-textarea five-why-field" id="fw-why3" rows="2" placeholder="Warum war das so?"></textarea>
      <label for="fw-why4">4. Warum?</label><textarea class="inline-input inline-textarea five-why-field" id="fw-why4" rows="2" placeholder="Warum war das so?"></textarea>
      <label for="fw-why5">5. Warum?</label><textarea class="inline-input inline-textarea five-why-field" id="fw-why5" rows="2" placeholder="Warum war das so?"></textarea>
      <label for="fw-root-cause">Root Cause</label><textarea class="inline-input inline-textarea five-why-field" id="fw-root-cause" rows="3" placeholder="Grundursache (wird als Ursache übernommen)"></textarea>
    </div>`;
  }

  // Lädt den Datensatz nach und hängt den Auto-Save auf Blur an — wie überall auf
  // den Detailebenen gibt es keinen Speichern-Button. PUT …/five-why spiegelt den
  // Root Cause zusätzlich nach cap_item.root_cause; onRootCause() zieht diese
  // zweite Kopie dort nach, wo der aufrufende Screen sie ebenfalls führt.
  function initFiveWhy(capItemId, onRootCause) {
    const grid = contentEl.querySelector('#five-why-grid');
    if (!grid) return;
    const field = id => grid.querySelector(`#${id}`);
    const ids = ['fw-why1', 'fw-why2', 'fw-why3', 'fw-why4', 'fw-why5'];

    (async () => {
      try {
        const fw = await fetchJSON(`/api/cap-items/${capItemId}/five-why`);
        // Der Screen kann während des Ladens schon neu gezeichnet worden sein — auf
        // der Beanstandungs-Ebene tut das jeder Stufenwechsel. Dann gehören die
        // Felder bereits einem anderen CAP-Item und dürfen nicht überschrieben
        // werden. Kein Datensatz ist kein Fehler: die leeren Felder sind der Stand.
        if (!fw || !grid.isConnected) return;
        ids.forEach((id, i) => { field(id).value = fw[`why${i + 1}`] || ''; });
        field('fw-root-cause').value = fw.root_cause || '';
        if (onRootCause) onRootCause(fw.root_cause || '');
      } catch (e) { toast('5-Why konnte nicht geladen werden', 'error'); }
    })();

    async function saveFiveWhy() {
      const data = { root_cause: field('fw-root-cause').value.trim() };
      ids.forEach((id, i) => { data[`why${i + 1}`] = field(id).value.trim(); });
      try {
        await fetchJSON(`/api/cap-items/${capItemId}/five-why`, { method: 'PUT', body: data });
        if (onRootCause) onRootCause(data.root_cause);
      } catch (err) { toast(err?.message || 'Vorgang fehlgeschlagen', 'error'); }
    }

    grid.querySelectorAll('.five-why-field').forEach(el => {
      el.addEventListener('blur', saveFiveWhy);
    });
  }

  // ── Import .docx ────────────────────────────────────────────
  document.getElementById('import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected

    if (!currentDeptId) { toast('Keine Abteilung ausgew\u00e4hlt', 'error'); return; }

    try {
      const buf = await file.arrayBuffer();
      const resp = await fetch(`/api/departments/${currentDeptId}/import-audit-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import fehlgeschlagen');
      toast(`Auditplan importiert (${data.lineCount} Themenbereiche)`);
      await loadAuditPlans();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // ── Import Audit XLSX (bulk per Auditplan) ──────────────────
  const importResultsDialog = document.getElementById('import-results-dialog');

  // Word-matching: compute match score between filename words and a subject string
  function computeWordMatchScore(filename, subject) {
    const name = filename.replace(/\.xlsx$/i, '');
    const fileWords = name.split(/[\s\-_]+/).filter(w => w.length > 0).map(w => w.toLowerCase());
    if (fileWords.length === 0) return 0;
    const subjectLower = subject.toLowerCase();
    let hits = 0;
    for (const word of fileWords) {
      if (subjectLower.includes(word)) hits++;
    }
    return hits;
  }

  let pendingImportFiles = null;

  document.getElementById('import-audits-input').addEventListener('change', async (e) => {
    const fileList = [...e.target.files];
    e.target.value = '';
    if (!fileList || fileList.length === 0) return;

    if (!currentPlan) { toast('Kein Auditplan ausgewählt', 'error'); return; }

    try {
      const files = [];
      for (const file of fileList) {
        const buf = await file.arrayBuffer();
        const base64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
        files.push({ name: file.name, data: base64 });
      }
      pendingImportFiles = files;

      // Build mapping dialog
      let html = '<div class="import-mapping-list">';
      for (const file of files) {
        // Compute best match
        let bestId = '';
        let bestScore = 0;
        for (const line of planLines) {
          if (!line.subject) continue;
          const score = computeWordMatchScore(file.name, line.subject);
          if (score > bestScore) {
            bestScore = score;
            bestId = line.id;
          }
        }

        html += `<div class="import-mapping-row">
          <span class="import-mapping-file">${escapeHtml(file.name)}</span>
          <select class="import-mapping-select" data-filename="${escapeHtml(file.name)}" aria-label="Themenbereich für ${escapeAttr(file.name)} ausw\u00e4hlen">
            <option value="">-- Import überspringen --</option>`;
        for (const line of planLines) {
          const selected = (line.id === bestId) ? ' selected' : '';
          html += `<option value="${line.id}"${selected}>${escapeHtml(line.subject || '(kein Betreff)')}</option>`;
        }
        html += `</select></div>`;
      }
      html += '</div>';

      document.getElementById('import-results-header').textContent = 'Dateien zuordnen';
      document.getElementById('import-results-body').innerHTML = html;
      document.getElementById('import-mapping-footer').style.display = '';
      document.getElementById('import-results-footer').style.display = 'none';
      importResultsDialog.showModal();
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  });

  // Mapping cancel
  document.getElementById('import-mapping-cancel').addEventListener('click', () => {
    pendingImportFiles = null;
    importResultsDialog.close();
  });

  // Mapping confirm → run import
  document.getElementById('import-mapping-confirm').addEventListener('click', async () => {
    if (!pendingImportFiles || !currentPlan) return;

    // Build mappings from selects
    const mappings = {};
    document.querySelectorAll('.import-mapping-select').forEach(sel => {
      const filename = sel.dataset.filename;
      const lineId = sel.value;
      if (lineId) mappings[filename] = lineId;
    });

    const btn = document.getElementById('import-mapping-confirm');
    btn.disabled = true;
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Importiere...';
    try {
      const result = await fetchJSON(`/api/audit-plans/${currentPlan.id}/import-audits`, {
        method: 'POST',
        body: { files: pendingImportFiles, mappings }
      });
      pendingImportFiles = null;

      // Show results
      let html = '';
      if (result.matched.length > 0) {
        html += '<div class="import-result-section"><h4>Erfolgreich importiert</h4>';
        result.matched.forEach(m => {
          html += `<div class="import-result-item import-result-matched">
            <span class="import-result-file">${escapeHtml(m.filename)}</span>
            <span class="import-result-arrow">→</span>
            <span class="import-result-subject">${escapeHtml(m.lineSubject)}</span>
            <span class="import-result-count">${m.itemCount} Einträge</span>
          </div>`;
        });
        html += '</div>';
      }
      if (result.skipped.length > 0) {
        html += '<div class="import-result-section"><h4>Übersprungen</h4>';
        result.skipped.forEach(s => {
          html += `<div class="import-result-item import-result-unmatched">
            <span class="import-result-file">${escapeHtml(s.filename)}</span>
            ${s.error ? `<span class="import-result-subject">→ ${escapeHtml(s.error)}</span>` : ''}
          </div>`;
        });
        html += '</div>';
      }

      document.getElementById('import-results-header').textContent = 'Import-Ergebnis';
      document.getElementById('import-results-body').innerHTML = html;
      document.getElementById('import-mapping-footer').style.display = 'none';
      document.getElementById('import-results-footer').style.display = '';
    } catch (err) {
      toast(err?.message || 'Import fehlgeschlagen', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  document.getElementById('import-results-close').addEventListener('click', () => {
    importResultsDialog.close();
    if (currentPlan) loadAuditPlanDetail(currentPlan.id);
  });

  // ── PDF Export Dialog ──────────────────────────────────────
  const pdfExportDialog = document.getElementById('pdf-export-dialog');
  const pdfEmailSection = document.getElementById('pdf-export-email-section');
  const pdfEmailInput = document.getElementById('pdf-export-email-to');
  const pdfEmailSendBtn = document.getElementById('pdf-export-email-send');
  let pdfEmailType = 'open';
  // 'Alle Audits' checkbox switches the Geplante-Audits actions from type=open to type=all
  const openExportType = () =>
    document.getElementById('pdf-export-all-audits').checked ? 'all' : 'open';

  document.getElementById('pdf-export-cancel').addEventListener('click', () => {
    pdfEmailSection.style.display = 'none';
    pdfExportDialog.close();
  });

  // Download PDF
  document.getElementById('pdf-export-open-download').addEventListener('click', () => {
    if (currentPlan) {
      const type = openExportType();
      const query = type === 'all' ? 'type=all' : 'type=open&filter=planned';
      window.open(`/api/audit-plans/${currentPlan.id}/pdf?${query}`, '_blank');
    }
    pdfExportDialog.close();
  });
  document.getElementById('pdf-export-closed-download').addEventListener('click', () => {
    if (currentPlan) window.open(`/api/audit-plans/${currentPlan.id}/pdf?type=closed`, '_blank');
    pdfExportDialog.close();
  });

  // Send to authority
  async function sendToAuthority(type) {
    if (!currentPlan) return;
    const dept = departments.find(d => d.id === currentDeptId);
    if (!dept || !dept.authority_email) {
      toast('Keine Behörden-E-Mail in der Abteilung hinterlegt', 'error');
      return;
    }
    try {
      await fetchJSON(`/api/audit-plans/${currentPlan.id}/send-email`, {
        method: 'POST', body: { to: dept.authority_email, type, authority: true }
      });
      toast(`Auditplan an ${dept.authority_email} gesendet`);
      pdfExportDialog.close();
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }
  document.getElementById('pdf-export-open-authority').addEventListener('click', () => sendToAuthority(openExportType()));
  document.getElementById('pdf-export-closed-authority').addEventListener('click', () => sendToAuthority('closed'));

  // Send via email
  function showEmailInput(type) {
    pdfEmailType = type;
    pdfEmailSection.style.display = '';
    pdfEmailInput.value = '';
    pdfEmailSendBtn.disabled = true;
    pdfEmailInput.focus();
  }
  document.getElementById('pdf-export-open-email').addEventListener('click', () => showEmailInput(openExportType()));
  document.getElementById('pdf-export-closed-email').addEventListener('click', () => showEmailInput('closed'));

  pdfEmailInput.addEventListener('input', () => {
    pdfEmailSendBtn.disabled = !pdfEmailInput.value.trim() || !pdfEmailInput.validity.valid;
  });

  pdfEmailSendBtn.addEventListener('click', async () => {
    const to = pdfEmailInput.value.trim();
    if (!to || !pdfEmailInput.validity.valid || !currentPlan) return;
    pdfEmailSendBtn.disabled = true;
    const origText = pdfEmailSendBtn.textContent;
    pdfEmailSendBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sende...';
    try {
      await fetchJSON(`/api/audit-plans/${currentPlan.id}/send-email`, {
        method: 'POST', body: { to, type: pdfEmailType }
      });
      toast(`Auditplan an ${to} gesendet`);
      pdfEmailSection.style.display = 'none';
      pdfExportDialog.close();
    } catch (e) {
      toast(e?.message || 'Senden fehlgeschlagen', 'error');
    } finally { pdfEmailSendBtn.disabled = false; pdfEmailSendBtn.textContent = origText; }
  });

  // ── CAP Section ──────────────────────────────────────────
  let capItems = [];
  let capSummary = { total: 0, closed: 0 };
  // Bericht, auf dessen Ebene die Sektion gerade steht — null heißt Plan-Ebene.
  // Beim Behördenaudit ist die Plan-Ebene kein Navigationsziel mehr, die Sektion
  // zieht deshalb auf die Berichtsebene um und wird dort zur Übersicht
  // "Offene Beanstandungen".
  let capSectionLine = null;

  async function loadCapSection(planId, line = null) {
    capSectionLine = line;
    try {
      const data = await fetchJSON(`/api/audit-plans/${planId}/cap-items`);
      capItems = data.items || [];
      capSummary = data.summary || { total: 0, closed: 0 };
    } catch (e) {
      capItems = [];
      capSummary = { total: 0, closed: 0 };
    }
    // capFilter is preserved from saved state (or null by default)
    renderCapSection();
  }

  // Auf der Berichtsebene eines Behördenaudits (capSectionLine gesetzt) ist die
  // Sektion die Übersicht "Offene Beanstandungen": dieselben Zeilen wie die flache
  // Beanstandungstabelle darüber, aber mit Status, Filter und Sammel-Export — und der
  // Zeilenklick führt auf den Beanstandungs-Screen statt auf die CAP-Ebene, die beim
  // Behördenaudit kein Navigationsziel mehr ist. Auf der Plan-Ebene (interne Pläne
  // und der Behörden-Altbestand ohne eindeutigen Bericht) bleibt sie der CAP.
  function renderCapSection() {
    const section = document.getElementById('cap-section');
    if (!section) return;

    const line = capSectionLine;
    // Die Route liefert die CAPs des ganzen Plans; die Übersicht zeigt genau die
    // ihres Berichts — beim Altbestand mit mehreren Berichten fällt das auseinander.
    const scoped = line ? capItems.filter(c => c.audit_plan_line_id === line.id) : capItems;
    const total = line ? scoped.length : (capSummary.total || 0);
    const closed = line ? scoped.filter(c => capStatus(c) === 'CLOSED').length : (capSummary.closed || 0);
    const pct = total > 0 ? Math.round(closed / total * 100) : 0;

    let html = `<div class="cap-section-header">
      <h3>${line ? 'Offene Beanstandungen' : 'Corrective Action Plan (CAP)'}</h3>
      <div class="cap-progress">
        <div class="cap-progress-bar"><div class="cap-progress-fill" style="width:${pct}%"></div></div>
        <span class="cap-progress-label">${closed}/${total}</span>
      </div>
    </div>`;

    // Filter bar
    html += `<div class="cap-filter-bar">
      <button class="cap-filter-btn ${capFilter === null ? 'active' : ''}" data-cap-filter="ALL">ALLE</button>
      <button class="cap-filter-btn ${capFilter === 'OPEN' ? 'active' : ''}" data-cap-filter="OPEN">OPEN</button>
      <button class="cap-filter-btn ${capFilter === 'CLOSED' ? 'active' : ''}" data-cap-filter="CLOSED">CLOSED</button>
    </div>`;

    const filtered = capFilter ? scoped.filter(c => capStatus(c) === capFilter) : scoped;

    // Die Beanstandung Nr. ist wie in renderLineDetail() der Zeilenindex im Bericht —
    // dieselbe Nummer trägt der Breadcrumb und der Beanstandungs-Screen selbst.
    const findingIndex = cap => checklistItems.findIndex(ci => ci.id === cap.checklist_item_id);

    if (filtered.length === 0) {
      html += `<div class="empty-state-inline" style="padding:16px 0">${line ? 'Keine Beanstandungen' : 'Keine Eintr\u00e4ge'}</div>`;
    } else if (line) {
      // Audit-Nr., Thema und Referenz Paragraph stehen auf diesem Screen schon oben
      // bzw. in der Tabelle darüber — die Übersicht trägt nur, was dort fehlt.
      html += `<div class="lines-table-wrap"><table class="lines-table">
        <thead><tr>
          <th>Beanstandung Nr.</th><th>Beanstandung Beschreibung</th><th>Stufe</th><th>Frist</th><th>Status</th>
          <th class="col-select"><span class="select-header"><label><input type="checkbox" class="select-all-cap" title="Alle ausw\u00e4hlen"><span class="sr-only">Alle ausw\u00e4hlen</span></label><button type="button" class="icon-btn select-share-btn" aria-label="Ausgew\u00e4hlte Beanstandungen als PDF exportieren">${ICON_SHARE}</button></span></th>
        </tr></thead><tbody>`;
      filtered.forEach(cap => {
        const evalClass = cap.evaluation ? `eval-${cap.evaluation}` : '';
        const idx = findingIndex(cap);
        html += `<tr class="cap-row-clickable" data-cap-id="${cap.id}">
          <td>${idx >= 0 ? idx + 1 : ''}</td>
          <td class="wrap-cell">${escapeHtml(cap.compliance_check || '')}</td>
          <td>${cap.evaluation ? `<span class="eval-badge ${evalClass}">${escapeHtml(evalLabel(cap.evaluation, true))}</span>` : ''}</td>
          <td>${escapeHtml(formatDateDE(cap.deadline))}</td>
          <td><span class="cap-status-${capStatus(cap)}">${capStatus(cap)}</span></td>
          <td class="col-select"><input type="checkbox" class="cap-select-cb" data-cap-id="${cap.id}"></td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    } else {
      html += `<div class="lines-table-wrap"><table class="lines-table">
        <thead><tr>
          <th>Nr.</th><th>Audit-Nr.</th><th>Thema</th><th>Finding</th><th>Level</th><th>Deadline</th><th>Status</th>
          <th class="col-select"><span class="select-header"><label><input type="checkbox" class="select-all-cap" title="Alle ausw\u00e4hlen"><span class="sr-only">Alle ausw\u00e4hlen</span></label><button type="button" class="icon-btn select-share-btn" aria-label="Ausgew\u00e4hlte CAPs als PDF exportieren">${ICON_SHARE}</button></span></th>
        </tr></thead><tbody>`;
      filtered.forEach((cap, idx) => {
        const evalClass = cap.evaluation ? `eval-${cap.evaluation}` : '';
        const deadlineDisplay = formatDateDE(cap.deadline);
        html += `<tr class="cap-row-clickable" data-cap-id="${cap.id}">
          <td>${idx + 1}</td>
          <td>${escapeHtml(cap.audit_no || '')}</td>
          <td class="wrap-cell">${escapeHtml(cap.subject || '')}</td>
          <td class="wrap-cell">${escapeHtml(cap.compliance_check || '')}</td>
          <td>${cap.evaluation ? `<span class="eval-badge ${evalClass}">${escapeHtml(cap.evaluation)}</span>` : ''}</td>
          <td>${escapeHtml(deadlineDisplay)}</td>
          <td><span class="cap-status-${capStatus(cap)}">${capStatus(cap)}</span></td>
          <td class="col-select"><input type="checkbox" class="cap-select-cb" data-cap-id="${cap.id}"></td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }

    section.innerHTML = html;

    // Filter button handlers
    section.querySelectorAll('[data-cap-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.capFilter;
        capFilter = val === 'ALL' ? null : val;
        saveNav();
        renderCapSection();
      });
    });

    // Row click → navigate to CAP detail
    // Beim Behördenaudit liegen Stammdaten, Maßnahme, Ursachenanalyse und
    // Beweismittel einer Beanstandung auf einem Screen — die CAP-Ebene wird dort nie
    // mehr angesprungen. Interne Pläne behalten sie unverändert.
    section.querySelectorAll('.cap-row-clickable').forEach(row => {
      makeRowClickable(row, (e) => {
        if (e.target.closest('.col-select')) return;
        const cap = capItems.find(c => c.id === row.dataset.capId);
        if (!cap) return;
        if (line) {
          const idx = findingIndex(cap);
          if (idx < 0) return;
          pushNavSegment({ type: 'finding', id: cap.checklist_item_id, name: findingSegmentName(idx) });
        } else {
          pushNavSegment({ type: 'cap-item', id: cap.id, name: 'CAP' });
        }
      });
    });

    // ── CAP multi-select + export ──
    const selectAllCap = section.querySelector('.select-all-cap');
    const capCbs = section.querySelectorAll('.cap-select-cb');
    if (selectAllCap) {
      const capHeader = selectAllCap.closest('.select-header');
      const updateCapSelection = () => {
        const anyChecked = [...capCbs].some(cb => cb.checked);
        capHeader.classList.toggle('has-selection', anyChecked);
      };
      selectAllCap.addEventListener('change', () => {
        capCbs.forEach(cb => { cb.checked = selectAllCap.checked; });
        updateCapSelection();
      });
      capCbs.forEach(cb => cb.addEventListener('change', updateCapSelection));
      capHeader.querySelector('.select-share-btn').addEventListener('click', () => {
        const ids = [...capCbs].filter(cb => cb.checked).map(cb => cb.dataset.capId);
        if (ids.length === 0) { toast(line ? 'Keine Beanstandungen ausgew\u00e4hlt' : 'Keine CAP-Eintr\u00e4ge ausgew\u00e4hlt', 'error'); return; }
        openCapExportDialog(ids);
      });
    }
  }

  // ── CAP Export Dialog ──────────────────────────────────────
  const capExportDialog = document.getElementById('cap-export-dialog');
  const capExportEmailSection = document.getElementById('cap-export-email-section');
  const capExportEmailInput = document.getElementById('cap-export-email-to');
  const capExportEmailSendBtn = document.getElementById('cap-export-email-send');
  const capExportDocGroup = document.getElementById('cap-export-doc-group');
  const capExportDocCap = document.getElementById('cap-export-doc-cap');
  const capExportDocFiveWhy = document.getElementById('cap-export-doc-five-why');
  let selectedCapIds = [];

  // Alle drei Einstiege — Mehrfachauswahl der Übersicht, CAP-Ebene und
  // Beanstandungs-Screen — öffnen den Dialog über diesen einen Weg, damit die
  // Rücksetzer nicht an drei Stellen gepflegt werden müssen: der Dialog startet
  // immer ohne aufgeklappte E-Mail-Sektion und immer beim CM-003.
  function openCapExportDialog(ids) {
    selectedCapIds = ids;
    capExportEmailSection.style.display = 'none';
    // Das CM-002 ist ein Einzelformular ohne Batch-Route: bei einer
    // Mehrfachauswahl gibt es nichts zu wählen, die Gruppe verschwindet und der
    // Download bleibt exakt der bisherige. Die Grenze ist die Anzahl und nicht
    // der Screen — die CAP-Ebene teilt ebenfalls genau einen Eintrag, und die
    // CM-002-Route ist bewusst ungated: ohne five_why-Datensatz liefert sie das
    // leere, von Hand ausfüllbare Formular und keinen Fehler.
    capExportDocGroup.style.display = ids.length === 1 ? '' : 'none';
    capExportDocCap.checked = true;
    capExportDialog.showModal();
  }

  document.getElementById('cap-export-cancel').addEventListener('click', () => {
    capExportEmailSection.style.display = 'none';
    capExportDialog.close();
  });

  document.getElementById('cap-export-download').addEventListener('click', () => {
    // Bei genau einem Eintrag ziehen die Einzelrouten: die Dokumentwahl entscheidet
    // zwischen der CM-003-Korrekturmaßnahme und dem eigenständigen CM-002-Formular
    // derselben Beanstandung. Beide benennen die Datei sprechend nach Audit-Nr. und
    // Stufe (capPdfFilename()) statt generisch "Corrective_Actions.pdf" — was die
    // Beanstandungs- und die CAP-Ebene, die immer genau einen Eintrag teilen, gerade
    // zum Weiterreichen an die Behörde brauchen. Die Wahl wirkt nur hier: einen
    // Versand des CM-002 gibt es nicht, dafür der Hinweis unter der Gruppe.
    if (selectedCapIds.length === 1) {
      const doc = capExportDocFiveWhy.checked ? 'five-why/pdf' : 'pdf';
      window.open(`/api/cap-items/${selectedCapIds[0]}/${doc}`);
    }
    else if (selectedCapIds.length > 0) window.open(`/api/cap-items/pdf?ids=${selectedCapIds.join(',')}`);
    capExportDialog.close();
  });

  document.getElementById('cap-export-authority').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sende...';
    try {
      await fetchJSON('/api/cap-items/send-email', {
        method: 'POST', body: { ids: selectedCapIds, authority: true }
      });
      toast('CAP an Beh\u00f6rde gesendet');
      capExportDialog.close();
    } catch (e) {
      toast(e?.message || 'Senden fehlgeschlagen', 'error');
    } finally { btn.disabled = false; btn.textContent = origText; }
  });

  document.getElementById('cap-export-email').addEventListener('click', () => {
    capExportEmailSection.style.display = '';
    capExportEmailInput.value = '';
    capExportEmailSendBtn.disabled = true;
    capExportEmailInput.focus();
  });

  capExportEmailInput.addEventListener('input', () => {
    capExportEmailSendBtn.disabled = !capExportEmailInput.value.trim() || !capExportEmailInput.validity.valid;
  });

  capExportEmailSendBtn.addEventListener('click', async () => {
    const to = capExportEmailInput.value.trim();
    if (!to || !capExportEmailInput.validity.valid) return;
    capExportEmailSendBtn.disabled = true;
    const origText = capExportEmailSendBtn.textContent;
    capExportEmailSendBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sende...';
    try {
      await fetchJSON('/api/cap-items/send-email', {
        method: 'POST', body: { ids: selectedCapIds, to }
      });
      toast(`CAP an ${to} gesendet`);
      capExportEmailSection.style.display = 'none';
      capExportDialog.close();
    } catch (e) {
      toast(e?.message || 'Senden fehlgeschlagen', 'error');
    } finally { capExportEmailSendBtn.disabled = false; capExportEmailSendBtn.textContent = origText; }
  });

  // ── CAP Detail Level (inline drill-down) ──────────────────
  let currentCapItem = null;

  async function renderCapDetailLevel(capItemId) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = '<div class="empty-state-inline">Lade...</div>';

    try {
      currentCapItem = await fetchJSON(`/api/cap-items/${capItemId}`);
    } catch (e) {
      toast(e?.message || 'Vorgang fehlgeschlagen', 'error');
      currentCapItem = null;
    }

    if (!currentCapItem) {
      contentEl.innerHTML = '<div class="empty-state-inline">CAP-Eintrag nicht gefunden</div>';
      return;
    }

    headerEl.innerHTML = `<h2>Corrective Action</h2>
      <button class="btn-icon" id="btn-cap-detail-export" title="CAP exportieren">${ICON_SHARE}</button>`;
    document.getElementById('btn-cap-detail-export').addEventListener('click', () => {
      openCapExportDialog([capItemId]);
    });

    const cap = currentCapItem;
    // plan_type kommt aus GET /api/cap-items/:id und nicht aus currentPlan: der navPath
    // ist persistiert, ein Reload direkt auf die CAP-Ebene hat keinen Plan geladen.
    // Steuert die Level-Beschriftung unten und die Freigabe der 5-Why-Analyse.
    const isAuthority = (cap.plan_type || 'AUDIT') === 'AUTHORITY';
    let html = '<div class="audit-detail">';

    // Nur beschriftet, nicht umgestellt: gespeichert bleibt der rohe Wert, die
    // Badge-Klasse liest ihn weiter. Interne Pläne behalten die Kurzform — genau
    // wie capEvalLabel() in pdf/cap.js, das für sie ebenfalls den Rohwert druckt.
    const levelLabel = isAuthority ? evalLabel(cap.evaluation, true) : cap.evaluation;

    // Read-only info block
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Finding-Info</h3></div>
      <div class="cap-info-block">
        <div class="cap-info-row"><span class="cap-info-label">Audit-Nr.</span><span>${escapeHtml(cap.audit_no || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Thema</span><span>${escapeHtml(cap.subject || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Finding</span><span>${escapeHtml(cap.compliance_check || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Level</span><span>${cap.evaluation ? `<span class="eval-badge eval-${cap.evaluation}">${escapeHtml(levelLabel)}</span>` : ''}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Regulation Ref.</span><span>${escapeHtml(cap.regulation_ref || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Kommentar</span><span>${escapeHtml(cap.auditor_comment || '')}</span></div>
      </div>
    </div>`;

    // 5W Analysis section — intern nur ab L1/L2, bei Behoerdenaudits fuer jede
    // Beanstandung: die Behoerde verlangt die Ursachenanalyse (CM-002) auch fuer
    // die Stufe "Bemerkung".
    const hasFiveWhy = isAuthority || cap.evaluation === 'L1' || cap.evaluation === 'L2';
    if (hasFiveWhy) {
      html += `<div class="audit-section">
        <div class="audit-section-header"><h3>5-Why Analyse</h3></div>
        ${fiveWhyHtml()}
      </div>`;
    }

    // Editable fields
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Corrective Action</h3></div>
      <div class="inline-form-grid">
        <label for="cap-f-deadline">Deadline</label><input class="inline-input cap-field" id="cap-f-deadline" value="${escapeHtml(formatDateDE(cap.deadline))}" placeholder="TT.MM.JJJJ">
        <label for="cap-f-responsible">Verantwortlich</label><input class="inline-input cap-field" id="cap-f-responsible" value="${escapeHtml(cap.responsible_person || '')}">
        <label for="cap-f-root-cause">Ursache</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-root-cause" rows="3" ${hasFiveWhy ? 'readonly style="background:var(--bg-secondary);opacity:0.7;cursor:not-allowed"' : ''}>${escapeHtml(cap.root_cause || '')}</textarea>
        <label for="cap-f-corrective">Korrekturma\u00dfnahme</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-corrective" rows="3">${escapeHtml(cap.corrective_action || '')}</textarea>
        <label for="cap-f-preventive">Vorbeugema\u00dfnahme</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-preventive" rows="3">${escapeHtml(cap.preventive_action || '')}</textarea>
        <label for="cap-f-completion-date">Erledigt am</label><input class="inline-input cap-field" id="cap-f-completion-date" value="${escapeHtml(formatDateDE(cap.completion_date))}" placeholder="TT.MM.JJJJ">
        <label for="cap-f-evidence">Nachweis</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-evidence" rows="3">${escapeHtml(cap.evidence || '')}</textarea>
      </div>
    </div>`;

    // Evidence images
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Nachweise</h3></div>
      ${capEvidenceHtml()}
    </div>`;

    html += '</div>';
    contentEl.innerHTML = html;

    // Init date auto-format
    initDateAutoFormat(document.getElementById('cap-f-deadline'));
    initDateAutoFormat(document.getElementById('cap-f-completion-date'));

    // Auto-save on blur/change
    contentEl.querySelectorAll('.cap-field').forEach(el => {
      const event = (el.tagName === 'SELECT') ? 'change' : 'blur';
      el.addEventListener(event, () => saveCapFields(cap.id));
    });

    // 5W: load data and setup auto-save — der Root Cause wandert in das
    // schreibgeschützte Ursache-Feld, das die Route ohnehin mitschreibt.
    if (hasFiveWhy) {
      initFiveWhy(cap.id, rc => {
        const el = document.getElementById('cap-f-root-cause');
        if (el) el.value = rc;
      });
    }

    // Load evidence thumbnails + upload handler
    initCapEvidence(cap.id);
  }

  async function saveCapFields(capId) {
    const deadlineIso = parseDateDE(document.getElementById('cap-f-deadline').value);
    const completionIso = parseDateDE(document.getElementById('cap-f-completion-date').value);
    if (deadlineIso === undefined || completionIso === undefined) return;

    const data = {
      deadline: deadlineIso,
      responsible_person: document.getElementById('cap-f-responsible').value.trim(),
      root_cause: document.getElementById('cap-f-root-cause').value.trim(),
      corrective_action: document.getElementById('cap-f-corrective').value.trim(),
      preventive_action: document.getElementById('cap-f-preventive').value.trim(),
      completion_date: completionIso,
      evidence: document.getElementById('cap-f-evidence').value.trim(),
    };

    try {
      await fetchJSON(`/api/cap-items/${capId}`, { method: 'PUT', body: data });
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
    }
  }

  // ── Beweismittel eines CAP-Items (cap_evidence_file) ────────
  // Wie beim 5-Why teilen sich die CAP-Ebene und die Beanstandungs-Ebene Markup
  // und Verdrahtung, damit die zwei Screens nicht auseinanderlaufen — die IDs
  // dürfen sie teilen, weil immer nur eine der beiden Ebenen in contentEl steht.
  function capEvidenceHtml() {
    return `<div class="cap-evidence-thumbs" id="cap-evidence-thumbs"></div>
      <input type="file" id="cap-evidence-upload" accept="image/png,image/jpeg,.pdf" multiple style="margin-top:0.5rem" aria-label="Beweismittel hochladen">`;
  }

  function initCapEvidence(capItemId) {
    const container = contentEl.querySelector('#cap-evidence-thumbs');
    const input = contentEl.querySelector('#cap-evidence-upload');
    if (!container || !input) return;

    (async () => {
      try {
        const files = await fetchJSON(`/api/cap-items/${capItemId}/evidence-files`);
        // Der Screen kann während des Ladens schon neu gezeichnet worden sein — auf
        // der Beanstandungs-Ebene tut das jeder Stufenwechsel. Dann gehört der
        // Container bereits einem anderen CAP-Item, und die geteilten IDs würden
        // dessen Beweismittel mit denen von hier auffüllen.
        if (!container.isConnected) return;
        files.forEach(f => addEvidenceThumb(container, f, '/api/evidence-files'));
      } catch (e) { toast('Laden fehlgeschlagen', 'error'); }
    })();

    input.addEventListener('change', async (e) => {
      for (const file of e.target.files) {
        try {
          const base64 = await fileToBase64(file);
          const created = await fetchJSON(`/api/cap-items/${capItemId}/evidence-files`, {
            method: 'POST',
            body: { filename: file.name, mime_type: file.type || 'image/png', data: base64 }
          });
          addEvidenceThumb(container, created, '/api/evidence-files');
        } catch (err) { toast(err?.message || 'Vorgang fehlgeschlagen', 'error'); }
      }
      e.target.value = '';
    });
  }

  function addEvidenceThumb(container, file, apiPrefix) {
    apiPrefix = apiPrefix || '/api/evidence-files';
    const wrap = document.createElement('div');
    wrap.className = 'cap-evidence-thumb';
    const isPdf = (file.mime_type || '').toLowerCase() === 'application/pdf';
    const fileUrl = `${apiPrefix}/${file.id}`;
    if (isPdf) {
      const link = document.createElement('a');
      link.href = fileUrl;
      link.target = '_blank';
      link.className = 'evidence-pdf-link';
      link.innerHTML = '<span class="evidence-pdf-icon">PDF</span>';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'evidence-pdf-name';
      nameSpan.textContent = file.filename || 'Dokument.pdf';
      link.appendChild(nameSpan);
      wrap.appendChild(link);
    } else {
      const img = document.createElement('img');
      img.src = fileUrl;
      img.alt = file.filename || '';
      img.addEventListener('click', () => window.open(img.src, '_blank'));
      wrap.appendChild(img);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cap-evidence-remove';
    btn.textContent = '\u00D7';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await fetchJSON(`${apiPrefix}/${file.id}`, { method: 'DELETE' });
        wrap.remove();
      } catch (err) { toast(err?.message || 'Vorgang fehlgeschlagen', 'error'); }
    });
    wrap.appendChild(btn);
    container.appendChild(wrap);
  }

  async function loadChecklistEvidenceThumbs(checklistItemId) {
    const container = document.getElementById('ci-evidence-thumbs');
    if (!container) return;
    container.innerHTML = '';
    try {
      const files = await fetchJSON(`/api/checklist-items/${checklistItemId}/evidence-files`);
      files.forEach(f => addEvidenceThumb(container, f, '/api/checklist-evidence-files'));
    } catch (e) { toast('Laden fehlgeschlagen', 'error'); }
  }

  document.getElementById('ci-evidence-upload').addEventListener('change', async (e) => {
    const ciId = document.getElementById('ci-form-id').value;
    if (!ciId) return;
    const container = document.getElementById('ci-evidence-thumbs');
    for (const file of e.target.files) {
      try {
        const base64 = await fileToBase64(file);
        const created = await fetchJSON(`/api/checklist-items/${ciId}/evidence-files`, {
          method: 'POST',
          body: { filename: file.name, mime_type: file.type || 'image/png', data: base64 }
        });
        addEvidenceThumb(container, created, '/api/checklist-evidence-files');
      } catch (err) { toast(err?.message || 'Vorgang fehlgeschlagen', 'error'); }
    }
    e.target.value = '';
  });

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await loadCompanies();

    const saved = loadNav();
    if (saved && saved.selectedId && companies.find(c => c.id === saved.selectedId)) {
      selectedId = saved.selectedId;
      navPath = Array.isArray(saved.navPath) ? saved.navPath : [];
      capFilter = saved.capFilter || null;
      auditLineFilters = new Set(Array.isArray(saved.auditLineFilters) ? saved.auditLineFilters : []);

      renderCompanyTabsLocal();
      emptyEl.style.display = 'none';
      rightPane.style.display = 'block';
      await loadDepartments();
      deptTabBar.style.display = 'flex';
      renderDeptTabsLocal();
      await renderCurrentLevel();
    }
  }

  init();
})();
