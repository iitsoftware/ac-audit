const fs = require('fs');
const path = require('path');
const { db, stmts, dataDir } = require('../db');

const defaultBackupPath = process.env.BACKUP_PATH || path.join(dataDir, 'backups');

function getBackupSettings() {
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    path: process.env.BACKUP_PATH || s.backup_path || defaultBackupPath,
    time: s.backup_time || '02:00',
    days: s.backup_days || 'mo,tu,we,th,fr',
    maxBackups: parseInt(s.backup_max) || 10,
  };
}

async function performBackup() {
  const cfg = getBackupSettings();
  if (!cfg.path) return { error: 'Kein Backup-Pfad konfiguriert' };

  const backupDir = cfg.path;
  if (!fs.existsSync(backupDir)) {
    try { fs.mkdirSync(backupDir, { recursive: true }); }
    catch (e) { return { error: `Verzeichnis konnte nicht erstellt werden: ${e.message}` }; }
  }

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `acaudit_${ts}.db`;
  const dest = path.join(backupDir, filename);

  try {
    await db.backup(dest);
  } catch (e) {
    return { error: `Backup fehlgeschlagen: ${e.message}` };
  }

  // Rolling: delete oldest if over max
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('acaudit_') && f.endsWith('.db'))
      .sort();
    while (files.length > cfg.maxBackups) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(backupDir, oldest));
    }
  } catch { /* ignore cleanup errors */ }

  return { ok: true, filename };
}

let lastBackupDbMtime = null;

function startBackupScheduler() {
  setInterval(async () => {
    try {
      const cfg = getBackupSettings();
      if (!cfg.path) return;

      const now = new Date();
      const dayMap = { 0: 'su', 1: 'mo', 2: 'tu', 3: 'we', 4: 'th', 5: 'fr', 6: 'sa' };
      const today = dayMap[now.getDay()];
      const activeDays = cfg.days.split(',').map(d => d.trim().toLowerCase());
      if (!activeDays.includes(today)) return;

      const [hh, mm] = cfg.time.split(':').map(Number);
      if (now.getHours() !== hh || now.getMinutes() !== mm) return;

      const dbPath = path.join(dataDir, 'acaudit.db');
      const dbMtime = fs.statSync(dbPath).mtimeMs;
      if (lastBackupDbMtime !== null && dbMtime <= lastBackupDbMtime) return;

      const result = await performBackup();
      if (result.ok) {
        lastBackupDbMtime = dbMtime;
        console.log(`[Backup] ${result.filename}`);
      } else {
        console.error(`[Backup] ${result.error}`);
      }
    } catch (e) {
      console.error('[Backup] Scheduler error:', e.message);
    }
  }, 60000);
}

module.exports = { getBackupSettings, performBackup, startBackupScheduler };
