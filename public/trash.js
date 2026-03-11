(async function() {
  let offset = 0;
  const limit = 50;
  const tbody = document.getElementById('trash-body');
  const loadMoreBtn = document.getElementById('trash-load-more');
  const emptyBtn = document.getElementById('trash-empty-btn');
  const emptyMsg = document.getElementById('trash-empty-msg');

  const typeLabels = {
    audit_plan: 'Auditplan',
    audit_plan_line: 'Themenbereich',
    cap_item: 'CAP'
  };

  async function loadItems() {
    const items = await fetchJSON(`/api/trash?limit=${limit}&offset=${offset}`);
    for (const item of items) {
      const tr = document.createElement('tr');
      const d = new Date(item.deleted_at + 'Z');
      const dateStr = d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      tr.innerHTML = `
        <td><span class="trash-type-badge trash-type-${item.entity_type}">${escapeHtml(typeLabels[item.entity_type] || item.entity_type)}</span></td>
        <td>${escapeHtml(item.entity_name || '-')}</td>
        <td>${escapeHtml(item.company_name || '')}</td>
        <td>${escapeHtml(item.department_name || '')}</td>
        <td>${dateStr}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-icon" data-restore="${item.id}" title="Wiederherstellen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
          <button class="btn-icon btn-icon-danger" data-delete="${item.id}" title="Endgültig löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </td>`;
      tbody.appendChild(tr);
    }
    offset += items.length;
    loadMoreBtn.style.display = items.length < limit ? 'none' : '';
    updateEmpty();
  }

  function updateEmpty() {
    const hasItems = tbody.children.length > 0;
    emptyMsg.style.display = hasItems ? 'none' : '';
    emptyBtn.style.display = hasItems ? '' : 'none';
  }

  tbody.addEventListener('click', async (e) => {
    const restoreId = e.target.closest('[data-restore]')?.dataset.restore;
    const deleteId = e.target.closest('[data-delete]')?.dataset.delete;

    if (restoreId) {
      try {
        await fetchJSON(`/api/trash/${restoreId}/restore`, { method: 'POST' });
        e.target.closest('tr').remove();
        toast('Wiederhergestellt');
        updateEmpty();
        updateTrashBadge();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    if (deleteId) {
      if (!confirm('Endgültig löschen? Dies kann nicht rückgängig gemacht werden.')) return;
      try {
        await fetchJSON(`/api/trash/${deleteId}`, { method: 'DELETE' });
        e.target.closest('tr').remove();
        toast('Endgültig gelöscht');
        updateEmpty();
        updateTrashBadge();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  emptyBtn.addEventListener('click', async () => {
    if (!confirm('Gesamten Papierkorb leeren? Alle Einträge werden endgültig gelöscht.')) return;
    try {
      await fetchJSON('/api/trash/empty', { method: 'POST' });
      tbody.innerHTML = '';
      toast('Papierkorb geleert');
      updateEmpty();
      updateTrashBadge();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  loadMoreBtn.addEventListener('click', loadItems);
  await loadItems();
})();
