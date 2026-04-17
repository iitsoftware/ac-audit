/* ── Settings Page ────────────────────────────────────────── */

(async function () {
  // Load current settings
  const settings = await fetchJSON('/api/settings').catch(() => ({}));

  // ── AC-Audit SMTP ──────────────────────────────────────
  document.getElementById('smtp-user').value = settings.smtp_user || '';
  document.getElementById('smtp-pass').value = settings.smtp_pass || '';
  document.getElementById('smtp-host').value = settings.smtp_host || '';
  document.getElementById('smtp-port').value = settings.smtp_port || '587';
  document.getElementById('smtp-auth').value = settings.smtp_auth || 'true';

  async function saveSmtpSettings() {
    const data = {
      smtp_user: document.getElementById('smtp-user').value.trim(),
      smtp_pass: document.getElementById('smtp-pass').value,
      smtp_host: document.getElementById('smtp-host').value.trim(),
      smtp_port: document.getElementById('smtp-port').value.trim(),
      smtp_auth: document.getElementById('smtp-auth').value,
    };
    try { await fetchJSON('/api/settings', { method: 'PUT', body: data }); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); }
  }

  document.querySelectorAll('#smtp-form input').forEach(el => el.addEventListener('blur', saveSmtpSettings));
  document.getElementById('smtp-auth').addEventListener('change', saveSmtpSettings);

  const testEmailInput = document.getElementById('test-email-to');
  const testEmailBtn = document.getElementById('test-email-send');
  testEmailInput.addEventListener('input', () => {
    testEmailBtn.disabled = !testEmailInput.value.trim() || !testEmailInput.validity.valid;
  });
  testEmailBtn.addEventListener('click', async () => {
    const to = testEmailInput.value.trim();
    if (!to || !testEmailInput.validity.valid) return;
    testEmailBtn.disabled = true;
    const origText = testEmailBtn.textContent;
    testEmailBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sende...';
    try {
      await fetchJSON('/api/settings/test-email', { method: 'POST', body: { to } });
      toast('Test-E-Mail gesendet');
    } catch (e) { toast(e?.message || 'Senden fehlgeschlagen', 'error'); }
    finally { testEmailBtn.disabled = false; testEmailBtn.textContent = origText; }
  });

  // ── AC-Change SMTP ─────────────────────────────────────
  document.getElementById('change-smtp-user').value = settings.change_smtp_user || '';
  document.getElementById('change-smtp-pass').value = settings.change_smtp_pass || '';
  document.getElementById('change-smtp-host').value = settings.change_smtp_host || '';
  document.getElementById('change-smtp-port').value = settings.change_smtp_port || '587';
  document.getElementById('change-smtp-auth').value = settings.change_smtp_auth || 'true';

  async function saveChangeSmtpSettings() {
    const data = {
      change_smtp_user: document.getElementById('change-smtp-user').value.trim(),
      change_smtp_pass: document.getElementById('change-smtp-pass').value,
      change_smtp_host: document.getElementById('change-smtp-host').value.trim(),
      change_smtp_port: document.getElementById('change-smtp-port').value.trim(),
      change_smtp_auth: document.getElementById('change-smtp-auth').value,
    };
    try { await fetchJSON('/api/settings', { method: 'PUT', body: data }); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); }
  }

  document.querySelectorAll('#change-smtp-form input').forEach(el => el.addEventListener('blur', saveChangeSmtpSettings));
  document.getElementById('change-smtp-auth').addEventListener('change', saveChangeSmtpSettings);

  const changeTestInput = document.getElementById('change-test-email-to');
  const changeTestBtn = document.getElementById('change-test-email-send');
  changeTestInput.addEventListener('input', () => {
    changeTestBtn.disabled = !changeTestInput.value.trim() || !changeTestInput.validity.valid;
  });
  changeTestBtn.addEventListener('click', async () => {
    const to = changeTestInput.value.trim();
    if (!to || !changeTestInput.validity.valid) return;
    changeTestBtn.disabled = true;
    const origText = changeTestBtn.textContent;
    changeTestBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sende...';
    try {
      await fetchJSON('/api/settings/test-email', { method: 'POST', body: { to, module: 'change' } });
      toast('Test-E-Mail gesendet');
    } catch (e) { toast(e?.message || 'Senden fehlgeschlagen', 'error'); }
    finally { changeTestBtn.disabled = false; changeTestBtn.textContent = origText; }
  });

  // ── Backup Settings ────────────────────────────────────
  document.getElementById('backup-path').value = settings.backup_path || '';
  document.getElementById('backup-time').value = settings.backup_time || '02:00';
  document.getElementById('backup-max').value = settings.backup_max || '10';

  const activeDays = (settings.backup_days || 'mo,tu,we,th,fr').split(',');
  document.querySelectorAll('.backup-day').forEach(cb => { cb.checked = activeDays.includes(cb.value); });

  async function saveBackupSettings() {
    const days = [...document.querySelectorAll('.backup-day:checked')].map(cb => cb.value).join(',');
    const data = {
      backup_path: document.getElementById('backup-path').value.trim(),
      backup_time: document.getElementById('backup-time').value,
      backup_max: document.getElementById('backup-max').value.trim(),
      backup_days: days,
    };
    try { await fetchJSON('/api/settings', { method: 'PUT', body: data }); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); }
  }

  document.querySelectorAll('#backup-form input').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', saveBackupSettings);
  });

  const backupNowBtn = document.getElementById('backup-now');
  backupNowBtn.addEventListener('click', async () => {
    backupNowBtn.disabled = true;
    const origText = backupNowBtn.textContent;
    backupNowBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sichere...';
    try {
      const result = await fetchJSON('/api/backup/now', { method: 'POST' });
      toast(`Backup erstellt: ${result.filename}`);
      loadBackupList();
    } catch (e) { toast(e?.message || 'Backup fehlgeschlagen', 'error'); }
    finally { backupNowBtn.disabled = false; backupNowBtn.textContent = origText; }
  });

  async function loadBackupList() {
    try {
      const files = await fetchJSON('/api/backup/list');
      const section = document.getElementById('backup-list-section');
      const list = document.getElementById('backup-list');
      if (files.length === 0) { section.style.display = 'none'; return; }
      section.style.display = '';
      list.innerHTML = files.map(f => {
        const size = (f.size / 1024 / 1024).toFixed(1);
        const date = new Date(f.created);
        const dateStr = date.toLocaleDateString('de-DE') + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        return `<div class="backup-item"><span class="backup-name">${f.filename}</span><span class="backup-meta">${size} MB &middot; ${dateStr}</span></div>`;
      }).join('');
    } catch (e) { toast('Backup-Liste konnte nicht geladen werden', 'error'); }
  }
  loadBackupList();

  // ── CAP Deadline Settings ──────────────────────────────
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
    try { await fetchJSON('/api/settings', { method: 'PUT', body: data }); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); }
  }

  document.querySelectorAll('#cap-deadline-form input').forEach(el => el.addEventListener('blur', saveCapDeadlineSettings));

  const capRecalcBtn = document.getElementById('cap-recalc');
  capRecalcBtn.addEventListener('click', async () => {
    capRecalcBtn.disabled = true;
    const origText = capRecalcBtn.textContent;
    capRecalcBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Berechne...';
    try {
      const result = await fetchJSON('/api/cap-items/recalc-deadlines', { method: 'POST' });
      toast(`${result.updated} von ${result.total} CAP-Fristen aktualisiert`);
    } catch (e) { toast(e?.message || 'Aktualisierung fehlgeschlagen', 'error'); }
    finally { capRecalcBtn.disabled = false; capRecalcBtn.textContent = origText; }
  });

  // ── Notification Settings ──────────────────────────────
  document.getElementById('notify-enabled').value = settings.notify_enabled || 'false';
  document.getElementById('notify-repeat').value = settings.notify_repeat || 'false';
  document.getElementById('notify-days-before').value = settings.notify_days_before || '7';
  document.getElementById('notify-time').value = settings.notify_time || '08:00';

  const notifyDays = (settings.notify_days || 'mo,tu,we,th,fr').split(',');
  document.querySelectorAll('.notify-day').forEach(cb => { cb.checked = notifyDays.includes(cb.value); });

  async function saveNotifySettings() {
    const days = [...document.querySelectorAll('.notify-day:checked')].map(cb => cb.value).join(',');
    const data = {
      notify_enabled: document.getElementById('notify-enabled').value,
      notify_repeat: document.getElementById('notify-repeat').value,
      notify_days_before: document.getElementById('notify-days-before').value.trim(),
      notify_time: document.getElementById('notify-time').value,
      notify_days: days,
    };
    try { await fetchJSON('/api/settings', { method: 'PUT', body: data }); }
    catch (e) { toast(e?.message || 'Vorgang fehlgeschlagen', 'error'); }
  }

  document.querySelectorAll('#notify-form input').forEach(el => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', saveNotifySettings);
  });
  document.querySelectorAll('#notify-form select').forEach(el => el.addEventListener('change', saveNotifySettings));

  const notifyTestEmail = document.getElementById('notify-test-email');
  const notifyTestBtn = document.getElementById('notify-test');
  notifyTestEmail.addEventListener('input', () => {
    notifyTestBtn.disabled = !notifyTestEmail.value.trim() || !notifyTestEmail.validity.valid;
  });
  notifyTestBtn.addEventListener('click', async () => {
    const to = notifyTestEmail.value.trim();
    if (!to || !notifyTestEmail.validity.valid) return;
    notifyTestBtn.disabled = true;
    const origText = notifyTestBtn.textContent;
    notifyTestBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Sende...';
    try {
      await fetchJSON('/api/settings/notify-test', { method: 'POST', body: { to } });
      toast('Test-Benachrichtigung gesendet');
    } catch (e) { toast(e?.message || 'Senden fehlgeschlagen', 'error'); }
    finally { notifyTestBtn.disabled = false; notifyTestBtn.textContent = origText; }
  });
})();
