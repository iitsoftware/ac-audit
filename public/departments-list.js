/* ── Abteilungskachelseite ───────────────────────────────────
 *
 * Die zweite Ebene der organisationsgeführten Navigation: eine Kachel je
 * Abteilung der Firma aus dem Hidden-Field, ein Klick darauf führt nach
 * `/departments/:id` aufs Dashboard. Die beiden Symbole auf der Kachel öffnen
 * die bestehenden Dialoge des Partials views/partials/dept-dialog.ejs über den
 * Controller aus public/org-dialogs.js — hier entsteht kein zweiter Dialog.
 *
 * Aufbau, Klassenvokabular und die Begründungen dazu sind die der
 * Firmenkachelseite (public/companies-list.js): die Kachel navigiert als <a>
 * und nicht als klickbares <div>, die zwei Aktionssymbole sind ihre Geschwister
 * und keine Kinder, und gestylt wird `.org-tile*` / `.org-tile-grid` zentral in
 * der Stylesheet-Task. Zwei Kachelseiten, ein Vokabular — wer hier eine Klasse
 * einführt, führt sie dort mit ein.
 *
 * Die Reihenfolge ist die des Servers: `GET /api/companies/:companyId/departments`
 * sortiert `ORDER BY sort_order, name`, hier wird nichts nachsortiert. Die
 * vorhandene `PATCH …/departments/reorder` bleibt damit unangetastet nutzbar —
 * eine Umsortier-Oberfläche hatte die abgelöste /organization-Seite nicht, und
 * diese Seite bekommt keine dazu.
 */

