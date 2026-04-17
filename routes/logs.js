const express = require('express');
const { stmts } = require('../db');

const router = express.Router();

router.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const logs = stmts.getRecentLogs.all(limit, offset);
  res.json(logs);
});

module.exports = router;
