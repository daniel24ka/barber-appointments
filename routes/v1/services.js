const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireTenant);

// Get all services
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const services = await db.prepare('SELECT * FROM services WHERE active = 1 AND tenant_id = ? ORDER BY sort_order, name').all(req.tenantId);
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת שירותים' });
  }
});

// Create service
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { name, description, duration, price, color, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'שם השירות הוא שדה חובה' });
    if (duration !== undefined && (duration < 5 || duration > 480)) return res.status(400).json({ error: 'משך השירות חייב להיות בין 5 ל-480 דקות' });
    if (price !== undefined && price < 0) return res.status(400).json({ error: 'מחיר לא יכול להיות שלילי' });

    const result = await db.prepare('INSERT INTO services (tenant_id, name, description, duration, price, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      tid, name, description || '', Math.max(5, duration || 30), Math.max(0, price || 0), color || '#10B981', sort_order || 0
    );

    const service = await db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(service);
  } catch (err) {
    console.error('Create service error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת שירות' });
  }
});

// Update service
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { name, description, duration, price, color, sort_order } = req.body;

    const existing = await db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(req.params.id, tid);
    if (!existing) return res.status(404).json({ error: 'שירות לא נמצא' });
    if (duration !== undefined && (duration < 5 || duration > 480)) return res.status(400).json({ error: 'משך השירות חייב להיות בין 5 ל-480 דקות' });
    if (price !== undefined && price < 0) return res.status(400).json({ error: 'מחיר לא יכול להיות שלילי' });

    await db.prepare('UPDATE services SET name=?, description=?, duration=?, price=?, color=?, sort_order=? WHERE id=? AND tenant_id=?').run(
      name || existing.name, description ?? existing.description,
      duration !== undefined ? Math.max(5, duration) : existing.duration,
      price !== undefined ? Math.max(0, price) : existing.price,
      color || existing.color, sort_order ?? existing.sort_order, req.params.id, tid
    );

    const updated = await db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בעדכון שירות' });
  }
});

// Delete (deactivate) service
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE services SET active = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantId);
    res.json({ message: 'השירות הוסר בהצלחה' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בהסרת שירות' });
  }
});

module.exports = router;
