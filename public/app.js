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

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ── Nav toggle buttons (on/off state) ────────────────────
const togglePages = new Set(Array.from(document.querySelectorAll('[data-toggle-page]')).map(b => b.getAttribute('data-toggle-page')));
// Save current path as "return to" if it's not a toggle page itself
if (!togglePages.has(window.location.pathname)) {
  localStorage.setItem('nav_return_path', window.location.pathname + window.location.hash);
}
document.querySelectorAll('[data-toggle-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-toggle-page');
    if (btn.classList.contains('active')) {
      const returnPath = localStorage.getItem('nav_return_path') || '/home';
      window.location.href = returnPath;
    } else {
      window.location.href = target;
    }
  });
});

// Trash badge count
async function updateTrashBadge() {
  try {
    const data = await fetchJSON('/api/trash/count');
    const badge = document.getElementById('trash-badge');
    if (badge) {
      if (data.count > 0) {
        badge.textContent = data.count;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) { console.warn('Trash badge update failed:', e); }
}
updateTrashBadge();

// Parse German date string (dd.mm.yyyy) to ISO (yyyy-mm-dd)
// Returns null for empty, undefined for invalid, ISO string for valid
function parseDateDE(val) {
  if (!val || !val.trim()) return null;
  const m = val.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Generic nav state persistence (localStorage)
function saveNavState(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); }
  catch { /* quota exceeded or private mode */ }
}

function loadNavState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// Render company tabs into a container element
// companies: array, selectedId: string, container: element, onSelect: callback(id)
function renderCompanyTabs(companies, selectedId, container, onSelect) {
  let html = '';
  companies.forEach(c => {
    const active = c.id === selectedId ? ' tab-active' : '';
    html += `<button class="tab${active}" data-id="${c.id}">${escapeHtml(c.name)}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => onSelect(btn.dataset.id));
  });
}

// Render department tabs into a container element
// departments: array, activeDeptId: string|null, container: element, onSelect: callback(id)
function renderDeptTabs(departments, activeDeptId, container, onSelect) {
  let html = '';
  departments.forEach(d => {
    const active = d.id === activeDeptId ? ' tab-active' : '';
    html += `<button class="tab tab-secondary${active}" data-id="${d.id}">${escapeHtml(d.name)}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => onSelect(btn.dataset.id));
  });
}

// Toast notifications
(function () {
  let container;
  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  window.toast = function (message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    el.appendChild(msgSpan);

    if (type === 'error') {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close';
      closeBtn.setAttribute('aria-label', 'Schließen');
      closeBtn.textContent = '\u00D7';
      closeBtn.addEventListener('click', () => el.remove());
      el.appendChild(closeBtn);
    } else {
      setTimeout(() => { el.remove(); }, 3000);
    }

    getContainer().appendChild(el);
  };
})();
