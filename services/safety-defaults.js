const { stmts } = require('../db');

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

module.exports = { DEFAULT_SRB_TOPICS, getSrbDefaultTopics };
