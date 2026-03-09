/* ── Settings Page ────────────────────────────────────────── */

(async function () {
  // Load current settings
  try {
    const settings = await fetchJSON('/api/settings');
    document.getElementById('smtp-user').value = settings.smtp_user || '';
    document.getElementById('smtp-pass').value = settings.smtp_pass || '';
    document.getElementById('smtp-host').value = settings.smtp_host || '';
    document.getElementById('smtp-port').value = settings.smtp_port || '587';
    document.getElementById('smtp-auth').value = settings.smtp_auth || 'true';
  } catch (e) {
    toast('Einstellungen konnten nicht geladen werden', 'error');
  }

  // Auto-save SMTP settings on blur/change
  async function saveSmtpSettings() {
    const data = {
      smtp_user: document.getElementById('smtp-user').value.trim(),
      smtp_pass: document.getElementById('smtp-pass').value,
      smtp_host: document.getElementById('smtp-host').value.trim(),
      smtp_port: document.getElementById('smtp-port').value.trim(),
      smtp_auth: document.getElementById('smtp-auth').value,
    };
    try {
      await fetchJSON('/api/settings', { method: 'PUT', body: data });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  document.querySelectorAll('#smtp-form input').forEach(el => {
    el.addEventListener('blur', saveSmtpSettings);
  });
  document.getElementById('smtp-auth').addEventListener('change', saveSmtpSettings);

  // Enable/disable test button based on email validity
  const testEmailInput = document.getElementById('test-email-to');
  const testEmailBtn = document.getElementById('test-email-send');
  testEmailInput.addEventListener('input', () => {
    testEmailBtn.disabled = !testEmailInput.value.trim() || !testEmailInput.validity.valid;
  });

  // Send test email
  testEmailBtn.addEventListener('click', async () => {
    const to = testEmailInput.value.trim();
    if (!to || !testEmailInput.validity.valid) return;
    try {
      await fetchJSON('/api/settings/test-email', { method: 'POST', body: { to } });
      toast('Test-E-Mail gesendet');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  // ── Backup Settings ──────────────────────────────────────
  const settings = await fetchJSON('/api/settings').catch(() => ({}));

  document.getElementById('backup-path').value = settings.backup_path || '';
  document.getElementById('backup-time').value = settings.backup_time || '02:00';
  document.getElementById('backup-max').value = settings.backup_max || '10';

  const activeDays = (settings.backup_days || 'mo,tu,we,th,fr').split(',');
  document.querySelectorAll('.backup-day').forEach(cb => {
    cb.checked = activeDays.includes(cb.value);
  });

  async function saveBackupSettings() {
    const days = [...document.querySelectorAll('.backup-day:checked')].map(cb => cb.value).join(',');
    const data = {
      backup_path: document.getElementById('backup-path').value.trim(),
      backup_time: document.getElementById('backup-time').value,
      backup_max: document.getElementById('backup-max').value.trim(),
      backup_days: days,
    };
    try {
      await fetchJSON('/api/settings', { method: 'PUT', body: data });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  document.querySelectorAll('#backup-form input').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', saveBackupSettings);
  });

  // Backup now
  document.getElementById('backup-now').addEventListener('click', async () => {
    try {
      const result = await fetchJSON('/api/backup/now', { method: 'POST' });
      toast(`Backup erstellt: ${result.filename}`);
      loadBackupList();
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // Load backup list
  async function loadBackupList() {
    try {
      const files = await fetchJSON('/api/backup/list');
      const section = document.getElementById('backup-list-section');
      const list = document.getElementById('backup-list');
      if (files.length === 0) {
        section.style.display = 'none';
        return;
      }
      section.style.display = '';
      list.innerHTML = files.map(f => {
        const size = (f.size / 1024 / 1024).toFixed(1);
        const date = new Date(f.created);
        const dateStr = date.toLocaleDateString('de-DE') + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return `<div class="backup-item"><span class="backup-name">${f.filename}</span><span class="backup-meta">${size} MB &middot; ${dateStr}</span></div>`;
      }).join('');
    } catch { /* ignore */ }
  }

  loadBackupList();

  // ── CAP Deadline Settings ─────────────────────────────────
  document.getElementById('cap-deadline-O').value = settings.cap_deadline_O || '180';
  document.getElementById('cap-deadline-L1').value = settings.cap_deadline_L1 || '5';
  document.getElementById('cap-deadline-L2').value = settings.cap_deadline_L2 || '60';
  document.getElementById('cap-deadline-L3').value = settings.cap_deadline_L3 || '90';

  async function saveCapDeadlineSettings() {
    const data = {
      cap_deadline_O: document.getElementById('cap-deadline-O').value.trim(),
      cap_deadline_L1: document.getElementById('cap-deadline-L1').value.trim(),
      cap_deadline_L2: document.getElementById('cap-deadline-L2').value.trim(),
      cap_deadline_L3: document.getElementById('cap-deadline-L3').value.trim(),
    };
    try {
      await fetchJSON('/api/settings', { method: 'PUT', body: data });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  document.querySelectorAll('#cap-deadline-form input').forEach(el => {
    el.addEventListener('blur', saveCapDeadlineSettings);
  });

  // Recalculate all CAP deadlines
  document.getElementById('cap-recalc').addEventListener('click', async () => {
    try {
      const result = await fetchJSON('/api/cap-items/recalc-deadlines', { method: 'POST' });
      toast(`${result.updated} von ${result.total} CAP-Fristen aktualisiert`);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // ── Notification Settings ──────────────────────────────────
  document.getElementById('notify-enabled').value = settings.notify_enabled || 'false';
  document.getElementById('notify-repeat').value = settings.notify_repeat || 'false';
  document.getElementById('notify-days-before').value = settings.notify_days_before || '7';
  document.getElementById('notify-time').value = settings.notify_time || '08:00';

  const notifyDays = (settings.notify_days || 'mo,tu,we,th,fr').split(',');
  document.querySelectorAll('.notify-day').forEach(cb => {
    cb.checked = notifyDays.includes(cb.value);
  });

  async function saveNotifySettings() {
    const days = [...document.querySelectorAll('.notify-day:checked')].map(cb => cb.value).join(',');
    const data = {
      notify_enabled: document.getElementById('notify-enabled').value,
      notify_repeat: document.getElementById('notify-repeat').value,
      notify_days_before: document.getElementById('notify-days-before').value.trim(),
      notify_time: document.getElementById('notify-time').value,
      notify_days: days,
    };
    try {
      await fetchJSON('/api/settings', { method: 'PUT', body: data });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  document.querySelectorAll('#notify-form input').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', saveNotifySettings);
  });
  document.querySelectorAll('#notify-form select').forEach(el => {
    el.addEventListener('change', saveNotifySettings);
  });

  // Test notification
  const notifyTestEmail = document.getElementById('notify-test-email');
  const notifyTestBtn = document.getElementById('notify-test');

  notifyTestEmail.addEventListener('input', () => {
    notifyTestBtn.disabled = !notifyTestEmail.value.trim() || !notifyTestEmail.validity.valid;
  });

  notifyTestBtn.addEventListener('click', async () => {
    const to = notifyTestEmail.value.trim();
    if (!to || !notifyTestEmail.validity.valid) return;
    try {
      await fetchJSON('/api/settings/notify-test', { method: 'POST', body: { to } });
      toast('Test-Benachrichtigung gesendet');
    } catch (e) {
      toast(e.message, 'error');
    }
  });
})();
