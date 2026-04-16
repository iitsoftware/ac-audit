/* ── Organization Page ────────────────────────────────────── */

(function () {
  let companies = [];
  let selectedId = null;
  let logoBase64 = null;
  let removeLogo = false;
  let departments = [];
  let persons = [];
  let selectedDeptId = null;

  const NAV_STORAGE_KEY = 'ac-org-nav-state';

  function saveNav() {
    saveNavState(NAV_STORAGE_KEY, { selectedId, selectedDeptId });
  }

  function loadNav() {
    return loadNavState(NAV_STORAGE_KEY);
  }

  const companyTabsEl = document.getElementById('company-tabs');
  const emptyEl = document.getElementById('empty-state');
  const rightPane = document.getElementById('right-pane-content');
  const orgDetail = document.getElementById('org-detail');
  const dialog = document.getElementById('company-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const deptDialog = document.getElementById('dept-dialog');
  const deptDeleteDialog = document.getElementById('dept-delete-dialog');

  // ── Load & Render Company List ────────────────────────────
  async function loadCompanies() {
    try {
      companies = await fetchJSON('/api/companies');
    } catch (e) {
      toast(e.message, 'error');
      companies = [];
    }
    renderCompanyTabs();
  }

  function renderCompanyTabs() {
    let html = '';
    companies.forEach(c => {
      const isActive = c.id === selectedId;
      const active = isActive ? ' tab-active' : '';
      html += `<button class="tab${active}" data-id="${c.id}">${escapeHtml(c.name)}</button>`;
      if (isActive) {
        html += `<button class="tab-remove-btn" data-id="${c.id}" title="Firma l\u00f6schen" aria-label="Firma l\u00f6schen">\u00d7</button>`;
      }
    });
    companyTabsEl.innerHTML = html;

    companyTabsEl.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.id === selectedId) {
          const c = companies.find(x => x.id === selectedId);
          if (c) openDialog(c);
        } else {
          selectCompany(btn.dataset.id);
        }
      });
    });

    companyTabsEl.querySelectorAll('.tab-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = companies.find(x => x.id === btn.dataset.id);
        if (c) confirmDelete(c);
      });
    });
  }

  async function selectCompany(id) {
    selectedId = id;
    selectedDeptId = null;
    saveNav();
    renderCompanyTabs();
    emptyEl.style.display = 'none';
    rightPane.style.display = 'block';
    await loadDepartments();
    await loadPersons();
    renderOrgDetail();
  }

  function showEmpty() {
    selectedId = null;
    selectedDeptId = null;
    saveNav();
    emptyEl.style.display = 'flex';
    rightPane.style.display = 'none';
    orgDetail.innerHTML = '';
    renderCompanyTabs();
  }

  async function loadDepartments() {
    if (!selectedId) return;
    try {
      departments = await fetchJSON(`/api/companies/${selectedId}/departments`);
    } catch (e) {
      toast(e.message, 'error');
      departments = [];
    }
  }

  async function loadPersons() {
    if (!selectedId) return;
    try {
      persons = await fetchJSON(`/api/companies/${selectedId}/persons`);
    } catch { persons = []; }
  }

  // ── Render org detail ────────────────────────────────────
  function renderOrgDetail() {
    const company = companies.find(c => c.id === selectedId);
    if (!company) { orgDetail.innerHTML = ''; return; }

    let html = '<div class="org-company-detail">';
    html += '<div class="org-company-header">';
    if (company.has_logo) {
      html += `<img src="/api/companies/${company.id}/logo?t=${Date.now()}" class="company-logo">`;
    } else {
      html += '<div class="company-logo-placeholder">&#127970;</div>';
    }
    html += '<div class="org-company-info">';
    html += `<h2>${escapeHtml(company.name)}</h2>`;
    const addr = [company.street, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (addr) html += `<div class="org-company-addr">${escapeHtml(addr)}</div>`;
    html += '</div></div>';

    // Company-level persons
    const accPerson = persons.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);
    if (accPerson && (accPerson.first_name || accPerson.last_name)) {
      html += '<div class="org-persons-section">';
      html += '<div class="org-person-row">';
      html += '<span class="org-person-role">Accountable Manager</span>';
      html += `<span class="org-person-name">${escapeHtml((accPerson.first_name + ' ' + accPerson.last_name).trim())}</span>`;
      if (accPerson.email) html += `<span class="org-person-email">${escapeHtml(accPerson.email)}</span>`;
      if (!accPerson.has_signature) html += '<span class="org-sig-missing" title="Signatur fehlt">&#9888; Signatur fehlt</span>';
      html += '</div></div>';
    }
    html += '</div>';

    // Department tile grid
    html += '<div class="org-dept-section">';
    html += '<div class="pane-content-header"><h3>Abteilungen</h3><button class="btn-icon" id="btn-add-dept-inline" title="Abteilung hinzuf\u00fcgen">+</button></div>';
    if (departments.length === 0) {
      html += '<div class="empty-state-inline">Keine Abteilungen vorhanden</div>';
    } else {
      html += '<div class="org-dept-tile-grid">';
      departments.forEach(d => {
        const missing = getDeptMissing(d);
        const warnClass = missing.length > 0 ? ' org-dept-tile--warn' : '';
        html += `<div class="org-dept-tile${warnClass}" data-id="${d.id}">`;
        html += `<button class="org-dept-tile-remove" data-id="${d.id}" title="Abteilung l\u00f6schen" aria-label="${escapeAttr(d.name)} l\u00f6schen">\u00d7</button>`;
        html += `<div class="org-dept-tile-name">${escapeHtml(d.name)}</div>`;
        const meta = [d.easa_permission_number, d.regulation].filter(Boolean).join(' \u2022 ');
        if (meta) html += `<div class="org-dept-tile-meta">${escapeHtml(meta)}</div>`;
        if (missing.length > 0) {
          html += `<div class="org-dept-tile-warn" title="${escapeAttr('Fehlend: ' + missing.join(', '))}">&#9888;</div>`;
        }
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    orgDetail.innerHTML = html;

    // Add dept button
    const addDeptBtn = document.getElementById('btn-add-dept-inline');
    if (addDeptBtn) addDeptBtn.addEventListener('click', () => openDeptDialog(null));

    // Click tile → open edit dialog
    orgDetail.querySelectorAll('.org-dept-tile').forEach(tile => {
      tile.addEventListener('click', (e) => {
        if (e.target.closest('.org-dept-tile-remove')) return;
        const d = departments.find(x => x.id === tile.dataset.id);
        if (d) openDeptDialog(d);
      });
    });

    // × remove button → confirm delete
    orgDetail.querySelectorAll('.org-dept-tile-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = departments.find(x => x.id === btn.dataset.id);
        if (d) confirmDeleteDept(d);
      });
    });
  }

  function getDeptMissing(dept) {
    const missing = [];
    const qm = persons.find(p => p.role === 'QM' && p.department_id === dept.id);
    const al = persons.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
    if (!qm || (!qm.first_name && !qm.last_name)) missing.push('CMM Person');
    if (!qm || !qm.has_signature) missing.push('CMM Signatur');
    const alLabel = getDeptLeaderLabel(dept);
    if (!al || (!al.first_name && !al.last_name)) missing.push(alLabel + ' Person');
    if (!al || !al.has_signature) missing.push(alLabel + ' Signatur');
    if (!dept.authority_name && !dept.authority_email) missing.push('Beh\u00f6rdenkontakt');
    return missing;
  }

  function getDeptLeaderLabel(dept) {
    const text = `${dept.name} ${dept.regulation || ''}`.toLowerCase();
    if (text.includes('145')) return 'Maintenance Manager';
    if (text.includes('camo') || text.includes('part-m')) return 'Leiter CAMO';
    if (text.includes('ato') || text.includes('flugschule') || text.includes('training')) return 'Head of Training';
    if (text.includes('flug') || text.includes('ops') || text.includes('ore') || text.includes('965')) return 'Flugbetriebsleiter';
    return 'Abteilungsleiter';
  }

  // ── Signature State ─────────────────────────────────────
  const sigStates = {};

  function setupSigInput(key) {
    sigStates[key] = null;
    const fileInput = document.getElementById(key.startsWith('dept-') ? `dept-form-${key.replace('dept-','')}-sig` : `form-${key}-sig`);
    const previewRow = document.getElementById(key.startsWith('dept-') ? `dept-form-${key.replace('dept-','')}-sig-preview-row` : `form-${key}-sig-preview-row`);
    const previewImg = document.getElementById(key.startsWith('dept-') ? `dept-form-${key.replace('dept-','')}-sig-preview` : `form-${key}-sig-preview`);

    fileInput.value = '';
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        sigStates[key] = { base64: reader.result.split(',')[1] };
        previewImg.src = reader.result;
        previewRow.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    };

    return { previewRow, previewImg };
  }

  document.querySelectorAll('.remove-logo-btn[data-sig]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sig;
      sigStates[key] = { remove: true };
      const previewRow = btn.closest('.logo-preview-row');
      previewRow.style.display = 'none';
      const fileInput = document.getElementById(key.startsWith('dept-') ? `dept-form-${key.replace('dept-','')}-sig` : `form-${key}-sig`);
      fileInput.value = '';
    });
  });

  async function savePerson(companyId, role, deptId, firstName, lastName, email, sigState) {
    const p = persons.find(pr => pr.role === role && (deptId ? pr.department_id === deptId : !pr.department_id));
    let personId;
    if (p) {
      await fetchJSON(`/api/persons/${p.id}`, { method: 'PUT', body: { first_name: firstName, last_name: lastName, email } });
      personId = p.id;
    } else if (firstName || lastName || email) {
      const created = await fetchJSON(`/api/companies/${companyId}/persons`, {
        method: 'POST',
        body: { role, first_name: firstName, last_name: lastName, email, department_id: deptId }
      });
      personId = created.id;
    }
    if (personId && sigState) {
      if (sigState.base64) {
        await fetchJSON(`/api/persons/${personId}/signature`, { method: 'PUT', body: { signature: sigState.base64 } });
      } else if (sigState.remove) {
        await fetchJSON(`/api/persons/${personId}/signature`, { method: 'PUT', body: { signature: null } });
      }
    }
  }

  // ── Company Dialog (Add / Edit) ───────────────────────────
  async function openDialog(company) {
    const isEdit = !!company;
    document.getElementById('dialog-title').textContent = isEdit ? 'Firma bearbeiten' : 'Firma hinzuf\u00fcgen';
    document.getElementById('form-id').value = isEdit ? company.id : '';
    document.getElementById('form-name').value = isEdit ? company.name : '';
    document.getElementById('form-street').value = isEdit ? (company.street || '') : '';
    document.getElementById('form-postal').value = isEdit ? (company.postal_code || '') : '';
    document.getElementById('form-city').value = isEdit ? (company.city || '') : '';
    document.getElementById('form-phone').value = isEdit ? (company.phone || '') : '';
    document.getElementById('form-fax').value = isEdit ? (company.fax || '') : '';
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

    const personsSection = document.getElementById('company-persons-section');
    if (isEdit) {
      await loadPersons();
      const acc = persons.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);
      document.getElementById('form-acc-firstname').value = acc ? acc.first_name : '';
      document.getElementById('form-acc-lastname').value = acc ? acc.last_name : '';
      document.getElementById('form-acc-email').value = acc ? (acc.email || '') : '';
      for (const { key, person } of [{ key: 'acc', person: acc }]) {
        const { previewRow: pr, previewImg } = setupSigInput(key);
        if (person && person.has_signature) {
          previewImg.src = `/api/persons/${person.id}/signature?t=${Date.now()}`;
          pr.style.display = 'flex';
        } else {
          pr.style.display = 'none';
        }
      }
    } else {
      document.getElementById('form-acc-firstname').value = '';
      document.getElementById('form-acc-lastname').value = '';
      document.getElementById('form-acc-email').value = '';
      const { previewRow: pr } = setupSigInput('acc');
      pr.style.display = 'none';
    }
    personsSection.style.display = '';

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
      phone: document.getElementById('form-phone').value.trim(),
      fax: document.getElementById('form-fax').value.trim(),
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
        await savePerson(id, 'ACCOUNTABLE', null,
          document.getElementById('form-acc-firstname').value.trim(),
          document.getElementById('form-acc-lastname').value.trim(),
          document.getElementById('form-acc-email').value.trim(),
          sigStates.acc);
        toast('Firma aktualisiert');
      } else {
        if (logoBase64) data.logo = logoBase64;
        const created = await fetchJSON('/api/companies', { method: 'POST', body: data });
        selectedId = created.id;
        await savePerson(created.id, 'ACCOUNTABLE', null,
          document.getElementById('form-acc-firstname').value.trim(),
          document.getElementById('form-acc-lastname').value.trim(),
          document.getElementById('form-acc-email').value.trim(),
          sigStates.acc);
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
  document.getElementById('btn-add-dept').addEventListener('click', () => openDeptDialog(null));

  async function openDeptDialog(dept) {
    const isEdit = !!dept;
    document.getElementById('dept-dialog-title').textContent = isEdit ? 'Abteilung bearbeiten' : 'Abteilung hinzuf\u00fcgen';
    document.getElementById('dept-form-id').value = isEdit ? dept.id : '';
    document.getElementById('dept-form-name').value = isEdit ? dept.name : '';
    document.getElementById('dept-form-easa').value = isEdit ? (dept.easa_permission_number || '') : '';
    document.getElementById('dept-form-regulation').value = isEdit ? (dept.regulation || '') : '';
    document.getElementById('dept-form-authority-salutation').value = isEdit ? (dept.authority_salutation || '') : '';
    document.getElementById('dept-form-authority-name').value = isEdit ? (dept.authority_name || '') : '';
    document.getElementById('dept-form-authority-email').value = isEdit ? (dept.authority_email || '') : '';
    document.getElementById('dept-form-initial-approval-email').value = isEdit ? (dept.initial_approval_email || '') : '';

    const personsSection = document.getElementById('dept-persons-section');
    if (isEdit) {
      await loadPersons();
      const qm = persons.find(p => p.role === 'QM' && p.department_id === dept.id);
      const al = persons.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
      document.getElementById('dept-form-qm-firstname').value = qm ? qm.first_name : '';
      document.getElementById('dept-form-qm-lastname').value = qm ? qm.last_name : '';
      document.getElementById('dept-form-qm-email').value = qm ? (qm.email || '') : '';
      document.getElementById('dept-form-al-firstname').value = al ? al.first_name : '';
      document.getElementById('dept-form-al-lastname').value = al ? al.last_name : '';
      document.getElementById('dept-form-al-email').value = al ? (al.email || '') : '';

      for (const { key, person } of [{ key: 'dept-qm', person: qm }, { key: 'dept-al', person: al }]) {
        const { previewRow: pr, previewImg } = setupSigInput(key);
        if (person && person.has_signature) {
          previewImg.src = `/api/persons/${person.id}/signature?t=${Date.now()}`;
          pr.style.display = 'flex';
        } else {
          pr.style.display = 'none';
        }
      }
    } else {
      document.getElementById('dept-form-qm-firstname').value = '';
      document.getElementById('dept-form-qm-lastname').value = '';
      document.getElementById('dept-form-qm-email').value = '';
      document.getElementById('dept-form-al-firstname').value = '';
      document.getElementById('dept-form-al-lastname').value = '';
      document.getElementById('dept-form-al-email').value = '';
      for (const key of ['dept-qm', 'dept-al']) {
        const { previewRow: pr } = setupSigInput(key);
        pr.style.display = 'none';
      }
    }

    const alLabel = isEdit ? getDeptLeaderLabel(dept) : 'Abteilungsleiter';
    document.getElementById('dept-form-al-label').textContent = alLabel;

    personsSection.style.display = '';
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
      authority_salutation: document.getElementById('dept-form-authority-salutation').value,
      authority_name: document.getElementById('dept-form-authority-name').value.trim(),
      authority_email: document.getElementById('dept-form-authority-email').value.trim(),
      initial_approval_email: document.getElementById('dept-form-initial-approval-email').value.trim(),
    };

    if (!data.name) { toast('Name ist erforderlich', 'error'); return; }

    try {
      if (id) {
        await fetchJSON(`/api/departments/${id}`, { method: 'PUT', body: data });
        await savePerson(selectedId, 'QM', id,
          document.getElementById('dept-form-qm-firstname').value.trim(),
          document.getElementById('dept-form-qm-lastname').value.trim(),
          document.getElementById('dept-form-qm-email').value.trim(),
          sigStates['dept-qm']);
        await savePerson(selectedId, 'ABTEILUNGSLEITER', id,
          document.getElementById('dept-form-al-firstname').value.trim(),
          document.getElementById('dept-form-al-lastname').value.trim(),
          document.getElementById('dept-form-al-email').value.trim(),
          sigStates['dept-al']);
        toast('Abteilung aktualisiert');
      } else {
        const newDept = await fetchJSON(`/api/companies/${selectedId}/departments`, { method: 'POST', body: data });
        await savePerson(selectedId, 'QM', newDept.id,
          document.getElementById('dept-form-qm-firstname').value.trim(),
          document.getElementById('dept-form-qm-lastname').value.trim(),
          document.getElementById('dept-form-qm-email').value.trim(),
          sigStates['dept-qm']);
        await savePerson(selectedId, 'ABTEILUNGSLEITER', newDept.id,
          document.getElementById('dept-form-al-firstname').value.trim(),
          document.getElementById('dept-form-al-lastname').value.trim(),
          document.getElementById('dept-form-al-email').value.trim(),
          sigStates['dept-al']);
        toast('Abteilung erstellt');
      }
      deptDialog.close();
      await loadDepartments();
      await loadPersons();
      renderOrgDetail();
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
      if (selectedDeptId === deptDeleteTarget.id) selectedDeptId = null;
      await loadDepartments();
      renderOrgDetail();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await loadCompanies();

    const saved = loadNav();
    if (saved && saved.selectedId && companies.find(c => c.id === saved.selectedId)) {
      selectedId = saved.selectedId;
      selectedDeptId = saved.selectedDeptId || null;
      renderCompanyTabs();
      emptyEl.style.display = 'none';
      rightPane.style.display = 'block';
      await loadDepartments();
      await loadPersons();
      renderOrgDetail();
    }
  }

  init();
})();
