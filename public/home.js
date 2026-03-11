/* ── Home Page Logic ──────────────────────────────────────── */

(async function () {
  const tileAudit = document.getElementById('tile-audit');
  const auditStats = document.getElementById('audit-stats');
  const capContainer = document.getElementById('cap-table-container');
  const filterBar = document.getElementById('home-cap-filters');
  let activeFilter = null;
  let allCapItems = [];

  const tagDefs = [
    { key: 'O',  label: 'OBSERVATION', css: 'tag-observation' },
    { key: 'L1', label: 'LEVEL 1',     css: 'tag-finding' },
    { key: 'L2', label: 'LEVEL 2',     css: 'tag-finding' },
    { key: 'L3', label: 'LEVEL 3',     css: 'tag-observation' },
  ];

  // Navigate to companies on tile click
  tileAudit.addEventListener('click', () => {
    window.location.href = '/companies';
  });

  // Filter button clicks
  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const key = btn.dataset.filter;
    if (activeFilter === key) {
      activeFilter = null;
    } else {
      activeFilter = key;
    }
    renderFilterBar();
    renderCapTable();
  });

  try {
    const data = await fetchJSON('/api/home/stats');
    const audit = data.modules.audit;
    allCapItems = data.capItems;

    // Render tile stats
    const overdueClass = audit.overdueCaps > 0 ? ' home-tile__stat--danger' : '';
    auditStats.innerHTML =
      `<span class="home-tile__stat">${audit.openCaps} offene CAPs</span>` +
      `<span class="home-tile__stat${overdueClass}">${audit.overdueCaps} überfällig</span>` +
      `<span class="home-tile__stat home-tile__stat--muted">${audit.totalAudits} Audits gesamt</span>`;

    renderFilterBar();
    renderCapTable();

  } catch (err) {
    capContainer.innerHTML = `<p class="home-cap-empty">Fehler beim Laden: ${escapeHtml(err.message)}</p>`;
  }

  function renderFilterBar() {
    // Count per evaluation
    const counts = {};
    for (const cap of allCapItems) {
      const ev = cap.evaluation || '';
      counts[ev] = (counts[ev] || 0) + 1;
    }

    let html = '';
    for (const def of tagDefs) {
      const count = counts[def.key] || 0;
      if (count === 0) continue;
      const active = activeFilter === def.key ? ' active' : '';
      html += `<button class="audit-filter-btn audit-tag ${def.css}${active}" data-filter="${def.key}">${def.label} (${count})</button>`;
    }
    filterBar.innerHTML = html;
  }

  function renderCapTable() {
    const items = activeFilter
      ? allCapItems.filter(c => c.evaluation === activeFilter)
      : allCapItems;

    if (items.length === 0) {
      capContainer.innerHTML = '<p class="home-cap-empty">Keine offenen Corrective Actions</p>';
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    let html = `<div class="home-cap-table-wrap"><table class="home-cap-table">
      <thead><tr>
        <th>Modul</th>
        <th>Firma</th>
        <th>Abteilung</th>
        <th>Audit Nr.</th>
        <th>Bewertung</th>
        <th>Beschreibung</th>
        <th>Fälligkeit</th>
        <th>Status</th>
      </tr></thead><tbody>`;

    for (const cap of items) {
      const rowClass = cap.isOverdue ? ' class="home-cap-row--overdue"' : '';
      const evalClass = getEvalClass(cap.evaluation);
      const desc = cap.description && cap.description.length > 80
        ? escapeHtml(cap.description.slice(0, 80)) + '&hellip;'
        : escapeHtml(cap.description || '');

      let deadlineClass = '';
      if (cap.deadline) {
        if (cap.deadline < today) deadlineClass = ' home-cap-deadline--overdue';
        else if (cap.deadline < soon) deadlineClass = ' home-cap-deadline--soon';
      }

      const statusBadge = cap.isOverdue
        ? '<span class="home-cap-badge home-cap-badge--overdue">Überfällig</span>'
        : '<span class="home-cap-badge home-cap-badge--open">Offen</span>';

      html += `<tr${rowClass} data-cap-id="${cap.id}" style="cursor:pointer">
        <td><span class="home-cap-badge home-cap-badge--module">${escapeHtml((cap.source || 'audit').toUpperCase())}</span></td>
        <td>${escapeHtml(cap.companyName)}</td>
        <td>${escapeHtml(cap.departmentName)}</td>
        <td>${escapeHtml(cap.auditNo || '')}</td>
        <td><span class="home-cap-eval ${evalClass}">${escapeHtml(cap.evaluation || '')}</span></td>
        <td class="home-cap-desc">${desc}</td>
        <td class="home-cap-deadline${deadlineClass}">${formatDateDE(cap.deadline)}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    capContainer.innerHTML = html;

    // Click handler for rows — deep-link into CAP detail
    capContainer.querySelectorAll('tr[data-cap-id]').forEach(row => {
      row.addEventListener('click', () => {
        const capId = row.dataset.capId;
        const cap = allCapItems.find(c => c.id === capId);
        if (!cap) return;

        const navState = {
          selectedId: cap.companyId,
          navPath: [
            { type: 'department', id: cap.departmentId, name: cap.departmentName },
            { type: 'audit-plan', id: cap.auditPlanId, name: String(cap.auditPlanYear) },
            { type: 'cap-item', id: cap.id, name: 'CAP' },
          ],
          capFilter: null,
          auditLineFilters: [],
        };
        localStorage.setItem('ac-audit-nav-state', JSON.stringify(navState));
        window.location.href = '/companies';
      });
    });
  }

  function getEvalClass(evaluation) {
    switch (evaluation) {
      case 'L1': return 'home-cap-eval--l1';
      case 'L2': return 'home-cap-eval--l2';
      case 'L3': return 'home-cap-eval--l3';
      case 'O': return 'home-cap-eval--obs';
      default: return '';
    }
  }
})();
