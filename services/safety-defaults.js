const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('../db');

// Feste SRB-Tagesordnung nach CM-025. Bewusst als Code-Konstante statt Seed-Daten:
// eine frische Installation ist damit sofort korrekt, und "auf Standard zurücksetzen"
// heißt schlicht, das Feld in den Einstellungen zu leeren.
const DEFAULT_SRB_TOPICS = [
  '- Prüfung, ob die Sicherheitsrichtlinie noch wirksam ist',
  '- Ergebnisse aus Safety Audits und Compliance Audits',
  '- Prüfung, ob die Safety Culture gelebt und umgesetzt wird',
  '- Bewertung der Safety Performance gegenüber der Safety Policy und den Objectives / SPIs',
  '- Prüfung, ob jede Korrekturmaßnahme bzw. eingeleitete Maßnahme in der vorgegebenen Zeit umgesetzt wurde und ob Maßnahme und Prozess wirksam sind',
  '- Prüfung, ob jede Sicherheitsanweisung oder Maßnahme zur Verbesserung der Sicherheit in der geplanten Zeit und im vorgegebenen Umfang umgesetzt wurde, sowie Bewertung ihrer Wirksamkeit',
  '- Sicherstellung und Prüfung, ob alle Ressourcen bereitgestellt wurden, um die Safety Objectives zu erreichen bzw. umzusetzen',
].join('\n');

// Optionaler Override aus den Einstellungen (`sms_default_topics`).
// Leer oder nur Whitespace => Standard-Tagesordnung.
function getSrbDefaultTopics() {
  const row = stmts.getSetting.get('sms_default_topics');
  const value = row && row.value;
  if (!value || !value.trim()) return DEFAULT_SRB_TOPICS;
  return value;
}

// Sicherheitszielkatalog aus MOE Ausgabe 3 Rev. 2, S. 162–163. Wie DEFAULT_SRB_TOPICS
// eine Code-Konstante statt Seed-Daten — aber bewusst OHNE Settings-Override
// (kein `sms_default_objectives`): der Katalog wird von Jahr zu Jahr kopiert, der
// Vorjahreskatalog IST also der Override. Diese Liste seedet nur das allererste
// Sicherheitsjahr einer Abteilung; danach pflegt der Kunde seinen Katalog im Jahr.
// spt ist der gedruckte Zieltext, spt_direction/spt_value seine maschinenlesbare
// Hälfte (MAX = "höchstens", MIN = "mindestens") für den Rating-Vorschlag.
const DEFAULT_SAFETY_OBJECTIVES = [
  {
    title: 'Kompetenzbewertung',
    objective: 'Unser Ziel ist es, keine negativen Ergebnisse bei den Kompetenzbewertungen der Mitarbeiter zu erhalten',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 24,
  },
  {
    title: 'Instandhaltungsunterlagen',
    objective: 'Unser Ziel ist es, keine Nutzung alter Instandhaltungsunterlagen, d. h. nur die letzte gültige Rev.',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 12,
  },
  {
    title: 'Werkzeugkalibrierung',
    objective: 'Unser Ziel ist es, bei der Instandhaltung keine nicht kalibrierten Werkzeuge einzusetzen.',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 12,
  },
  {
    title: 'Freigabebescheinigung',
    objective: 'Unser Ziel ist es, kein Einbau von Komponenten ohne gültige Freigabebescheinigung',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 12,
  },
  {
    title: 'Level 1 Findings Audit',
    objective: 'Unser Ziel ist es, kein Level 1 Finding für jedes interne oder externe Audit',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 12,
  },
  {
    title: 'Level 2 Findings Audit',
    objective: 'Unser Ziel ist es, max. 5 Level 2 Findings für jedes interne oder externe Audit',
    spt: 'max. 5 Stck.', spt_direction: 'MAX', spt_value: 5, interval_months: 12,
  },
  {
    title: 'Level 1 Findings Produktaudit',
    objective: 'Unser Ziel ist es, kein Level 1 Finding bei Produktaudits intern oder extern',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 12,
  },
  {
    title: 'Level 2 Findings Produktaudit',
    objective: 'Unser Ziel ist es, max. 10 Level 2 Findings als Ergebnis beim Produktaudit intern oder extern',
    spt: 'Max. 10 Stck.', spt_direction: 'MAX', spt_value: 10, interval_months: 12,
  },
  {
    // Widerspruch IM MOE SELBST: der Zieltext sagt "max. 5 Meldungen", der SPT
    // "Mindestens 5 Stck.". Beides steht hier wortgetreu so, wie es im Handbuch
    // gedruckt ist; die Auflösung ist eine fachliche Kundenentscheidung und wird
    // nicht in der Implementierung vorweggenommen. spt_direction folgt dem SPT,
    // weil aus ihm der Rating-Vorschlag abgeleitet wird.
    title: 'SMS Meldungen',
    objective: 'Unser Ziel ist es, max. 5 Meldungen durch das innerbetriebliche Meldesystem',
    spt: 'Mindestens 5 Stck.', spt_direction: 'MIN', spt_value: 5, interval_months: 12,
  },
  {
    title: 'Gefahrenliste',
    objective: 'Unser Ziel ist es, mind. 20 ermittelte Gefahren',
    spt: 'Mindestens 20 Stck.', spt_direction: 'MIN', spt_value: 20, interval_months: 12,
  },
  {
    title: 'Schulungsüberziehungen',
    objective: 'Unser Ziel ist es, keine Überziehungen von Schulungen für Instandhaltungspersonal und Managementpersonal (alle Mitarbeiter im Part-145 Betrieb)',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 24,
  },
  {
    title: 'FOD',
    objective: 'Unser Ziel ist es, kein FOD in den Luftfahrzeugen nach Abschluss der Instandhaltungsarbeiten',
    spt: 'Keine (0) Stck.', spt_direction: 'MAX', spt_value: 0, interval_months: 12,
  },
];

