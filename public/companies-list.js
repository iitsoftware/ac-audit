/* ── Firmenkachelseite ──────────────────────────────────────
 *
 * Der Einstieg der organisationsgeführten Navigation: eine Kachel je Firma,
 * ein Klick darauf führt nach `/companies/:id` (Abteilungen). Die beiden
 * Symbole auf der Kachel öffnen die bestehenden Dialoge des Partials
 * views/partials/company-dialog.ejs über den Controller aus
 * public/org-dialogs.js — hier entsteht kein zweiter Dialog.
 *
 * Die Kachel navigiert als <a> und nicht als klickbares <div>: das Ziel ist
 * eine echte URL, also gehören Tastaturbedienung, Statuszeile und "in neuem
 * Tab öffnen" dazu, und ein <button> darf nicht in einem <a> stecken — die
 * beiden Aktionssymbole sind deshalb Geschwister der Kachelfläche und keine
 * Kinder von ihr.
 *
 * Klassennamen: `.org-tile` / `-link` / `-name` / `-meta` / `-warn` / `-actions`
 * plus `.org-tile--warn` und das Gitter `.org-tile-grid` — das gemeinsame
 * Vokabular der Firmen- und der Abteilungskachel im Idiom der vorhandenen
 * `.org-dept-tile*` (public/style.css). Gestylt wird es zentral in der
 * Stylesheet-Task, nicht hier; bis dahin steht die Kachel unformatiert, trägt
 * aber schon jede Angabe. Vorhandene Klassen werden dabei wiederverwendet
 * statt gedoppelt: `.btn-icon` für die zwei Aktionen und `.company-logo` für
 * das Bild (siehe tileHtml).
 */

(function () {
  'use strict';

  const gridEl = document.getElementById('company-tiles');
  const emptyEl = document.getElementById('companies-empty');
  const addBtn = document.getElementById('btn-add-company');

  let companies = [];
  // Ein *fehlender* Schlüssel heißt "nicht ermittelt" und nicht "keine
  // Personen": eine fehlgeschlagene Abfrage darf keinen Warnbadge behaupten
  // (siehe load() und warningFor()).
  const personsByCompany = new Map();

  const dialogs = initCompanyDialogs({ onChange: load });

  // ── Vollständigkeit ───────────────────────────────────────
  // Die Prüfung, die vorher in der Detailansicht der /organization-Seite stand
  // und dort nur die fehlende Unterschrift eines *vorhandenen* Accountable
  // Managers anmerkte — ohne Personenübersicht muss sie auch den ganz
  // fehlenden Manager melden, sonst sagt die Oberfläche zu einer Firma ohne
  // Accountable Manager gar nichts mehr.
  //
  // Ein Satz statt einer Liste: fehlt die Person, fehlt ihre Unterschrift
  // zwangsläufig mit, und beides nebeneinander zu melden wäre derselbe Mangel
  // zweimal. Der zurückgegebene String ist zugleich Text und Tooltip des Badges.
  function warningFor(companyId) {
    const persons = personsByCompany.get(companyId);
    if (!persons) return '';
    const acc = persons.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);
    if (!acc || (!acc.first_name && !acc.last_name)) return 'Accountable Manager fehlt';
    if (!acc.has_signature) return 'Unterschrift des Accountable Managers fehlt';
    return '';
  }

  // ── Laden ─────────────────────────────────────────────────
  async function load() {
    try {
      companies = await fetchJSON('/api/companies');
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
      companies = [];
    }

    // Der Warnbadge braucht die Personen, und `GET /api/companies` führt sie
    // nicht mit. Eine Abfrage je Firma ist hier vertretbar — die Liste ist die
    // der betreuten Organisationen, keine Datenmenge, die wächst — und sie
    // laufen parallel statt nacheinander. Eine gescheiterte Abfrage bleibt
    // ungesetzt: unbekannt ist nicht dasselbe wie fehlend.
    personsByCompany.clear();
    await Promise.all(companies.map(async c => {
      try {
        personsByCompany.set(c.id, await fetchJSON(`/api/companies/${c.id}/persons`));
      } catch { /* kein Badge statt eines falschen Badges */ }
    }));

    render();
  }

  // ── Rendern ───────────────────────────────────────────────
  const ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DELETE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

  function tileHtml(company) {
    const name = escapeHtml(company.name);
    const nameAttr = escapeAttr(company.name);
    const warning = warningFor(company.id);

    // `.company-logo` / `.company-logo-placeholder` sind die vorhandenen Klassen
    // (public/style.css) — 80×80, `object-fit: contain`, gestrichelter
    // Platzhalter. Sie gehörten dem Kopf der Detailansicht, die mit der
    // /organization-Seite entfallen ist, und beschreiben genau dieses Bild:
    // eine eigene Kachelklasse daneben wäre eine zweite Fassung derselben Sache.
    //
    // `?t=` wie überall, wo ein BLOB nach dem Speichern neu gezeichnet wird:
    // die URL des Logos ändert sich beim Austausch nicht.
    const logo = company.has_logo
      ? `<img src="/api/companies/${company.id}/logo?t=${Date.now()}" class="company-logo" alt="${nameAttr} Logo">`
      : '<div class="company-logo-placeholder" aria-hidden="true">&#127970;</div>';

    const addr = [company.street, [company.postal_code, company.city].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');

    let html = `<div class="org-tile${warning ? ' org-tile--warn' : ''}" data-id="${company.id}">`;
    html += `<a class="org-tile-link" href="/companies/${company.id}">`;
    html += logo;
    html += `<div class="org-tile-name">${name}</div>`;
    if (addr) html += `<div class="org-tile-meta">${escapeHtml(addr)}</div>`;
    html += '</a>';
    if (warning) {
      html += `<div class="org-tile-warn" title="${escapeAttr(warning)}">&#9888; ${escapeHtml(warning)}</div>`;
    }
    html += '<div class="org-tile-actions">';
    html += `<button type="button" class="btn-icon" data-action="edit" title="Firma bearbeiten" aria-label="${nameAttr} bearbeiten">${ICON_EDIT}</button>`;
    html += `<button type="button" class="btn-icon btn-icon-danger" data-action="delete" title="Firma löschen" aria-label="${nameAttr} löschen">${ICON_DELETE}</button>`;
    html += '</div></div>';
    return html;
  }

  function render() {
    gridEl.innerHTML = companies.map(tileHtml).join('');
    gridEl.style.display = companies.length ? '' : 'none';
    emptyEl.style.display = companies.length ? 'none' : '';
  }

  // Ein Listener am Gitter statt einer je Kachel: die Kacheln werden nach
  // jedem Speichern und Löschen neu gezeichnet.
  gridEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const company = companies.find(c => c.id === btn.closest('.org-tile').dataset.id);
    if (!company) return;
    if (btn.dataset.action === 'edit') dialogs.openDialog(company);
    else dialogs.confirmDelete(company);
  });

  addBtn.addEventListener('click', () => dialogs.openDialog(null));

  load();
})();
