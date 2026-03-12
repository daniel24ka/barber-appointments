const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireTenant);

// Check availability (must be before /:id)
router.get('/check/availability', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { barber_id, date, start_time, end_time, exclude_id } = req.query;

    if (!barber_id || !date || !start_time || !end_time) {
      return res.status(400).json({ error: 'חסרים פרמטרים' });
    }

    const dayOff = await db.prepare('SELECT id FROM days_off WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayOff) return res.json({ available: false, reason: 'הספר ביום חופש' });

    const barber = await db.prepare('SELECT work_days, work_start_time, work_end_time FROM barbers WHERE id = ? AND tenant_id = ?').get(barber_id, tid);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const workDays = barber.work_days.split(',').map(Number);
    if (!workDays.includes(dayOfWeek)) {
      return res.json({ available: false, reason: 'הספר לא עובד ביום זה' });
    }

    if (start_time < barber.work_start_time || end_time > barber.work_end_time) {
      return res.json({ available: false, reason: 'מחוץ לשעות העבודה' });
    }

    let conflictSql = `
      SELECT id FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled') AND tenant_id = ?
      AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))
    `;
    const conflictParams = [barber_id, date, tid, end_time, start_time, end_time, start_time, start_time, end_time];

    if (exclude_id) {
      conflictSql += ' AND id != ?';
      conflictParams.push(exclude_id);
    }

    const conflict = await db.prepare(conflictSql).get(...conflictParams);
    if (conflict) return res.json({ available: false, reason: 'כבר קיים תור בשעה זו' });

    res.json({ available: true });
  } catch (err) {
    console.error('Check availability error:', err);
    res.status(500).json({ error: 'שגיאה בבדיקת זמינות' });
  }
});

