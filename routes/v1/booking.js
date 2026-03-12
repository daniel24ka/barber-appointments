const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');

// Get active barbers (public)
router.get('/barbers', async (req, res) => {
  try {
    const db = getDb();
    const barbers = await db.prepare('SELECT id, name, specialty, color, work_start_time, work_end_time, work_days FROM barbers WHERE active = 1 ORDER BY name').all();
    res.json(barbers);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת ספרים' });
  }
});

// Get active services (public)
router.get('/services', async (req, res) => {
  try {
    const db = getDb();
    const services = await db.prepare('SELECT id, name, duration, price, color FROM services WHERE active = 1 ORDER BY sort_order, name').all();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת שירותים' });
  }
});

// Get available slots for a barber on a date (public)
router.get('/slots/:barber_id/:date', async (req, res) => {
  try {
    const db = getDb();
    const { barber_id, date } = req.params;

    // Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date + 'T00:00:00');
    if (requestedDate < today) {
      return res.json({ slots: [], reason: 'לא ניתן להזמין תור בתאריך שעבר' });
    }

    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    // Check day off
    const dayOff = await db.prepare('SELECT id FROM days_off WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayOff) return res.json({ slots: [], reason: 'הספר ביום חופש' });

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const workDays = barber.work_days.split(',').map(Number);
    if (!workDays.includes(dayOfWeek)) return res.json({ slots: [], reason: 'הספר לא עובד ביום זה' });

    // Get service duration
    const { service_id } = req.query;
    let service;
    if (service_id) {
      service = await db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(service_id);
    }
    if (!service) {
      service = await db.prepare("SELECT * FROM services WHERE active = 1 ORDER BY sort_order ASC LIMIT 1").get();
    }
    const slotDuration = service ? service.duration : 30;

    // Get existing appointments
    const existing = await db.prepare(`
      SELECT start_time, end_time FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled')
      ORDER BY start_time
    `).all(barber_id, date);

    // Generate slots based on service duration
    const [startH, startM] = barber.work_start_time.split(':').map(Number);
    const [endH, endM] = barber.work_end_time.split(':').map(Number);
    let currentMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const interval = parseInt((await db.prepare("SELECT value FROM settings WHERE key = 'slot_interval'").get())?.value || '15');

    // If today, skip past slots
    const now = new Date();
    const isToday = requestedDate.toDateString() === now.toDateString();

    const slots = [];
    while (currentMinutes + slotDuration <= endMinutes) {
      const slotStart = `${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}`;
      const slotEndMin = currentMinutes + slotDuration;
      const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, '0')}:${String(slotEndMin % 60).padStart(2, '0')}`;

      // Skip past times if today
      if (isToday) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        if (currentMinutes <= nowMinutes) {
          currentMinutes += interval;
          continue;
        }
      }

      const conflict = existing.some(e => slotStart < e.end_time && slotEnd > e.start_time);

      if (!conflict) {
        slots.push({ start: slotStart, end: slotEnd });
      }

      currentMinutes += interval;
    }

    res.json({ slots });
  } catch (err) {
    console.error('Get public slots error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת שעות פנויות' });
  }
});

// Book appointment (public)
router.post('/book', async (req, res) => {
  try {
    const db = getDb();
    const { barber_id, date, start_time, client_name, client_phone, service_id } = req.body;

    if (!barber_id || !date || !start_time || !client_name || !client_phone) {
      return res.status(400).json({ error: 'נא למלא את כל השדות' });
    }

    // Validate phone format
    const cleanPhone = client_phone.replace(/[-\s]/g, '');
    if (!/^0\d{8,9}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    }

    // Validate date not in past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date + 'T00:00:00');
    if (requestedDate < today) {
      return res.status(400).json({ error: 'לא ניתן להזמין תור בתאריך שעבר' });
    }

    // Get service
    let service;
    if (service_id) {
      service = await db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(service_id);
    }
    if (!service) {
      service = await db.prepare("SELECT * FROM services WHERE active = 1 ORDER BY sort_order ASC LIMIT 1").get();
    }
    if (!service) return res.status(500).json({ error: 'לא נמצא שירות פעיל' });

    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barber_id);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    // Calculate end time
    const [h, m] = start_time.split(':').map(Number);
    const endMin = h * 60 + m + service.duration;
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    // Check conflict
    const conflict = await db.prepare(`
      SELECT id FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled')
      AND start_time < ? AND end_time > ?
    `).get(barber_id, date, end_time, start_time);

    if (conflict) {
      return res.status(409).json({ error: 'השעה כבר תפוסה, נא לבחור שעה אחרת' });
    }

    // Find or create client
    let client = await db.prepare('SELECT * FROM clients WHERE phone = ?').get(cleanPhone);
    if (!client) {
      const result = await db.prepare('INSERT INTO clients (name, phone) VALUES (?, ?)').run(client_name.trim(), cleanPhone);
      client = { id: result.lastInsertRowid };
    }

    // Create appointment
    await db.prepare(`
      INSERT INTO appointments (client_id, barber_id, service_id, date, start_time, end_time, duration, status, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(client.id, barber_id, service.id, date, start_time, end_time, service.duration, service.price);

    res.status(201).json({
      message: 'התור נקבע בהצלחה!',
      details: {
        barber: barber.name,
        date,
        time: start_time,
        service: service.name
      }
    });
  } catch (err) {
    console.error('Public booking error:', err);
    res.status(500).json({ error: 'שגיאה בהזמנת התור' });
  }
});

// Lookup returning client by phone (public)
router.get('/client-lookup/:phone', async (req, res) => {
  try {
    const db = getDb();
    const cleanPhone = req.params.phone.replace(/[-\s]/g, '');
    if (cleanPhone.length < 9) return res.json({ found: false });

    const client = await db.prepare('SELECT id, name, phone, total_visits, vip, last_visit FROM clients WHERE phone = ?').get(cleanPhone);
    if (!client) return res.json({ found: false });

    // Get last completed appointment with barber + service names
    const lastAppt = await db.prepare(`
      SELECT a.date, a.start_time, b.id as barber_id, b.name as barber_name, s.id as service_id, s.name as service_name
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.client_id = ? AND a.status = 'completed'
      ORDER BY a.date DESC, a.start_time DESC
      LIMIT 1
    `).get(client.id);

    res.json({
      found: true,
      client: {
        id: client.id,
        name: client.name,
        total_visits: client.total_visits,
        vip: client.vip,
        last_visit: client.last_visit
      },
      lastAppointment: lastAppt || null
    });
  } catch (err) {
    console.error('Client lookup error:', err);
    res.json({ found: false });
  }
});

// Get shop info (public)
router.get('/info', async (req, res) => {
  try {
    const db = getDb();
    const settings = await db.prepare('SELECT key, value FROM settings').all();
    const info = {};
    settings.forEach(s => { info[s.key] = s.value; });
    res.json({
      name: info.shop_name || 'מספרה',
      phone: info.shop_phone || '',
      address: info.shop_address || ''
    });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה' });
  }
});

module.exports = router;
