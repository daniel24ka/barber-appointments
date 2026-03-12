const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');

router.use(authenticateToken);

// Get all barbers
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const barbers = await db.prepare('SELECT * FROM barbers WHERE active = 1 ORDER BY name').all();
    res.json(barbers);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת ספרים' });
  }
});

// Get single barber
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ?').get(req.params.id);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });
    res.json(barber);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת ספר' });
  }
});

// Create barber
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const { name, phone, email, specialty, work_start_time, work_end_time, work_days, slot_duration, color, username, password } = req.body;

    if (!name) return res.status(400).json({ error: 'שם הספר הוא שדה חובה' });

    let userId = null;
    if (username && password) {
      const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) return res.status(409).json({ error: 'שם המשתמש כבר קיים' });

      const hashed = bcrypt.hashSync(password, 10);
      const userResult = await db.prepare('INSERT INTO users (username, password, role, display_name, phone, email) VALUES (?, ?, ?, ?, ?, ?)').run(
        username, hashed, 'barber', name, phone || '', email || ''
      );
      userId = userResult.lastInsertRowid;
    }

    const result = await db.prepare(`
      INSERT INTO barbers (user_id, name, phone, email, specialty, work_start_time, work_end_time, work_days, slot_duration, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, name, phone || '', email || '', specialty || '',
      work_start_time || '09:00', work_end_time || '18:00',
      work_days || '0,1,2,3,4', slot_duration || 30, color || '#4F46E5'
    );

    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(barber);
  } catch (err) {
    console.error('Create barber error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת ספר' });
  }
});

// Update barber
router.put('/:id', requireRole('admin', 'barber'), async (req, res) => {
  try {
    const db = getDb();
    const { name, phone, email, specialty, work_start_time, work_end_time, work_days, slot_duration, color, notes } = req.body;

    const existing = await db.prepare('SELECT * FROM barbers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'ספר לא נמצא' });

    await db.prepare(`
      UPDATE barbers SET name = ?, phone = ?, email = ?, specialty = ?,
      work_start_time = ?, work_end_time = ?, work_days = ?, slot_duration = ?,
      color = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name, phone ?? existing.phone, email ?? existing.email,
      specialty ?? existing.specialty, work_start_time || existing.work_start_time,
      work_end_time || existing.work_end_time, work_days || existing.work_days,
      slot_duration || existing.slot_duration, color || existing.color,
      notes ?? existing.notes, req.params.id
    );

    const updated = await db.prepare('SELECT * FROM barbers WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update barber error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון ספר' });
  }
});

// Delete (deactivate) barber
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE barbers SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ message: 'הספר הוסר בהצלחה' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בהסרת ספר' });
  }
});

// Days off
router.get('/:id/days-off', async (req, res) => {
  try {
    const db = getDb();
    const daysOff = await db.prepare('SELECT * FROM days_off WHERE barber_id = ? ORDER BY date').all(req.params.id);
    res.json(daysOff);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת ימי חופש' });
  }
});

router.post('/:id/days-off', requireRole('admin', 'barber'), async (req, res) => {
  try {
    const db = getDb();
    const { date, reason } = req.body;
    if (!date) return res.status(400).json({ error: 'נא לציין תאריך' });

    await db.query(
      'INSERT INTO days_off (barber_id, date, reason) VALUES ($1, $2, $3) ON CONFLICT (barber_id, date) DO UPDATE SET reason = EXCLUDED.reason',
      [req.params.id, date, reason || '']
    );
    res.status(201).json({ message: 'יום חופש נוסף' });
  } catch (err) {
    console.error('Add day off error:', err);
    res.status(500).json({ error: 'שגיאה בהוספת יום חופש' });
  }
});

router.delete('/:id/days-off/:dayOffId', requireRole('admin', 'barber'), async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM days_off WHERE id = ? AND barber_id = ?').run(req.params.dayOffId, req.params.id);
    res.json({ message: 'יום החופש הוסר' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בהסרת יום חופש' });
  }
});

module.exports = router;