(function () {
  'use strict';

  // Die Firma ist der Bezug der ganzen Seite. Sie kommt aus dem Hidden-Field,
  // das die Route setzt (views/departments-list.ejs) — ohne sie gäbe es weder
  // eine Liste zu laden noch einen Dialog zu öffnen, deshalb bricht
  // initDeptDialogs() hier bewusst hart ab statt später leer nachzuladen.
  const companyId = document.getElementById('page-company-id').value;

  const gridEl = document.getElementById('department-tiles');
  const emptyEl = document.getElementById('departments-empty');
  const addBtn = document.getElementById('btn-add-dept');

  let departments = [];
  // `null` heißt "nicht ermittelt" und nicht "keine Personen": eine
  // fehlgeschlagene Abfrage darf keinen Warnbadge behaupten (siehe load() und
  // warningsFor()).
  let persons = null;

  const dialogs = initDeptDialogs(companyId, { onChange: load });

  // ── Vollständigkeit ───────────────────────────────────────
  // Die Prüfung, die vorher in der Abteilungskachel der /organization-Seite
  // stand (getDeptMissing()) — QM/CMM und Abteilungsleiter, jeweils Person und
  // Unterschrift. Der Behördenkontakt, den sie zusätzlich meldete, bleibt außen
  // vor: er ist eine Angabe des Abteilungsdialogs und keine Person, deren
  // fehlende Unterschrift ein Dokument ungezeichnet lässt.
  //
  // Je Rolle EIN Satz statt zweier: fehlt die Person, fehlt ihre Unterschrift
  // zwangsläufig mit, und beides nebeneinander zu melden wäre derselbe Mangel
  // zweimal — dieselbe Zusammenfassung, die die Firmenkachel für ihren
  // Accountable Manager fährt.
  //
  // Die Bezeichnung des Abteilungsleiters kommt aus departmentLeaderLabel()
  // (public/org-dialogs.js), also aus derselben Quelle wie das Feld im Dialog
  // und wie departmentLeaderLabel() in pdf/common.js — der Badge nennt die
  // Rolle so, wie das Dokument sie druckt.
  //
  // `<Rolle> ohne Unterschrift` und nicht der Genitiv der Firmenkachel
  // (`Unterschrift des Accountable Managers fehlt`): dort ist die Rolle ein
  // fester deutscher Begriff, hier ist sie abgeleitet und kann englisch sein —
  // "des Head of Trainings" wäre die Beugung, die dabei herauskäme. Die Form
  // ohne Genitiv trägt jede der fünf Bezeichnungen unverändert.
  function roleWarning(person, label) {
    if (!person || (!person.first_name && !person.last_name)) return `${label} fehlt`;
    if (!person.has_signature) return `${label} ohne Unterschrift`;
    return '';
  }

  function warningsFor(dept) {
    if (!persons) return [];
    const find = role => persons.find(p => p.role === role && p.department_id === dept.id);
    return [
      roleWarning(find('QM'), 'Compliance Monitoring Manager'),
      roleWarning(find('ABTEILUNGSLEITER'), departmentLeaderLabel(dept)),
    ].filter(Boolean);
  }

  // ── Laden ─────────────────────────────────────────────────
  async function load() {
    try {
      departments = await fetchJSON(`/api/companies/${companyId}/departments`);
    } catch (err) {
      toast(err?.message || 'Vorgang fehlgeschlagen', 'error');
      departments = [];
    }

    // Eine einzige Personenabfrage für alle Kacheln: `GET /api/companies/:id/persons`
    // liefert die Personen der ganzen Firma samt `department_id`, die Zuordnung
    // ist also ein Filter und keine Abfrage je Abteilung — anders als auf der
    // Firmenkachelseite, wo je Firma eine eigene Abfrage nötig ist. Eine
    // gescheiterte Abfrage bleibt `null`: unbekannt ist nicht dasselbe wie
    // fehlend.
    persons = null;
    try {
      persons = await fetchJSON(`/api/companies/${companyId}/persons`);
    } catch { /* kein Badge statt eines falschen Badges */ }

    render();
  }

  // ── Rendern ───────────────────────────────────────────────
  const ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DELETE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

  function tileHtml(dept) {
    const name = escapeHtml(dept.name);
    const nameAttr = escapeAttr(dept.name);
    const warnings = warningsFor(dept);

    // EASA-Genehmigungsnummer und Regulation in einer Zeile, getrennt durch
    // einen Punkt — die Unterzeile der abgelösten `.org-dept-tile`, die genau
    // diese beiden Angaben trug.
    const meta = [dept.easa_permission_number, dept.regulation].filter(Boolean).join(' • ');

    let html = `<div class="org-tile${warnings.length ? ' org-tile--warn' : ''}" data-id="${dept.id}">`;
    html += `<a class="org-tile-link" href="/departments/${dept.id}">`;
    html += `<div class="org-tile-name">${name}</div>`;
    if (meta) html += `<div class="org-tile-meta">${escapeHtml(meta)}</div>`;
    html += '</a>';
    if (warnings.length) {
      const text = warnings.join(', ');
      html += `<div class="org-tile-warn" title="${escapeAttr(text)}">&#9888; ${escapeHtml(text)}</div>`;
    }
    html += '<div class="org-tile-actions">';
    html += `<button type="button" class="btn-icon" data-action="edit" title="Abteilung bearbeiten" aria-label="${nameAttr} bearbeiten">${ICON_EDIT}</button>`;
    html += `<button type="button" class="btn-icon btn-icon-danger" data-action="delete" title="Abteilung löschen" aria-label="${nameAttr} löschen">${ICON_DELETE}</button>`;
    html += '</div></div>';
    return html;
  }

  function render() {
    gridEl.innerHTML = departments.map(tileHtml).join('');
    gridEl.style.display = departments.length ? '' : 'none';
    emptyEl.style.display = departments.length ? 'none' : '';
  }

  // Ein Listener am Gitter statt einer je Kachel: die Kacheln werden nach jedem
  // Speichern und Löschen neu gezeichnet.
  gridEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const dept = departments.find(d => d.id === btn.closest('.org-tile').dataset.id);
    if (!dept) return;
    if (btn.dataset.action === 'edit') dialogs.openDialog(dept);
    else dialogs.confirmDelete(dept);
  });

  addBtn.addEventListener('click', () => dialogs.openDialog(null));

  load();
})();
