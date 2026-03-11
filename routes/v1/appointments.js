const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');

router.use(authenticateToken);

// Check availability (must be before /:id)
router.get('/check/availability', (req, res) => {
  try {
    const db = getDb();
    const { barber_id, date, start_time, end_time, exclude_id } = req.query;

    if (!barber_id || !date || !start_time || !end_time) {
      return res.status(400).json({ error: 'חסרים פרמטרים' });
    }

    // Check day off
    const dayOff = db.prepare('SELECT id FROM days_off WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayOff) return res.json({ available: false, reason: 'הספר ביום חופש' });

    // Check barber work days
    const barber = db.prepare('SELECT work_days, work_start_time, work_end_time FROM barbers WHERE id = ?').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const workDays = barber.work_days.split(',').map(Number);
    if (!workDays.includes(dayOfWeek)) {
      return res.json({ available: false, reason: 'הספר לא עובד ביום זה' });
    }

    if (start_time < barber.work_start_time || end_time > barber.work_end_time) {
      return res.json({ available: false, reason: 'מחוץ לשעות העבודה' });
    }

    // Check conflicts
    let conflictSql = `
      SELECT id FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled')
      AND ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR (start_time >= ? AND end_time <= ?))
    `;
    const conflictParams = [barber_id, date, end_time, start_time, end_time, start_time, start_time, end_time];

    if (exclude_id) {
      conflictSql += ' AND id != ?';
      conflictParams.push(exclude_id);
    }

    const conflict = db.prepare(conflictSql).get(...conflictParams);
    if (conflict) return res.json({ available: false, reason: 'כבר קיים תור בשעה זו' });

    res.json({ available: true });
  } catch (err) {
    console.error('Check availability error:', err);
    res.status(500).json({ error: 'שגיאה בבדיקת זמינות' });
  }
});

// Get available slots for a barber on a date (must be before /:id)
router.get('/slots/:barber_id/:date', (req, res) => {
  try {
    const db = getDb();
    const { barber_id, date } = req.params;
    const { service_id } = req.query;

    const barber = db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    // Check day off
    const dayOff = db.prepare('SELECT id FROM days_off WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayOff) return res.json({ slots: [], reason: 'יום חופש' });

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const workDays = barber.work_days.split(',').map(Number);
    if (!workDays.includes(dayOfWeek)) return res.json({ slots: [], reason: 'לא עובד ביום זה' });

    let duration = barber.slot_duration;
    if (service_id) {
      const service = db.prepare('SELECT duration FROM services WHERE id = ?').get(service_id);
      if (service) duration = service.duration;
    }

    // Get existing appointments
    const existing = db.prepare(`
      SELECT start_time, end_time FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled')
      ORDER BY start_time
    `).all(barber_id, date);

    // Generate slots
    const slots = [];
    const [startH, startM] = barber.work_start_time.split(':').map(Number);
    const [endH, endM] = barber.work_end_time.split(':').map(Number);
    let currentMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const interval = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'slot_interval'").get()?.value || '15');

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
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { date, barber_id, status, start_date, end_date, client_id } = req.query;

    let sql = `
      SELECT a.*, c.name as client_name, c.phone as client_phone,
             b.name as barber_name, b.color as barber_color,
             s.name as service_name, s.color as service_color
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (date) { sql += ' AND a.date = ?'; params.push(date); }
    if (barber_id) { sql += ' AND a.barber_id = ?'; params.push(barber_id); }
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    if (client_id) { sql += ' AND a.client_id = ?'; params.push(client_id); }
    if (start_date && end_date) { sql += ' AND a.date BETWEEN ? AND ?'; params.push(start_date, end_date); }

    sql += ' ORDER BY a.date ASC, a.start_time ASC';

    const appointments = db.prepare(sql).all(...params);
    res.json(appointments);
  } catch (err) {
    console.error('Get appointments error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת תורים' });
  }
});

// Get single appointment
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const appt = db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone, c.email as client_email,
             b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!appt) return res.status(404).json({ error: 'תור לא נמצא' });
    res.json(appt);
  } catch (err) {
    console.error('Get appointment error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת תור' });
  }
});

// Create appointment
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { client_id, barber_id, service_id, date, start_time, notes } = req.body;

    if (!client_id || !barber_id || !service_id || !date || !start_time) {
      return res.status(400).json({ error: 'חסרים שדות חובה' });
    }

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(service_id);
    if (!service) return res.status(404).json({ error: 'שירות לא נמצא' });

    const duration = service.duration;
    const [h, m] = start_time.split(':').map(Number);
    const endMinutes = h * 60 + m + duration;
    const end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

    // Check for conflicts
    const conflict = db.prepare(`
      SELECT id FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled')
      AND start_time < ? AND end_time > ?
    `).get(barber_id, date, end_time, start_time);

    if (conflict) {
      return res.status(409).json({ error: 'כבר קיים תור בשעה זו' });
    }

    const result = db.prepare(`
      INSERT INTO appointments (client_id, barber_id, service_id, date, start_time, end_time, duration, status, notes, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(client_id, barber_id, service_id, date, start_time, end_time, duration, notes || '', service.price);

    const newAppt = db.prepare(`
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
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { client_id, barber_id, service_id, date, start_time, status, notes } = req.body;

    const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
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
      const service = db.prepare('SELECT * FROM services WHERE id = ?').get(sid);
      const st = start_time || existing.start_time;
      const [h, m] = st.split(':').map(Number);
      const endMin = h * 60 + m + service.duration;
      updates.start_time = st;
      updates.end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      updates.duration = service.duration;
      updates.price = service.price;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    db.prepare(`UPDATE appointments SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, req.params.id);

    // Update client visits if completed
    if (status === 'completed') {
      db.prepare('UPDATE clients SET total_visits = total_visits + 1, last_visit = CURRENT_TIMESTAMP WHERE id = ?').run(existing.client_id);
    }

    const updated = db.prepare(`
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
router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'תור לא נמצא' });
    res.json({ message: 'התור נמחק בהצלחה' });
  } catch (err) {
    console.error('Delete appointment error:', err);
    res.status(500).json({ error: 'שגיאה במחיקת תור' });
  }
});

module.exports = router;