// Get available slots for a barber on a date (must be before /:id)
router.get('/slots/:barber_id/:date', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { barber_id, date } = req.params;
    const { service_id } = req.query;

    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1 AND tenant_id = ?').get(barber_id, tid);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    const dayOff = await db.prepare('SELECT id FROM days_off WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayOff) return res.json({ slots: [], reason: 'יום חופש' });

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const workDays = barber.work_days.split(',').map(Number);
    if (!workDays.includes(dayOfWeek)) return res.json({ slots: [], reason: 'לא עובד ביום זה' });

    let duration = barber.slot_duration;
    if (service_id) {
      const service = await db.prepare('SELECT duration FROM services WHERE id = ? AND tenant_id = ?').get(service_id, tid);
      if (service) duration = service.duration;
    }

    const existing = await db.prepare(`
      SELECT start_time, end_time FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled') AND tenant_id = ?
      ORDER BY start_time
    `).all(barber_id, date, tid);

    const slots = [];
    const [startH, startM] = barber.work_start_time.split(':').map(Number);
    const [endH, endM] = barber.work_end_time.split(':').map(Number);
    let currentMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const interval = parseInt((await db.prepare("SELECT value FROM settings WHERE key = 'slot_interval' AND tenant_id = ?").get(tid))?.value || '15');

    while (currentMinutes + duration <= endMinutes) {
      const slotStart = `${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}`;
      const slotEndMin = currentMinutes + duration;
      const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, '0')}:${String(slotEndMin % 60).padStart(2, '0')}`;

      const conflict = existing.some(e =>
        (slotStart < e.end_time && slotEnd > e.start_time)
      );

      slots.push({ start: slotStart, end: slotEnd, available: !conflict });
      currentMinutes += interval;
    }

    res.json({ slots });
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת משבצות' });
  }
});

// Get appointments with filters
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { date, barber_id, status, start_date, end_date, client_id } = req.query;

    let sql = `
      SELECT a.*, c.name as client_name, c.phone as client_phone,
             b.name as barber_name, b.color as barber_color,
             s.name as service_name, s.color as service_color
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.tenant_id = $1
    `;
    const params = [tid];
    let pi = 1;

    if (date) { pi++; sql += ` AND a.date = $${pi}`; params.push(date); }
    if (barber_id) { pi++; sql += ` AND a.barber_id = $${pi}`; params.push(barber_id); }
    if (status) { pi++; sql += ` AND a.status = $${pi}`; params.push(status); }
    if (client_id) { pi++; sql += ` AND a.client_id = $${pi}`; params.push(client_id); }
    if (start_date && end_date) { pi++; sql += ` AND a.date >= $${pi}`; params.push(start_date); pi++; sql += ` AND a.date <= $${pi}`; params.push(end_date); }

    sql += ' ORDER BY a.date ASC, a.start_time ASC';

    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get appointments error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת תורים' });
  }
});

// Get single appointment
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const appt = await db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone, c.email as client_email,
             b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(req.params.id, req.tenantId);

    if (!appt) return res.status(404).json({ error: 'תור לא נמצא' });
    res.json(appt);
  } catch (err) {
    console.error('Get appointment error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת תור' });
  }
});

// Create appointment
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { client_id, barber_id, service_id, date, start_time, notes } = req.body;

    if (!client_id || !barber_id || !service_id || !date || !start_time) {
      return res.status(400).json({ error: 'חסרים שדות חובה' });
    }

    const service = await db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(service_id, tid);
    if (!service) return res.status(404).json({ error: 'שירות לא נמצא' });

    const duration = service.duration;
    const [h, m] = start_time.split(':').map(Number);
    const endMinutes = h * 60 + m + duration;
    const end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    const conflict = await db.prepare(`
      SELECT id FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled') AND tenant_id = ?
      AND start_time < ? AND end_time > ?
    `).get(barber_id, date, tid, end_time, start_time);

    if (conflict) {
      return res.status(409).json({ error: 'כבר קיים תור בשעה זו' });
    }

    const result = await db.prepare(`
      INSERT INTO appointments (tenant_id, client_id, barber_id, service_id, date, start_time, end_time, duration, status, notes, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(tid, client_id, barber_id, service_id, date, start_time, end_time, duration, notes || '', service.price);

    const newAppt = await db.prepare(`
      SELECT a.*, c.name as client_name, b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(newAppt);
  } catch (err) {
    console.error('Create appointment error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת תור' });
  }
});

// Update appointment
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { client_id, barber_id, service_id, date, start_time, status, notes } = req.body;

    const existing = await db.prepare('SELECT * FROM appointments WHERE id = ? AND tenant_id = ?').get(req.params.id, tid);
    if (!existing) return res.status(404).json({ error: 'תור לא נמצא' });

    const updates = {};
    if (client_id !== undefined) updates.client_id = client_id;
    if (barber_id !== undefined) updates.barber_id = barber_id;
    if (service_id !== undefined) updates.service_id = service_id;
    if (date !== undefined) updates.date = date;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (start_time !== undefined || service_id !== undefined) {
      const sid = service_id || existing.service_id;
      const service = await db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(sid, tid);
      const st = start_time || existing.start_time;
      const [h, m] = st.split(':').map(Number);
      const endMin = h * 60 + m + service.duration;
      updates.start_time = st;
      updates.end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      updates.duration = service.duration;
      updates.price = service.price;
    }

    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

    await db.query(
      `UPDATE appointments SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = $${keys.length + 1} AND tenant_id = $${keys.length + 2}`,
      [...values, req.params.id, tid]
    );

    // Update client visits if completed
    if (status === 'completed') {
      await db.prepare('UPDATE clients SET total_visits = total_visits + 1, last_visit = CURRENT_TIMESTAMP WHERE id = ?').run(existing.client_id);
    }

    const updated = await db.prepare(`
      SELECT a.*, c.name as client_name, b.name as barber_name, s.name as service_name
      FROM appointments a JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id JOIN services s ON a.service_id = s.id
      WHERE a.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (err) {
    console.error('Update appointment error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון תור' });
  }
});

// Delete appointment
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const result = await db.prepare('DELETE FROM appointments WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantId);
    if (result.changes === 0) return res.status(404).json({ error: 'תור לא נמצא' });
    res.json({ message: 'התור נמחק בהצלחה' });
  } catch (err) {
    console.error('Delete appointment error:', err);
    res.status(500).json({ error: 'שגיאה במחיקת תור' });
  }
});

module.exports = router;
