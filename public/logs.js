(async function() {
  let offset = 0;
  const limit = 50;
  const tbody = document.getElementById('log-body');
  const loadMoreBtn = document.getElementById('log-load-more');

  async function loadLogs() {
    loadMoreBtn.disabled = true;
    try {
      const logs = await fetchJSON(`/api/logs?limit=${limit}&offset=${offset}`);
      for (const log of logs) {
        const tr = document.createElement('tr');
        const d = new Date(log.created_at + 'Z');
        const dateStr = d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        tr.innerHTML = `<td>${dateStr}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.company_name || '')}</td><td>${escapeHtml(log.department_name || '')}</td><td>${escapeHtml(log.entity_name || log.entity_type || '')}</td><td>${escapeHtml(log.details)}</td>`;
        tbody.appendChild(tr);
      }
      offset += logs.length;
      loadMoreBtn.style.display = logs.length < limit ? 'none' : '';
    } finally {
      loadMoreBtn.disabled = false;
    }
  }

  loadMoreBtn.addEventListener('click', loadLogs);
  await loadLogs();
})();
