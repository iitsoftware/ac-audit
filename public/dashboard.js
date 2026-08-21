/* ── Abteilungs-Dashboard ────────────────────────────────────
 *
 * Der Einstieg in die Arbeit einer Abteilung. Die Aufgabenbuttons stehen
 * server-gerendert im Template (views/dashboard.ejs) und brauchen kein Skript;
 * hier laufen die beiden Ladewege dahinter:
 *
 *   1. GET /api/departments/:id/dashboard  → Überschrift + die fünf Charts
 *   2. GET /api/departments/:id/cap-items  → die offenen Corrective Actions
 *
 * Die Abteilung kommt aus `#page-department-id` — dem Hidden-Field, das die
 * Route setzt (routes/pages.js) —, nicht aus einer Tab-Leiste und nicht aus
 * localStorage: die Ebene steht in der URL.
 *
 * KEIN neuer Endpunkt: die CAP-Tabelle fährt auf dem vorhandenen
 * `GET /api/departments/:departmentId/cap-items`. Mit Firma und Abteilung aus
 * der URL entfällt die sechsstufige Anreicherungskette des alten globalen
 * Dashboards ersatzlos — und mit ihr, ausdrücklich benannt statt verschwiegen,
 * auch die drei Spalten, die nur sie liefern konnte: Audit-Nr., Bewertung und
 * die Beschreibung des Prüfpunkts stehen am `audit_checklist_item` und nicht am
 * `cap_item`. Die Tabelle zeigt deshalb, was der Datensatz selbst trägt (Frist,
 * Quelle, Verantwortlicher, Behebungsmaßnahme, Status), und die Bewertungs-
 * Filter der alten Seite weichen den drei Fristentöpfen — denselben, die der
 * Donut darüber zeichnet, sodass Chart und Tabelle eine Aussage machen und
 * nicht zwei.
 */

