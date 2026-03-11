const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken } = require('../../middleware/auth');

router.use(authenticateToken);

// Dashboard stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    const todayAppts = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled')").get(today).c;
    const pendingAppts = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status = 'pending'").get(today).c;
    const totalClients = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
    const totalBarbers = db.prepare('SELECT COUNT(*) as c FROM barbers WHERE active = 1').get().c;

    // Revenue today
    const todayRevenue = db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date = ? AND status = 'completed'").get(today).total;

    // Revenue this month
    const monthStart = today.substring(0, 7) + '-01';
    const monthRevenue = db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date >= ? AND status = 'completed'").get(monthStart).total;

    // Upcoming appointments (next 5)
    const upcoming = db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone,
             b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.date >= ? AND a.status IN ('pending', 'confirmed')
      ORDER BY a.date ASC, a.start_time ASC
      LIMIT 10
    `).all(today);

    // Reminders: pending appointments for today not confirmed
    const reminders = db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone, b.name as barber_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      WHERE a.date = ? AND a.status = 'pending'
      ORDER BY a.start_time
    `).all(today);

    // Week stats
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay() + i);
      const ds = d.toISOString().split('T')[0];
      const count = db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled')").get(ds).c;
      weekDays.push({ date: ds, day: d.getDay(), count });
    }

    res.json({
      todayAppointments: todayAppts,
      pendingAppointments: pendingAppts,
      totalClients,
      totalBarbers,
      todayRevenue,
      monthRevenue,
      upcoming,
      reminders,
      weekStats: weekDays
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת לוח בקרה' });
  }
});

module.exports = router;
