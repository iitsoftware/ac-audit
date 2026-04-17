const express = require('express');
const fs = require('fs');
const path = require('path');
const { logAction } = require('../services/audit-log');
const { getBackupSettings, performBackup } = require('../services/backup');

const router = express.Router();

router.post('/api/backup/now', async (req, res) => {
  try {
    const result = await performBackup();
    if (result.error) return res.status(500).json(result);
    logAction('Backup erstellt', 'backup', '', result.filename);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/backup/list', (req, res) => {
  const cfg = getBackupSettings();
  if (!cfg.path || !fs.existsSync(cfg.path)) return res.json([]);
  try {
    const files = fs.readdirSync(cfg.path)
      .filter(f => f.startsWith('acaudit_') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map(f => {
        const stat = fs.statSync(path.join(cfg.path, f));
        return { filename: f, size: stat.size, created: stat.mtime.toISOString() };
      });
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
