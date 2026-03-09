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
})();
