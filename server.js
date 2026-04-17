const express = require('express');
const path = require('path');
require('./db');

const { authMiddleware } = require('./middleware/auth');
const { startLogCleanupScheduler } = require('./services/log-cleanup');
const { startTrashCleanupScheduler } = require('./services/trash');
const { startBackupScheduler } = require('./services/backup');
const { startNotifyScheduler } = require('./services/notifications');

const app = express();
const PORT = process.env.PORT || 8090;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes (before auth middleware)
app.use(require('./routes/auth'));

// Auth middleware — guards everything below
app.use(authMiddleware);

// Page routes (EJS-rendered HTML)
app.use(require('./routes/pages'));

// API routes
app.use(require('./routes/home'));
app.use(require('./routes/settings'));
app.use(require('./routes/backup'));
app.use(require('./routes/companies'));
app.use(require('./routes/departments'));
app.use(require('./routes/persons'));
app.use(require('./routes/audit-plans'));
app.use(require('./routes/audit-plan-lines'));
app.use(require('./routes/checklist-items'));
app.use(require('./routes/cap-items'));
app.use(require('./routes/change-requests'));
app.use(require('./routes/change-tasks'));
app.use(require('./routes/risk-analysis'));
app.use(require('./routes/logs'));
app.use(require('./routes/trash'));
app.use(require('./routes/health'));

// Background schedulers
startLogCleanupScheduler();
startTrashCleanupScheduler();
startBackupScheduler();
startNotifyScheduler();

app.listen(PORT, () => {
  console.log(`ac-audit running on http://localhost:${PORT}`);
});
