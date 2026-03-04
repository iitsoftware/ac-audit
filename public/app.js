/* ── Shared Utilities ──────────────────────────────────── */

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Format ISO date string to dd.mm.yyyy with zero-padding
function formatDateDE(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// Date auto-format: TT.MM.JJJJ
// Automatically inserts dots after day and month while typing
function initDateAutoFormat(input) {
  input.addEventListener('input', function () {
    // Strip everything except digits and dots
    let raw = this.value.replace(/[^\d.]/g, '');
    // Remove all dots to work with pure digits
    let digits = raw.replace(/\./g, '');
    // Limit to 8 digits (ddmmyyyy)
    digits = digits.slice(0, 8);
    // Build formatted string
    let formatted = '';
    for (let i = 0; i < digits.length; i++) {
      if (i === 2 || i === 4) formatted += '.';
      formatted += digits[i];
    }
    // Only update if changed (preserve cursor position)
    if (this.value !== formatted) {
      const cursorWasAtEnd = this.selectionStart === this.value.length;
      this.value = formatted;
      if (cursorWasAtEnd) {
        this.selectionStart = this.selectionEnd = formatted.length;
      }
    }
  });
  // Select all on focus for easy overwrite
  input.addEventListener('focus', function () {
    if (this.value) this.select();
  });
}

// Toast notifications
(function () {
  let container;
  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  window.toast = function (message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    getContainer().appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
  };
})();
