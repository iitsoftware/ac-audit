/* ── Companies Page ───────────────────────────────────────── */

(function () {
  let companies = [];
  let selectedId = null;
  let logoBase64 = null;
  let removeLogo = false;

  // Drill-down path: [{type, id, name}, ...]
  // Empty = show departments for selected company
  let navPath = [];
  let capFilter = null; // null = all, 'OPEN', 'CLOSED'
  let auditLineFilters = new Set(); // tag filter keys for audit plan detail

  // ── LocalStorage Persistence ────────────────────────────────
  const NAV_STORAGE_KEY = 'ac-audit-nav-state';

  function saveNavState() {
    try {
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({
        selectedId,
        navPath,
        capFilter,
        auditLineFilters: [...auditLineFilters],
      }));
    } catch { /* quota exceeded or private mode */ }
  }

  function loadNavState() {
    try {
      const raw = localStorage.getItem(NAV_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  const listEl = document.getElementById('company-list');
  const emptyEl = document.getElementById('empty-state');
  const rightPane = document.getElementById('right-pane-content');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const headerEl = document.getElementById('pane-content-header');
  const contentEl = document.getElementById('pane-content-list');
  const dialog = document.getElementById('company-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const deptDialog = document.getElementById('dept-dialog');
  const deptDeleteDialog = document.getElementById('dept-delete-dialog');
  const planDialog = document.getElementById('plan-dialog');
  const planDeleteDialog = document.getElementById('plan-delete-dialog');
  const lineDeleteDialog = document.getElementById('line-delete-dialog');
  const ciDialog = document.getElementById('checklist-item-dialog');
  const ciDeleteDialog = document.getElementById('checklist-item-delete-dialog');
  const newPlanDialog = document.getElementById('new-plan-dialog');
  const revisionSelectDialog = document.getElementById('revision-select-dialog');
  const templateSelectDialog = document.getElementById('template-select-dialog');

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
      toast(e.message, 'error');
      companies = [];
    }
    renderList();
  }

  function renderList() {
    listEl.innerHTML = companies.map(c => {
      const sel = c.id === selectedId;
      const logoHtml = c.has_logo !== false
        ? `<img class="pane-item-logo" src="/api/companies/${c.id}/logo?t=${Date.now()}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          + `<div class="pane-item-logo-placeholder" style="display:none"></div>`
        : `<div class="pane-item-logo-placeholder"></div>`;

      return `
      <div class="pane-item ${sel ? 'selected' : ''}" data-id="${c.id}">
        <div class="pane-item-row">
          ${logoHtml}
          <div class="pane-item-text">
            <span class="item-name">${escapeHtml(c.name)}</span>
            ${c.city ? `<span class="item-sub">${escapeHtml(c.city)}</span>` : ''}
          </div>
          <div class="pane-item-actions">
            <button class="pane-action-btn" data-action="edit" data-id="${c.id}" title="Bearbeiten">&#9998;</button>
            <button class="pane-action-btn danger" data-action="delete" data-id="${c.id}" title="L&ouml;schen">&#128465;</button>
          </div>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.pane-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        selectCompany(el.dataset.id);
      });
    });

    listEl.querySelectorAll('.pane-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const company = companies.find(c => c.id === id);
        if (!company) return;
        if (btn.dataset.action === 'edit') openDialog(company);
        else if (btn.dataset.action === 'delete') confirmDelete(company);
      });
    });
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
    saveNavState();
    renderList();
    emptyEl.style.display = 'none';
    rightPane.style.display = 'block';
    await renderCurrentLevel();
  }

  function showEmpty() {
    selectedId = null;
    navPath = [];
    auditLineFilters = new Set();
    capFilter = null;
    saveNavState();
    emptyEl.style.display = 'flex';
    rightPane.style.display = 'none';
    contentEl.innerHTML = '';
    renderList();
  }

  async function navigateTo(index) {
    if (index < 0) {
      navPath = [];
    } else {
      navPath = navPath.slice(0, index + 1);
    }
    saveNavState();
    await renderCurrentLevel();
  }

  function renderBreadcrumb() {
    const company = getSelectedCompany();
    if (!company) return;

    let html = '';

    if (navPath.length > 0) {
      html += `<button class="breadcrumb-item" data-nav="-1">${escapeHtml(company.name)}</button>`;
    } else {
      html += `<span class="breadcrumb-current">${escapeHtml(company.name)}</span>`;
    }

    navPath.forEach((segment, i) => {
      html += `<span class="breadcrumb-sep">\u203a</span>`;
      if (i < navPath.length - 1) {
        html += `<button class="breadcrumb-item" data-nav="${i}">${escapeHtml(segment.name)}</button>`;
      } else {
        html += `<span class="breadcrumb-current">${escapeHtml(segment.name)}</span>`;
      }
    });

    breadcrumbEl.innerHTML = html;

    breadcrumbEl.querySelectorAll('.breadcrumb-item').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(parseInt(btn.dataset.nav)));
    });
  }

  async function renderCurrentLevel() {
    saveNavState();
    renderBreadcrumb();

    const lastSegment = navPath.length > 0 ? navPath[navPath.length - 1] : null;

    if (!lastSegment) {
      await renderDepartmentLevel();
    } else if (lastSegment.type === 'department') {
      await renderAuditPlanLevel(lastSegment.id);
    } else if (lastSegment.type === 'audit-plan') {
      await renderAuditPlanDetailLevel(lastSegment.id);
    } else if (lastSegment.type === 'audit-plan-line') {
      await renderLineDetailLevel(lastSegment.id);
    } else if (lastSegment.type === 'cap-item') {
      await renderCapDetailLevel(lastSegment.id);
    }
  }

  // ── Department Level ──────────────────────────────────────
  let departments = [];

  async function renderDepartmentLevel() {
    headerEl.innerHTML = `
      <h2>Abteilungen</h2>
      <button class="btn-icon" id="btn-add-dept" title="Abteilung hinzuf&uuml;gen">+</button>
    `;
    document.getElementById('btn-add-dept').addEventListener('click', () => openDeptDialog(null));

    await loadDepartments();
  }

  async function loadDepartments() {
    if (!selectedId) return;
    try {
      departments = await fetchJSON(`/api/companies/${selectedId}/departments`);
    } catch (e) {
      toast(e.message, 'error');
      departments = [];
    }
    renderDepartments();
  }

  async function reorderDepartments(order) {
    try {
      departments = await fetchJSON(`/api/companies/${selectedId}/departments/reorder`, {
        method: 'PATCH',
        body: { order }
      });
      renderDepartments();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderDepartments() {
    if (departments.length === 0) {
      contentEl.innerHTML = '<div class="empty-state-inline">Keine Abteilungen vorhanden</div>';
      return;
    }
    contentEl.innerHTML = departments.map((d, idx) => `
      <div class="dept-card" data-id="${d.id}">
        <div class="dept-card-reorder">
          <button class="reorder-btn" data-action="move-up" data-id="${d.id}" title="Nach oben" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
          <button class="reorder-btn" data-action="move-down" data-id="${d.id}" title="Nach unten" ${idx === departments.length - 1 ? 'disabled' : ''}>&darr;</button>
        </div>
        <div class="dept-card-body">
          <span class="dept-card-name">${escapeHtml(d.name)}</span>
          ${d.easa_permission_number ? `<span class="dept-card-desc">${escapeHtml(d.easa_permission_number)}</span>` : ''}
          ${d.regulation ? `<span class="dept-card-desc">${escapeHtml(d.regulation)}</span>` : ''}
        </div>
        <div class="dept-card-actions">
          <button class="pane-action-btn" data-action="edit-dept" data-id="${d.id}" title="Bearbeiten">&#9998;</button>
          <button class="pane-action-btn danger" data-action="delete-dept" data-id="${d.id}" title="L&ouml;schen">&#128465;</button>
        </div>
      </div>
    `).join('');

    contentEl.querySelectorAll('.dept-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn') || e.target.closest('.reorder-btn')) return;
        const id = card.dataset.id;
        const dept = departments.find(d => d.id === id);
        if (!dept) return;
        navPath.push({ type: 'department', id: dept.id, name: dept.name });
        renderCurrentLevel();
      });
      card.style.cursor = 'pointer';
    });

    // Reorder buttons
    contentEl.querySelectorAll('.reorder-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const idx = departments.findIndex(d => d.id === id);
        if (idx < 0) return;
        const newOrder = departments.map(d => d.id);
        if (btn.dataset.action === 'move-up' && idx > 0) {
          [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
        } else if (btn.dataset.action === 'move-down' && idx < newOrder.length - 1) {
          [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
        } else {
          return;
        }
        reorderDepartments(newOrder);
      });
    });

    contentEl.querySelectorAll('.pane-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const dept = departments.find(d => d.id === id);
        if (!dept) return;
        if (btn.dataset.action === 'edit-dept') openDeptDialog(dept);
        else if (btn.dataset.action === 'delete-dept') confirmDeleteDept(dept);
      });
    });
  }

  // ── Company Dialog (Add / Edit) ───────────────────────────
  function openDialog(company) {
    const isEdit = !!company;
    document.getElementById('dialog-title').textContent = isEdit ? 'Firma bearbeiten' : 'Firma hinzuf\u00fcgen';
    document.getElementById('form-id').value = isEdit ? company.id : '';
    document.getElementById('form-name').value = isEdit ? company.name : '';
    document.getElementById('form-street').value = isEdit ? (company.street || '') : '';
    document.getElementById('form-postal').value = isEdit ? (company.postal_code || '') : '';
    document.getElementById('form-city').value = isEdit ? (company.city || '') : '';
    document.getElementById('form-logo').value = '';
    logoBase64 = null;
    removeLogo = false;

    const previewRow = document.getElementById('logo-preview-row');
    if (isEdit && company.has_logo) {
      document.getElementById('logo-preview').src = `/api/companies/${company.id}/logo?t=${Date.now()}`;
      previewRow.style.display = 'flex';
    } else {
      previewRow.style.display = 'none';
    }

    dialog.showModal();
    document.getElementById('form-name').focus();
  }

  document.getElementById('btn-add').addEventListener('click', () => openDialog(null));
  document.getElementById('btn-cancel').addEventListener('click', () => dialog.close());

  document.getElementById('form-logo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      logoBase64 = reader.result.split(',')[1];
      document.getElementById('logo-preview').src = reader.result;
      document.getElementById('logo-preview-row').style.display = 'flex';
      removeLogo = false;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('remove-logo-btn').addEventListener('click', () => {
    logoBase64 = null;
    removeLogo = true;
    document.getElementById('form-logo').value = '';
    document.getElementById('logo-preview-row').style.display = 'none';
  });

  document.getElementById('company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('form-id').value;
    const data = {
      name: document.getElementById('form-name').value.trim(),
      street: document.getElementById('form-street').value.trim(),
      postal_code: document.getElementById('form-postal').value.trim(),
      city: document.getElementById('form-city').value.trim(),
    };

    if (!data.name) { toast('Name ist erforderlich', 'error'); return; }

    try {
      if (id) {
        await fetchJSON(`/api/companies/${id}`, { method: 'PUT', body: data });
        if (logoBase64) {
          await fetchJSON(`/api/companies/${id}/logo`, { method: 'PUT', body: { logo: logoBase64 } });
        } else if (removeLogo) {
          await fetchJSON(`/api/companies/${id}/logo`, { method: 'PUT', body: { logo: null } });
        }
        toast('Firma aktualisiert');
      } else {
        if (logoBase64) data.logo = logoBase64;
        const created = await fetchJSON('/api/companies', { method: 'POST', body: data });
        selectedId = created.id;
        toast('Firma erstellt');
      }
      dialog.close();
      await loadCompanies();
      if (selectedId) await selectCompany(selectedId);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Company Delete ────────────────────────────────────────
  let deleteTarget = null;

  function confirmDelete(company) {
    deleteTarget = company;
    document.getElementById('delete-name').textContent = company.name;
    deleteDialog.showModal();
  }

  document.getElementById('delete-cancel').addEventListener('click', () => deleteDialog.close());
  document.getElementById('delete-confirm').addEventListener('click', async () => {
    if (!deleteTarget) return;
    try {
      await fetchJSON(`/api/companies/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Firma gel\u00f6scht');
      deleteDialog.close();
      showEmpty();
      await loadCompanies();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Department Dialog (Add / Edit) ────────────────────────
  function openDeptDialog(dept) {
    const isEdit = !!dept;
    document.getElementById('dept-dialog-title').textContent = isEdit ? 'Abteilung bearbeiten' : 'Abteilung hinzuf\u00fcgen';
    document.getElementById('dept-form-id').value = isEdit ? dept.id : '';
    document.getElementById('dept-form-name').value = isEdit ? dept.name : '';
    document.getElementById('dept-form-easa').value = isEdit ? (dept.easa_permission_number || '') : '';
    document.getElementById('dept-form-regulation').value = isEdit ? (dept.regulation || '') : '';
    deptDialog.showModal();
    document.getElementById('dept-form-name').focus();
  }

  document.getElementById('dept-btn-cancel').addEventListener('click', () => deptDialog.close());

  document.getElementById('dept-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dept-form-id').value;
    const data = {
      name: document.getElementById('dept-form-name').value.trim(),
      easa_permission_number: document.getElementById('dept-form-easa').value.trim(),
      regulation: document.getElementById('dept-form-regulation').value.trim(),
    };

    if (!data.name) { toast('Name ist erforderlich', 'error'); return; }

    try {
      if (id) {
        await fetchJSON(`/api/departments/${id}`, { method: 'PUT', body: data });
        toast('Abteilung aktualisiert');
      } else {
        await fetchJSON(`/api/companies/${selectedId}/departments`, { method: 'POST', body: data });
        toast('Abteilung erstellt');
      }
      deptDialog.close();
      await loadDepartments();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Department Delete ─────────────────────────────────────
  let deptDeleteTarget = null;

  function confirmDeleteDept(dept) {
    deptDeleteTarget = dept;
    document.getElementById('dept-delete-name').textContent = dept.name;
    deptDeleteDialog.showModal();
  }

  document.getElementById('dept-delete-cancel').addEventListener('click', () => deptDeleteDialog.close());
  document.getElementById('dept-delete-confirm').addEventListener('click', async () => {
    if (!deptDeleteTarget) return;
    try {
      await fetchJSON(`/api/departments/${deptDeleteTarget.id}`, { method: 'DELETE' });
      toast('Abteilung gel\u00f6scht');
      deptDeleteDialog.close();
      await loadDepartments();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Audit Plan Level ───────────────────────────────────────
  let auditPlans = [];
  let currentDeptId = null;

  async function renderAuditPlanLevel(departmentId) {
    currentDeptId = departmentId;
    headerEl.innerHTML = `
      <h2>Auditpl&auml;ne</h2>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" id="btn-import-plan" title="Auditplan aus .docx importieren">\u{1F4E5}</button>
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
      toast(e.message, 'error');
      auditPlans = [];
    }
    renderAuditPlans();
  }

  function renderAuditPlans() {
    if (auditPlans.length === 0) {
      contentEl.innerHTML = '<div class="empty-state-inline">Keine Auditpl\u00e4ne vorhanden</div>';
      return;
    }
    contentEl.innerHTML = auditPlans.map(p => {
      const total = p.audit_total || 0;
      const done = p.audit_done || 0;
      const pct = total > 0 ? Math.round(done / total * 100) : 0;
      const progressHtml = total > 0
        ? `<div class="plan-progress">
            <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${pct}%"></div></div>
            <span class="plan-progress-label">${done}/${total}</span>
           </div>`
        : '';
      return `
      <div class="dept-card" data-id="${p.id}" style="cursor:pointer">
        <div class="dept-card-body">
          <span class="dept-card-name">${p.year} <small style="font-weight:400;color:var(--text-muted)">Rev. ${p.revision || 0}</small></span>
          ${progressHtml}
        </div>
        <div class="dept-card-actions">
          <button class="pane-action-btn" data-action="edit-plan" data-id="${p.id}" title="Bearbeiten">&#9998;</button>
          <button class="pane-action-btn danger" data-action="delete-plan" data-id="${p.id}" title="L&ouml;schen">&#128465;</button>
        </div>
      </div>`;
    }).join('');

    contentEl.querySelectorAll('.dept-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const id = card.dataset.id;
        const plan = auditPlans.find(p => p.id === id);
        if (!plan) return;
        navPath.push({ type: 'audit-plan', id: plan.id, name: String(plan.year) });
        renderCurrentLevel();
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
      toast(err.message, 'error');
    }
  });

  // ── Audit Plan Delete ─────────────────────────────────────
  let planDeleteTarget = null;

  function confirmDeletePlan(plan) {
    planDeleteTarget = plan;
    document.getElementById('plan-delete-name').textContent = plan.year;
    planDeleteDialog.showModal();
  }

  document.getElementById('plan-delete-cancel').addEventListener('click', () => planDeleteDialog.close());
  document.getElementById('plan-delete-confirm').addEventListener('click', async () => {
    if (!planDeleteTarget) return;
    try {
      await fetchJSON(`/api/audit-plans/${planDeleteTarget.id}`, { method: 'DELETE' });
      toast('Auditplan gel\u00f6scht');
      planDeleteDialog.close();
      await loadAuditPlans();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── New Plan Dialog (3 options) ──────────────────────────────
  async function openNewPlanDialog() {
    if (auditPlans.length === 0) {
      // No plans exist — create empty one directly
      try {
        await fetchJSON(`/api/departments/${currentDeptId}/audit-plans`, {
          method: 'POST',
          body: { year: new Date().getFullYear() }
        });
        toast('Auditplan erstellt');
        await loadAuditPlans();
      } catch (err) {
        toast(err.message, 'error');
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
      toast(err.message, 'error');
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
              toast(err.message, 'error');
            }
          });
        });
      }
      revisionSelectDialog.showModal();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('revision-select-cancel').addEventListener('click', () => revisionSelectDialog.close());

  document.getElementById('new-plan-template').addEventListener('click', async () => {
    newPlanDialog.close();
    // Show template select dialog with all plans
    try {
      const plans = await fetchJSON('/api/audit-plans/all');
      const listEl = document.getElementById('template-select-list');
      if (plans.length === 0) {
        listEl.innerHTML = '<div class="empty-state-inline">Keine Pl\u00e4ne vorhanden</div>';
      } else {
        listEl.innerHTML = plans.map(p => `
          <div class="template-list-item" data-id="${p.id}">
            <span class="template-list-name">${escapeHtml(p.company_name)} \u203a ${escapeHtml(p.department_name)} \u203a ${p.year} Rev. ${p.revision || 0}</span>
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
              toast(err.message, 'error');
            }
          });
        });
      }
      templateSelectDialog.showModal();
    } catch (err) {
      toast(err.message, 'error');
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
    } catch (e) {
      toast(e.message, 'error');
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

    headerEl.innerHTML = `
      <h2>Auditplan ${currentPlan.year} <small style="font-weight:400;color:var(--text-muted)">Rev. ${currentPlan.revision ?? 0}</small></h2>
    `;

    const approvedDisplay = formatDateDE(currentPlan.approved_at);
    const submittedDisplay = formatDateDE(currentPlan.submitted_at);

    let html = `<div class="plan-detail">`;

    // Meta info as inline editable row
    html += `<div class="plan-meta">`;
    html += `<div class="plan-meta-item"><span class="plan-meta-label">Datum Freigabe</span> <input type="text" class="plan-date-input" id="plan-approved-at" value="${escapeHtml(approvedDisplay)}" placeholder="TT.MM.JJJJ"></div>`;
    html += `<div class="plan-meta-item"><span class="plan-meta-label">Datum Weitergabe LBA</span> <input type="text" class="plan-date-input" id="plan-submitted-at" value="${escapeHtml(submittedDisplay)}" placeholder="TT.MM.JJJJ"></div>`;
    html += `</div>`;

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
    html += `<div class="plan-lines-header">
      <h3>Themenbereiche</h3>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" id="btn-import-audits" title="Audit-Checklisten importieren (.xlsx)">\u{1F4E5}</button>
        <button class="btn-icon" id="btn-add-line" title="Themenbereich hinzuf\u00fcgen">+</button>
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
      html += '<div class="empty-state-inline">Keine Themenbereiche vorhanden</div>';
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
          tagsHtml += `<span class="audit-tag ${t.css}">${label}</span>`;
        }

        html += `<tr data-id="${line.id}" data-tags="${tagKeys}" class="line-row-clickable">
          <td>${escapeHtml(line.audit_no || '')}</td>
          <td>${escapeHtml(line.subject)}<div class="audit-tags">${tagsHtml}</div></td>
          <td class="regulations-cell">${escapeHtml(line.regulations || '').replace(/\n/g, '<br>')}</td>
          <td>${escapeHtml(line.location || '')}</td>
          <td>${escapeHtml(line.planned_window)}</td>
          <td>${escapeHtml(endDateDisplay)}</td>
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
        saveNavState();
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

    // Save both dates (no auto-status)
    async function savePlanDates() {
      const approvedRaw = document.getElementById('plan-approved-at').value;
      const submittedRaw = document.getElementById('plan-submitted-at').value;
      const approvedIso = parseDateInput(approvedRaw);
      const submittedIso = parseDateInput(submittedRaw);
      if (approvedIso === undefined || submittedIso === undefined) return;

      try {
        currentPlan = await fetchJSON(`/api/audit-plans/${currentPlan.id}/dates`, {
          method: 'PATCH',
          body: { approved_at: approvedIso, submitted_at: submittedIso }
        });
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const planApprovedInput = document.getElementById('plan-approved-at');
    const planSubmittedInput = document.getElementById('plan-submitted-at');
    initDateAutoFormat(planApprovedInput);
    initDateAutoFormat(planSubmittedInput);
    planApprovedInput.addEventListener('blur', savePlanDates);
    planSubmittedInput.addEventListener('blur', savePlanDates);

    // Bind add line: create empty line, then navigate to detail
    document.getElementById('btn-add-line').addEventListener('click', async () => {
      try {
        const defaultCity = getSelectedCompany()?.city || '';
        const created = await fetchJSON(`/api/audit-plans/${currentPlan.id}/lines`, {
          method: 'POST',
          body: { subject: 'Neuer Themenbereich', location: defaultCity, sort_order: planLines.length + 1 }
        });
        navPath.push({ type: 'audit-plan-line', id: created.id, name: created.subject || 'Themenbereich' });
        renderCurrentLevel();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Bind row click → drill-down to line detail
    contentEl.querySelectorAll('.line-row-clickable').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const lineId = row.dataset.id;
        const line = planLines.find(l => l.id === lineId);
        if (!line) return;
        navPath.push({ type: 'audit-plan-line', id: line.id, name: line.subject || 'Themenbereich' });
        renderCurrentLevel();
      });
    });

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
  document.getElementById('line-delete-confirm').addEventListener('click', async () => {
    if (!lineDeleteTarget) return;
    try {
      await fetchJSON(`/api/audit-plan-lines/${lineDeleteTarget.id}`, { method: 'DELETE' });
      toast('Themenbereich gel\u00f6scht');
      lineDeleteDialog.close();
      await loadAuditPlanDetail(currentPlan.id);
    } catch (err) {
      toast(err.message, 'error');
    }
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
    try {
      currentLine = await fetchJSON(`/api/audit-plan-lines/${lineId}`);
      checklistItems = await fetchJSON(`/api/audit-plan-lines/${lineId}/checklist-items`);
    } catch (e) {
      toast(e.message, 'error');
      currentLine = null;
      checklistItems = [];
    }
    renderLineDetail();
  }

  function renderLineDetail() {
    if (!currentLine) {
      contentEl.innerHTML = '<div class="empty-state-inline">Themenbereich nicht gefunden</div>';
      return;
    }

    headerEl.innerHTML = `
      <h2>${escapeHtml(currentLine.subject || 'Themenbereich')}</h2>
    `;

    const monthOptions = ['', 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    function monthSelect(id, val) {
      return `<select class="inline-input" id="${id}">${monthOptions.map(m =>
        `<option value="${escapeHtml(m)}" ${m === (val || '') ? 'selected' : ''}>${m || '--'}</option>`
      ).join('')}</select>`;
    }
    let html = '<div class="audit-detail">';

    // ── Themenbereich Meta ──
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Themenbereich</h3></div>
      <div class="inline-form-grid">
        <label>Themenbereich</label><input class="inline-input" id="ld-subject" value="${escapeHtml(currentLine.subject || '')}">
        <label>Vorschriften</label><textarea class="inline-input inline-textarea" id="ld-regulations" rows="2">${escapeHtml(currentLine.regulations || '')}</textarea>
        <label>Ort</label><input class="inline-input" id="ld-location" value="${escapeHtml(currentLine.location || '')}">
        <label>Monat geplant</label>${monthSelect('ld-planned-window', currentLine.planned_window)}
      </div>
    </div>`;

    // ── Audit-Informationen ──
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Audit-Informationen</h3></div>
      <div class="inline-form-grid">
        <label>Auditor Team</label><input class="inline-input" id="ld-auditor-team" value="${escapeHtml(currentLine.auditor_team || '')}">
        <label>Auditee</label><input class="inline-input" id="ld-auditee" value="${escapeHtml(currentLine.auditee || '')}">
        <label>Start</label><input class="inline-input" id="ld-audit-start-date" value="${escapeHtml(formatDateDE(currentLine.audit_start_date))}" placeholder="TT.MM.JJJJ">
        <label>Ende</label><input class="inline-input" id="ld-audit-end-date" value="${escapeHtml(formatDateDE(currentLine.audit_end_date))}" placeholder="TT.MM.JJJJ">
        <label>Audit Ort</label><input class="inline-input" id="ld-audit-location" value="${escapeHtml(currentLine.audit_location || '')}">
        <label>Dokument Ref.</label><input class="inline-input" id="ld-doc-ref" value="${escapeHtml(currentLine.document_ref || '')}">
        <label>Iss/Rev</label><input class="inline-input" id="ld-doc-iss-rev" value="${escapeHtml(currentLine.document_iss_rev || '')}">
        <label>Rev Datum</label><input class="inline-input" id="ld-doc-rev-date" value="${escapeHtml(formatDateDE(currentLine.document_rev_date))}" placeholder="TT.MM.JJJJ">
        <label>Empfehlung</label><textarea class="inline-input inline-textarea" id="ld-recommendation" rows="2">${escapeHtml(currentLine.recommendation || '')}</textarea>
      </div>
    </div>`;

    // ── Eval Summary ──
    html += renderEvalSummary();

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
            <col style="width:36px"><col style="width:11%"><col style="width:25%"><col style="width:90px"><col style="width:10%"><col style="width:auto"><col style="width:36px">
          </colgroup>
          <thead><tr>
            <th>#</th><th>Regulation</th><th>Compliance Check</th><th>Bewertung</th><th>Dok. Ref.</th><th>Kommentar</th><th></th>
          </tr></thead><tbody>`;
        items.forEach((item, idx) => {
          const evalClass = item.evaluation ? `eval-${item.evaluation}` : '';
          html += `<tr class="ci-row-clickable" data-id="${item.id}">
            <td>${idx + 1}</td>
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

    html += '</div>';
    contentEl.innerHTML = html;

    // ── Auto-save on blur for all inline fields ──
    // Init date auto-format for all date text inputs
    ['ld-audit-start-date', 'ld-audit-end-date', 'ld-doc-rev-date'].forEach(id => {
      initDateAutoFormat(document.getElementById(id));
    });

    function parseDateDE(val) {
      if (!val || !val.trim()) return null;
      const m = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (!m) return undefined; // invalid
      return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    }

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
        planned_window: document.getElementById('ld-planned-window').value,
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
          saveNavState();
          renderBreadcrumb();
        }
        // Update header
        headerEl.querySelector('h2').textContent = data.subject || 'Themenbereich';
      } catch (err) {
        toast(err.message, 'error');
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
        const sectionItems = checklistItems.filter(ci => ci.section === section);
        openChecklistItemDialog(null, section, sectionItems.length + 1);
      });
    });

    // ── Checklist item row click → edit, delete button → delete ──
    contentEl.querySelectorAll('.ci-row-clickable').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pane-action-btn')) return;
        const item = checklistItems.find(ci => ci.id === row.dataset.id);
        if (item) openChecklistItemDialog(item);
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
  function openChecklistItemDialog(item, defaultSection, defaultSortOrder) {
    const isEdit = !!item;
    document.getElementById('checklist-item-dialog-title').textContent = isEdit ? 'Eintrag bearbeiten' : 'Eintrag hinzuf\u00fcgen';
    document.getElementById('ci-form-id').value = isEdit ? item.id : '';
    document.getElementById('ci-form-section').value = isEdit ? (item.section || 'THEORETICAL') : (defaultSection || 'THEORETICAL');
    document.getElementById('ci-form-sort-order').value = isEdit ? (item.sort_order || 0) : (defaultSortOrder || checklistItems.length + 1);
    document.getElementById('ci-form-regulation-ref').value = isEdit ? (item.regulation_ref || '') : '';
    document.getElementById('ci-form-compliance-check').value = isEdit ? (item.compliance_check || '') : '';
    document.getElementById('ci-form-evaluation').value = isEdit ? (item.evaluation || '') : '';
    document.getElementById('ci-form-doc-ref').value = isEdit ? (item.document_ref || '') : '';
    document.getElementById('ci-form-comment').value = isEdit ? (item.auditor_comment || '') : '';
    // Evidence section: show only in edit mode
    const evSection = document.getElementById('ci-evidence-section');
    const evThumbs = document.getElementById('ci-evidence-thumbs');
    evThumbs.innerHTML = '';
    if (isEdit) {
      evSection.style.display = '';
      loadChecklistEvidenceThumbs(item.id);
    } else {
      evSection.style.display = 'none';
    }
    ciDialog.showModal();
    document.getElementById('ci-form-regulation-ref').focus();
  }

  document.getElementById('ci-btn-cancel').addEventListener('click', () => ciDialog.close());

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
      toast(err.message, 'error');
    }
  });

  // ── Checklist Item Delete ──────────────────────────────────
  let ciDeleteTarget = null;

  function confirmDeleteChecklistItem(item) {
    ciDeleteTarget = item;
    ciDeleteDialog.showModal();
  }

  document.getElementById('ci-delete-cancel').addEventListener('click', () => ciDeleteDialog.close());
  document.getElementById('ci-delete-confirm').addEventListener('click', async () => {
    if (!ciDeleteTarget) return;
    try {
      await fetchJSON(`/api/checklist-items/${ciDeleteTarget.id}`, { method: 'DELETE' });
      toast('Eintrag gel\u00f6scht');
      ciDeleteDialog.close();
      await loadLineDetail(currentLine.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

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
      toast(err.message, 'error');
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
          <select class="import-mapping-select" data-filename="${escapeHtml(file.name)}">
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
      toast(err.message, 'error');
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
      toast(err.message, 'error');
    }
  });

  document.getElementById('import-results-close').addEventListener('click', () => {
    importResultsDialog.close();
    if (currentPlan) loadAuditPlanDetail(currentPlan.id);
  });

  // ── CAP Section ──────────────────────────────────────────
  let capItems = [];
  let capSummary = { total: 0, closed: 0 };

  async function loadCapSection(planId) {
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

  function renderCapSection() {
    const section = document.getElementById('cap-section');
    if (!section) return;

    const total = capSummary.total || 0;
    const closed = capSummary.closed || 0;
    const pct = total > 0 ? Math.round(closed / total * 100) : 0;

    let html = `<div class="cap-section-header">
      <h3>Corrective Action Plan (CAP)</h3>
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

    const filtered = capFilter ? capItems.filter(c => c.status === capFilter) : capItems;

    if (filtered.length === 0) {
      html += '<div class="empty-state-inline" style="padding:16px 0">Keine Eintr\u00e4ge</div>';
    } else {
      html += `<div class="lines-table-wrap"><table class="lines-table">
        <thead><tr>
          <th>Nr.</th><th>Audit-Nr.</th><th>Thema</th><th>Finding</th><th>Level</th><th>Deadline</th><th>Status</th>
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
          <td><span class="cap-status-${cap.status}">${cap.status}</span></td>
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
        saveNavState();
        renderCapSection();
      });
    });

    // Row click → navigate to CAP detail
    section.querySelectorAll('.cap-row-clickable').forEach(row => {
      row.addEventListener('click', () => {
        const cap = capItems.find(c => c.id === row.dataset.capId);
        if (cap) {
          navPath.push({ type: 'cap-item', id: cap.id, name: 'CAP' });
          renderCurrentLevel();
        }
      });
    });
  }

  // ── CAP Detail Level (inline drill-down) ──────────────────
  let currentCapItem = null;

  async function renderCapDetailLevel(capItemId) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = '<div class="empty-state-inline">Lade...</div>';

    try {
      currentCapItem = await fetchJSON(`/api/cap-items/${capItemId}`);
    } catch (e) {
      toast(e.message, 'error');
      currentCapItem = null;
    }

    if (!currentCapItem) {
      contentEl.innerHTML = '<div class="empty-state-inline">CAP-Eintrag nicht gefunden</div>';
      return;
    }

    headerEl.innerHTML = `<h2>Corrective Action</h2>`;

    const cap = currentCapItem;
    let html = '<div class="audit-detail">';

    // Read-only info block
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Finding-Info</h3></div>
      <div class="cap-info-block">
        <div class="cap-info-row"><span class="cap-info-label">Audit-Nr.</span><span>${escapeHtml(cap.audit_no || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Thema</span><span>${escapeHtml(cap.subject || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Finding</span><span>${escapeHtml(cap.compliance_check || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Level</span><span>${cap.evaluation ? `<span class="eval-badge eval-${cap.evaluation}">${escapeHtml(cap.evaluation)}</span>` : ''}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Regulation Ref.</span><span>${escapeHtml(cap.regulation_ref || '')}</span></div>
        <div class="cap-info-row"><span class="cap-info-label">Kommentar</span><span>${escapeHtml(cap.auditor_comment || '')}</span></div>
      </div>
    </div>`;

    // Editable fields
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Corrective Action</h3></div>
      <div class="inline-form-grid">
        <label>Deadline</label><input class="inline-input cap-field" id="cap-f-deadline" value="${escapeHtml(formatDateDE(cap.deadline))}" placeholder="TT.MM.JJJJ">
        <label>Verantwortlich</label><input class="inline-input cap-field" id="cap-f-responsible" value="${escapeHtml(cap.responsible_person || '')}">
        <label>Ursache</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-root-cause" rows="3">${escapeHtml(cap.root_cause || '')}</textarea>
        <label>Korrekturma\u00dfnahme</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-corrective" rows="3">${escapeHtml(cap.corrective_action || '')}</textarea>
        <label>Vorbeugema\u00dfnahme</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-preventive" rows="3">${escapeHtml(cap.preventive_action || '')}</textarea>
        <label>Status</label><select class="inline-input cap-field" id="cap-f-status">
          <option value="OPEN" ${cap.status === 'OPEN' ? 'selected' : ''}>OPEN</option>
          <option value="CLOSED" ${cap.status === 'CLOSED' ? 'selected' : ''}>CLOSED</option>
        </select>
        <label>Erledigt am</label><input class="inline-input cap-field" id="cap-f-completion-date" value="${escapeHtml(formatDateDE(cap.completion_date))}" placeholder="TT.MM.JJJJ">
        <label>Nachweis</label><textarea class="inline-input inline-textarea cap-field" id="cap-f-evidence" rows="3">${escapeHtml(cap.evidence || '')}</textarea>
      </div>
    </div>`;

    // Evidence images
    html += `<div class="audit-section">
      <div class="audit-section-header"><h3>Nachweise</h3></div>
      <div class="cap-evidence-thumbs" id="cap-evidence-thumbs"></div>
      <input type="file" id="cap-evidence-upload" accept="image/png,image/jpeg,.pdf" multiple style="margin-top:0.5rem">
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

    // Load evidence thumbnails
    loadEvidenceThumbs(cap.id);

    // Evidence upload handler
    document.getElementById('cap-evidence-upload').addEventListener('change', async (e) => {
      const container = document.getElementById('cap-evidence-thumbs');
      for (const file of e.target.files) {
        try {
          const base64 = await fileToBase64(file);
          const created = await fetchJSON(`/api/cap-items/${cap.id}/evidence-files`, {
            method: 'POST',
            body: { filename: file.name, mime_type: file.type || 'image/png', data: base64 }
          });
          addEvidenceThumb(container, created, '/api/evidence-files');
        } catch (err) { toast(err.message, 'error'); }
      }
      e.target.value = '';
    });
  }

  function parseDateDE(val) {
    if (!val || !val.trim()) return null;
    const m = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return undefined; // invalid
    return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
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
      status: document.getElementById('cap-f-status').value,
      completion_date: completionIso,
      evidence: document.getElementById('cap-f-evidence').value.trim(),
    };

    try {
      await fetchJSON(`/api/cap-items/${capId}`, { method: 'PUT', body: data });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadEvidenceThumbs(capItemId) {
    const container = document.getElementById('cap-evidence-thumbs');
    if (!container) return;
    container.innerHTML = '';
    try {
      const files = await fetchJSON(`/api/cap-items/${capItemId}/evidence-files`);
      files.forEach(f => addEvidenceThumb(container, f, '/api/evidence-files'));
    } catch { /* ignore */ }
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
      } catch (err) { toast(err.message, 'error'); }
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
    } catch { /* ignore */ }
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
      } catch (err) { toast(err.message, 'error'); }
    }
    e.target.value = '';
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await loadCompanies();

    const saved = loadNavState();
    if (saved && saved.selectedId && companies.find(c => c.id === saved.selectedId)) {
      selectedId = saved.selectedId;
      navPath = Array.isArray(saved.navPath) ? saved.navPath : [];
      capFilter = saved.capFilter || null;
      auditLineFilters = new Set(Array.isArray(saved.auditLineFilters) ? saved.auditLineFilters : []);

      renderList();
      emptyEl.style.display = 'none';
      rightPane.style.display = 'block';
      await renderCurrentLevel();
    }
  }

  init();
})();