(function () {
  'use strict';

  const deptId = (document.getElementById('page-department-id') || {}).value || '';

  const titleEl = document.getElementById('dash-title');
  const filterEl = document.getElementById('dash-cap-filters');
  const tableEl = document.getElementById('dash-cap-table');

  // ── Farben ────────────────────────────────────────────────
  // Benannt aus `window.CHART_COLORS` (public/charts.js) statt als Hex-Literal:
  // das Dashboard sagt "danger" für überfällig und muss nicht wissen, welches
  // Rot das Haus fährt. Der Rückfall auf ein leeres Objekt greift nur, wenn
  // charts.js nicht geladen ist — dann zeichnet ohnehin niemand.
  const C = window.CHART_COLORS || {};

  // Die Skala der Levels folgt der Dringlichkeit, nicht dem Alphabet: L1 hat
  // die kürzeste Frist (5 Tage) und ist rot, dann L2 (60), L3 (90), und die
  // Bemerkung ist neutral. Die gedruckten Pastelltöne aus `EVAL_COLORS`
  // (pdf/audit.js) sind Zellhintergründe eines Blattes und für einen Balken zu
  // blass — Papier und Bildschirm färben dieselbe Aussage verschieden.
  const LEVEL_COLORS = { O: C.info, L1: C.danger, L2: C.attention, L3: C.warn };

  // ── Fristentöpfe ──────────────────────────────────────────
  // Spiegelt `getDashboardCapDeadlines` (db.js) Zeile für Zeile: überfällig,
  // fällig in <= 30 Tagen, sonst offen (ohne Frist oder später). Drei sich
  // ausschließende Töpfe, die sich auf die Gesamtzahl summieren — der Donut
  // zeichnet die Zahlen des Servers, die Tabelle filtert nach derselben Regel,
  // also müssen beide dieselbe Grenze ziehen.
  const DEADLINE_BUCKETS = [
    { key: 'overdue', label: 'Überfällig',         color: C.danger },
    { key: 'dueSoon', label: 'Fällig in 30 Tagen', color: C.warn },
    { key: 'open',    label: 'Offen',              color: C.ok },
  ];

  function isoToday(offsetDays) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function bucketOf(cap) {
    const today = isoToday(0);
    const limit = isoToday(30);
    if (!cap.deadline) return 'open';
    if (cap.deadline < today) return 'overdue';
    if (cap.deadline <= limit) return 'dueSoon';
    return 'open';
  }

  // Offen ist wie überall aus `completion_date` abgeleitet und nicht aus
  // `status` — dieselbe Grenze, die capStatus() im Auditmodul zieht.
  function isOpen(cap) {
    return !cap.completion_date;
  }

  // ── Charts ────────────────────────────────────────────────
  // Arbeitsteilung wie bei public/risk-matrix.js: die KARTE stellt Rahmen und
  // Überschrift (`.dash-chart` / `.dash-chart-title` in public/style.css), das
  // Widget zeichnet seinen Körper mit den eigenen `.chart`-Klassen hinein.
  // Gezeichnet wird von public/charts.js über `createDonutChart` /
  // `createBarChart` / `createProgressBar` — Container zuerst, Optionen
  // dahinter; die Daten reisen als `opts.data`, den leeren Zustand ("Keine
  // Daten vorhanden") zeichnet der Helfer selbst.
  //
  // Die Überschrift steht deshalb HIER und nicht im Template: zwei der fünf
  // nennen die Jahreszahl, die erst mit der Antwort kommt. Und sie geht
  // ausdrücklich NICHT als `opts.title` mit — `createFrame()` (charts.js)
  // setzte daraus ein zweites `<h3 class="chart-title">` direkt darunter.
  //
  // Jede Karte einzeln gewacht: ein Helfer, der stolpert, darf die anderen vier
  // und die CAP-Tabelle darunter nicht mitnehmen. Die Karte behält dann ihre
  // Überschrift und sagt darunter, was fehlt, statt als leere Fläche dazustehen.
  function chart(draw, containerId, title, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;
    // <h4>: die Karte sitzt unter der <h3> ihres Abschnitts, die wiederum
    // unter der <h2> der Seite — dieselbe Staffelung wie die Modulgruppen
    // darüber, damit die Überschriftengliederung nicht flach wird.
    el.innerHTML = `<h4 class="dash-chart-title">${escapeHtml(title)}</h4>`;
    if (typeof draw !== 'function') return;
    try {
      draw(el, opts);
    } catch (err) {
      console.error(`${containerId} konnte nicht gezeichnet werden`, err);
      el.insertAdjacentHTML('beforeend',
        '<div class="chart"><div class="chart-body">' +
        '<div class="chart-empty">Diagramm nicht verfügbar</div></div></div>');
    }
  }

  function renderCharts(data) {
    // Findings nach Level — Balken, jede Kategorie steht in der Antwort (auch
    // mit 0), damit die Balken zwischen zwei Abteilungen nicht verrutschen.
    chart(window.createBarChart, 'chart-findings', 'Findings nach Level', {
      data: (data.findings.byLevel || []).map(l => ({
        label: levelLabel(l.level),
        value: l.count,
        color: LEVEL_COLORS[l.level],
      })),
    });

    // CAP-Fristen — Donut über die drei Töpfe, die sich auf die Gesamtzahl
    // summieren; die steht in der Mitte über ihrem Substantiv.
    chart(window.createDonutChart, 'chart-deadlines', 'CAP-Fristen', {
      centerLabel: 'offene CAPs',
      data: DEADLINE_BUCKETS.map(b => ({
        label: b.label,
        value: data.capDeadlines[b.key] || 0,
        color: b.color,
      })),
    });

    // Audits des laufenden Jahres — ein Fortschrittsbalken, weil "durchgeführt"
    // eine Teilmenge von "geplant" ist und keine zweite Kategorie daneben. Die
    // Jahreszahl steht in der Überschrift und nicht im Template: sie kommt aus
    // der Antwort und wechselt zum Jahreswechsel von selbst.
    chart(window.createProgressBar, 'chart-audits', `Audits ${data.audits.year}`, {
      caption: 'geplant vs. durchgeführt',
      valueLabel: `${data.audits.performed} von ${data.audits.planned} durchgeführt`,
      data: { value: data.audits.performed, max: data.audits.planned },
    });

    // Sicherheitsziele — Balken und ausdrücklich KEIN Donut: erfüllt/nicht
    // erfüllt und fällig überschneiden sich (ein Ziel kann positiv bewertet und
    // wieder fällig sein, siehe getDashboardSafetyObjectives in db.js). Ein
    // Donut behauptete Anteile eines Ganzen, die es hier nicht gibt.
    chart(window.createBarChart, 'chart-objectives', `Sicherheitsziele ${data.safetyObjectives.year}`, {
      data: [
        { label: 'Erfüllt',       value: data.safetyObjectives.fulfilled, color: C.ok },
        { label: 'Nicht erfüllt', value: data.safetyObjectives.missed,    color: C.danger },
        { label: 'Fällig',        value: data.safetyObjectives.due,       color: C.warn },
      ],
    });

    // Change Requests nach Status — welche Status es gibt, entscheiden die
    // Daten; die Route liefert sie in ihrer Reihenfolge. Ohne eigene Farbe
    // vergibt charts.js seine Palette der Reihe nach, was hier richtig ist:
    // welcher Status kommt, weiß dieses Modul nicht.
    chart(window.createBarChart, 'chart-changes', 'Change Requests nach Status', {
      data: (data.changeRequests.byStatus || []).map(s => ({
        label: s.status || 'Ohne Status',
        value: s.count,
      })),
    });
  }

  // Klartext nur in der Beschriftung, gespeichert bleibt der rohe Wert — das
  // Dashboard einer Abteilung zeigt beide Plantypen nebeneinander, und für ein
  // Behördenaudit heißt `O` "Bemerkung" (evalLabel() in public/companies.js).
  // Hier steht deshalb die neutrale, für beide lesbare Langform.
  function levelLabel(level) {
    switch (level) {
      case 'O': return 'Bemerkung';
      case 'L1': return 'Level 1';
      case 'L2': return 'Level 2';
      case 'L3': return 'Level 3';
      default: return level || '';
    }
  }

  // ── Offene Corrective Actions ─────────────────────────────
  const SOURCE_LABELS = { audit: 'AC-Audit', change: 'AC-Change', manual: 'Manuell' };

  let openCaps = [];
  let activeFilter = null;

  function renderFilterBar() {
    const counts = {};
    openCaps.forEach(c => {
      const b = bucketOf(c);
      counts[b] = (counts[b] || 0) + 1;
    });

    filterEl.innerHTML = DEADLINE_BUCKETS
      .filter(b => counts[b.key])
      .map(b => {
        const active = activeFilter === b.key ? ' active' : '';
        return `<button type="button" class="audit-filter-btn${active}" data-filter="${b.key}"` +
          ` aria-pressed="${activeFilter === b.key}">${escapeHtml(b.label)} (${counts[b.key]})</button>`;
      })
      .join('');
  }

  function renderTable() {
    const items = activeFilter ? openCaps.filter(c => bucketOf(c) === activeFilter) : openCaps;

    if (!items.length) {
      tableEl.innerHTML = '<p class="home-cap-empty">Keine offenen Corrective Actions</p>';
      return;
    }

    let html = `<div class="home-cap-table-wrap"><table class="home-cap-table">
      <thead><tr>
        <th>Frist</th>
        <th>Quelle</th>
        <th>Verantwortlicher</th>
        <th>Behebungsma&szlig;nahme</th>
        <th>Status</th>
      </tr></thead><tbody>`;

    for (const cap of items) {
      // Die Einfärbung der Fristenzelle liest denselben `bucketOf()` wie Filter
      // und Donut und zieht deshalb dieselbe 30-Tage-Grenze. Die abgelöste
      // Seite hatte hier ihre eigenen 14 Tage — auf einem Schirm, der die CAPs
      // in drei benannte Töpfe sortiert, wäre eine zweite, ungenannte Grenze
      // genau die Stelle, an der eine gelb markierte Zeile im Topf "Offen"
      // steht und niemand mehr weiß, welche Regel gilt.
      const bucket = bucketOf(cap);
      const overdue = bucket === 'overdue';
      const deadlineClass = overdue ? ' home-cap-deadline--overdue'
        : bucket === 'dueSoon' ? ' home-cap-deadline--soon' : '';
      const source = (cap.source || 'audit').toLowerCase();
      const badge = overdue
        ? '<span class="home-cap-badge home-cap-badge--overdue">Überfällig</span>'
        : '<span class="home-cap-badge home-cap-badge--open">Offen</span>';

      html += `<tr${overdue ? ' class="home-cap-row--overdue"' : ''}>
        <td class="home-cap-deadline${deadlineClass}">${escapeHtml(formatDateDE(cap.deadline) || '—')}</td>
        <td><span class="home-cap-badge home-cap-badge--module">${escapeHtml(SOURCE_LABELS[source] || source)}</span></td>
        <td>${escapeHtml(cap.responsible_person || '')}</td>
        <td class="home-cap-desc">${truncated(cap.corrective_action)}</td>
        <td>${badge}</td>
      </tr>`;
    }

    tableEl.innerHTML = html + '</tbody></table></div>';
  }

  // Wie auf der abgelösten Seite bei 80 Zeichen gekappt: die Spalte ist eine
  // Vorschau, der ganze Text steht auf dem Finding-Screen des Moduls.
  function truncated(text) {
    const value = text || '';
    return value.length > 80 ? escapeHtml(value.slice(0, 80)) + '&hellip;' : escapeHtml(value);
  }

  // Ein Listener an der Leiste statt einer je Knopf: sie wird nach jedem
  // Filterwechsel neu gezeichnet.
  filterEl.addEventListener('click', e => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    activeFilter = activeFilter === btn.dataset.filter ? null : btn.dataset.filter;
    renderFilterBar();
    renderTable();
  });

  // ── Laden ─────────────────────────────────────────────────
  // Die beiden Wege laufen unabhängig voneinander: ein Fehler in den
  // Kennzahlen darf die CAP-Tabelle nicht mitnehmen und umgekehrt.
  async function loadStats() {
    try {
      const data = await fetchJSON(`/api/departments/${deptId}/dashboard`);
      if (data.departmentName) titleEl.textContent = data.departmentName;
      renderCharts(data);
    } catch (err) {
      toast(err?.message || 'Kennzahlen konnten nicht geladen werden', 'error');
    }
  }

  async function loadCaps() {
    try {
      const all = await fetchJSON(`/api/departments/${deptId}/cap-items`);
      openCaps = all.filter(isOpen);
    } catch (err) {
      toast(err?.message || 'Corrective Actions konnten nicht geladen werden', 'error');
      openCaps = [];
    }
    renderFilterBar();
    renderTable();
  }

  // Ohne Abteilung gibt es nichts zu laden. Die Route liefert für eine
  // unbekannte ID bereits 404, hierher kommt der Fall also nur, wenn das
  // Hidden-Field fehlt — dann steht der Satz statt zweier Fehler-Toasts.
  if (!deptId) {
    tableEl.innerHTML = '<p class="home-cap-empty">Keine Abteilung im Kontext</p>';
    return;
  }

  loadStats();
  loadCaps();
})();
