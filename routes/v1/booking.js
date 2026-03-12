const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { sendBookingConfirmation } = require('../../services/email');

// All booking routes expect req.tenantId to be set by the tenant middleware in server.js

// Helper: get current time in Israel timezone
function getIsraelNow() {
  const now = new Date();
  // Convert to Israel time string and parse it
  const israelStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  return new Date(israelStr);
}

// Get active barbers (public)
router.get('/barbers', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const barbers = await db.prepare('SELECT id, name, specialty, color, work_start_time, work_end_time, work_days FROM barbers WHERE active = 1 AND tenant_id = ? ORDER BY name').all(tid);
    res.json(barbers);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת ספרים' });
  }
});

// Get active services (public)
router.get('/services', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const services = await db.prepare('SELECT id, name, duration, price, color FROM services WHERE active = 1 AND tenant_id = ? ORDER BY sort_order, name').all(tid);
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת שירותים' });
  }
});

// Get available slots for a barber on a date (public)
router.get('/slots/:barber_id/:date', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { barber_id, date } = req.params;

    // Use Israel timezone for all date/time comparisons
    const israelNow = getIsraelNow();

    // Validate date is not in the past
    const todayIsrael = new Date(israelNow);
    todayIsrael.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date + 'T00:00:00');
    if (requestedDate < todayIsrael) {
      return res.json({ slots: [], reason: 'לא ניתן להזמין תור בתאריך שעבר' });
    }

    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1 AND tenant_id = ?').get(barber_id, tid);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    // Check day off
    const dayOff = await db.prepare('SELECT id FROM days_off WHERE barber_id = ? AND date = ?').get(barber_id, date);
    if (dayOff) return res.json({ slots: [], reason: 'הספר ביום חופש' });

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const workDays = barber.work_days ? barber.work_days.split(',').map(Number) : [0,1,2,3,4];
    if (!workDays.includes(dayOfWeek)) return res.json({ slots: [], reason: 'הספר לא עובד ביום זה' });

    // Get service duration
    const { service_id } = req.query;
    let service;
    if (service_id) {
      service = await db.prepare("SELECT * FROM services WHERE id = ? AND active = 1 AND tenant_id = ?").get(service_id, tid);
    }
    if (!service) {
      service = await db.prepare("SELECT * FROM services WHERE active = 1 AND tenant_id = ? ORDER BY sort_order ASC LIMIT 1").get(tid);
    }
    if (!service) {
      console.warn(`[Booking] No active services found for tenant ${tid}`);
      return res.json({ slots: [], reason: 'לא הוגדרו שירותים במספרה. אנא פנה לבעל העסק.' });
    }
    const slotDuration = service.duration;

    // Get existing appointments
    const existing = await db.prepare(`
      SELECT start_time, end_time FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled') AND tenant_id = ?
      ORDER BY start_time
    `).all(barber_id, date, tid);

    // Generate slots based on service duration
    const workStart = barber.work_start_time || '09:00';
    const workEnd = barber.work_end_time || '18:00';
    const [startH, startM] = workStart.split(':').map(Number);
    const [endH, endM] = workEnd.split(':').map(Number);
    let currentMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const intervalRow = await db.prepare("SELECT value FROM settings WHERE key = 'slot_interval' AND tenant_id = ?").get(tid);
    const interval = parseInt(intervalRow?.value || '15');

    // If today (Israel time), skip past slots
    const isToday = requestedDate.toDateString() === todayIsrael.toDateString();

    const slots = [];
    while (currentMinutes + slotDuration <= endMinutes) {
      const slotStart = `${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}`;
      const slotEndMin = currentMinutes + slotDuration;
      const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, '0')}:${String(slotEndMin % 60).padStart(2, '0')}`;

      // Skip past times if today - use Israel time!
      if (isToday) {
        const nowMinutes = israelNow.getHours() * 60 + israelNow.getMinutes();
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

    console.log(`[Booking] Slots for barber ${barber_id}, date ${date}, tenant ${tid}: ${slots.length} available (service: ${service.name}, ${slotDuration}min, interval: ${interval}min, work: ${workStart}-${workEnd}, isToday: ${isToday})`);
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
    const tid = req.tenantId;
    const { barber_id, date, start_time, client_name, client_phone, service_id } = req.body;

    if (!barber_id || !date || !start_time || !client_name || !client_phone) {
      return res.status(400).json({ error: 'נא למלא את כל השדות' });
    }

    // Validate phone format
    const cleanPhone = client_phone.replace(/[-\s]/g, '');
    if (!/^0\d{8,9}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    }

    // Validate date not in past (Israel time)
    const israelNow = getIsraelNow();
    const todayIsrael = new Date(israelNow);
    todayIsrael.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date + 'T00:00:00');
    if (requestedDate < todayIsrael) {
      return res.status(400).json({ error: 'לא ניתן להזמין תור בתאריך שעבר' });
    }

    // Get service
    let service;
    if (service_id) {
      service = await db.prepare("SELECT * FROM services WHERE id = ? AND active = 1 AND tenant_id = ?").get(service_id, tid);
    }
    if (!service) {
      service = await db.prepare("SELECT * FROM services WHERE active = 1 AND tenant_id = ? ORDER BY sort_order ASC LIMIT 1").get(tid);
    }
    if (!service) return res.status(500).json({ error: 'לא נמצא שירות פעיל' });

    const barber = await db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1 AND tenant_id = ?').get(barber_id, tid);
    if (!barber) return res.status(404).json({ error: 'ספר לא נמצא' });

    // Calculate end time
    const [h, m] = start_time.split(':').map(Number);
    const endMin = h * 60 + m + service.duration;
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    // Check conflict
    const conflict = await db.prepare(`
      SELECT id FROM appointments
      WHERE barber_id = ? AND date = ? AND status NOT IN ('cancelled') AND tenant_id = ?
      AND start_time < ? AND end_time > ?
    `).get(barber_id, date, tid, end_time, start_time);

    if (conflict) {
      return res.status(409).json({ error: 'השעה כבר תפוסה, נא לבחור שעה אחרת' });
    }

    // Find or create client (scoped to tenant)
    let client = await db.prepare('SELECT * FROM clients WHERE phone = ? AND tenant_id = ?').get(cleanPhone, tid);
    if (!client) {
      const result = await db.prepare('INSERT INTO clients (tenant_id, name, phone) VALUES (?, ?, ?)').run(tid, client_name.trim(), cleanPhone);
      client = { id: result.lastInsertRowid };
    }

    // Create appointment
    await db.prepare(`
      INSERT INTO appointments (tenant_id, client_id, barber_id, service_id, date, start_time, end_time, duration, status, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(tid, client.id, barber_id, service.id, date, start_time, end_time, service.duration, service.price);

    res.status(201).json({
      message: 'התור נקבע בהצלחה!',
      details: {
        barber: barber.name,
        date,
        time: start_time,
        service: service.name
      }
    });

    // Send booking confirmation email (fire-and-forget)
    if (client.email || req.body.client_email) {
      const emailTo = client.email || req.body.client_email;
      // Fetch shop name for the email
      const shopSetting = await db.prepare("SELECT value FROM settings WHERE key = 'shop_name' AND tenant_id = ?").get(tid);
      sendBookingConfirmation(emailTo, {
        clientName: client_name,
        barberName: barber.name,
        date,
        time: start_time,
        serviceName: service.name,
        shopName: shopSetting?.value || 'המספרה',
        price: service.price
      }).catch(err => console.error('[Email] Booking confirmation failed:', err.message));
    }
  } catch (err) {
    console.error('Public booking error:', err);
    res.status(500).json({ error: 'שגיאה בהזמנת התור' });
  }
});

