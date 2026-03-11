const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');

router.use(authenticateToken);

// Get all settings
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות' });
  }
});

// Update settings
router.put('/', requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const updates = req.body;

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        stmt.run(key, String(value));
      }
    });

    transaction(updates);
    res.json({ message: 'ההגדרות עודכנו בהצלחה' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בעדכון הגדרות' });
  }
});

module.exports = router;
