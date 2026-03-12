const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireTenant);

// Get all settings
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare('SELECT * FROM settings WHERE tenant_id = ?').all(req.tenantId);
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות' });
  }
});

// Update settings
router.put('/', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const updates = req.body;

    const transaction = db.transaction(async (txDb) => {
      for (const [key, value] of Object.entries(updates)) {
        await txDb.prepare('INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?) ON CONFLICT (tenant_id, key) DO UPDATE SET value = ?').run(tid, key, String(value), String(value));
      }
    });

    await transaction();
    res.json({ message: 'ההגדרות עודכנו בהצלחה' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון הגדרות' });
  }
});

module.exports = router;