// Lookup returning client by phone (public)
router.get('/client-lookup/:phone', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const cleanPhone = req.params.phone.replace(/[-\s]/g, '');
    if (cleanPhone.length < 9) return res.json({ found: false });

    const client = await db.prepare('SELECT id, name, phone, total_visits, vip, last_visit FROM clients WHERE phone = ? AND tenant_id = ?').get(cleanPhone, tid);
    if (!client) return res.json({ found: false });

    // Get last completed appointment with barber + service names
    const lastAppt = await db.prepare(`
      SELECT a.date, a.start_time, b.id as barber_id, b.name as barber_name, s.id as service_id, s.name as service_name
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.client_id = ? AND a.status = 'completed' AND a.tenant_id = ?
      ORDER BY a.date DESC, a.start_time DESC
      LIMIT 1
    `).get(client.id, tid);

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
    const tid = req.tenantId;
    const settings = await db.prepare('SELECT key, value FROM settings WHERE tenant_id = ?').all(tid);
    const info = {};
    settings.forEach(s => { info[s.key] = s.value; });

    // Also get tenant branding
    const tenant = await db.prepare('SELECT name, logo_url, primary_color FROM tenants WHERE id = ?').get(tid);

    res.json({
      name: info.shop_name || tenant?.name || 'מספרה',
      phone: info.shop_phone || '',
      address: info.shop_address || '',
      logo_url: tenant?.logo_url || null,
      primary_color: tenant?.primary_color || '#4F46E5',
      tenant_id: tid
    });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה' });
  }
});

module.exports = router;