// Füllt den Katalog eines Sicherheitsjahres — aus dem letzten Jahr derselben
// Abteilung, das einen Katalog hat ('previous'), oder aus DEFAULT_SAFETY_OBJECTIVES
// ('default'). Ohne `source`: Vorjahr wenn vorhanden, sonst Default.
// Idempotent — ein bereits gefüllter Katalog ist ein No-op, der Aufruf kann also
// gefahrlos wiederholt werden (Doppelklick, Retry, Bootstrap beim Jahresanlegen).
// Kopiert werden nur Katalogfelder, nie Bewertungen; das Zieljahr startet leer.
// Gibt { created, source } zurück, damit die Route eine sinnvolle Toast-Meldung
// bauen kann; source ist null, wenn nichts angelegt wurde.
const seedObjectivesForYear = db.transaction((yearId, source) => {
  const year = stmts.getSafetyYear.get(yearId);
  if (!year) return { created: 0, source: null };
  if (stmts.getSafetyObjectivesByYearRaw.all(yearId).length) return { created: 0, source: null };

  const prevYear = source === 'default'
    ? null
    : stmts.getPrevSafetyYearWithObjectives.get(year.department_id, year.year);

  if (prevYear) {
    const objectives = stmts.getSafetyObjectivesByYearRaw.all(prevYear.id);
    for (const o of objectives) {
      stmts.createSafetyObjective.run(
        uuidv4(), yearId, year.department_id, o.sort_order || 0,
        o.title || '', o.objective || '', o.spt || '', o.spt_direction || '',
        o.spt_value === undefined ? null : o.spt_value,
        o.spi_description || '', o.interval_months || 12, o.active === 0 ? 0 : 1
      );
    }
    return { created: objectives.length, source: 'previous' };
  }

  // Ausdrückliches 'previous' ohne Vorjahreskatalog fällt NICHT auf den Default
  // zurück — der Aufrufer hat eine bestimmte Quelle verlangt und soll die
  // Fehlanzeige melden können, statt still einen fremden Katalog zu bekommen.
  if (source === 'previous') return { created: 0, source: null };

  DEFAULT_SAFETY_OBJECTIVES.forEach((o, index) => {
    stmts.createSafetyObjective.run(
      uuidv4(), yearId, year.department_id, index,
      o.title, o.objective, o.spt, o.spt_direction, o.spt_value,
      '', o.interval_months, 1
    );
  });
  return { created: DEFAULT_SAFETY_OBJECTIVES.length, source: 'default' };
});

module.exports = { DEFAULT_SRB_TOPICS, getSrbDefaultTopics, DEFAULT_SAFETY_OBJECTIVES, seedObjectivesForYear };
