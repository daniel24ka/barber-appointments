const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken } = require('../../middleware/auth');

router.use(authenticateToken);

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const todayAppts = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled')").get(today)).c;
    const pendingAppts = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status = 'pending'").get(today)).c;
    const totalClients = (await db.prepare('SELECT COUNT(*) as c FROM clients').get()).c;
    const totalBarbers = (await db.prepare('SELECT COUNT(*) as c FROM barbers WHERE active = 1').get()).c;

    // Revenue today
    const todayRevenue = (await db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date = ? AND status = 'completed'").get(today)).total;

    // Revenue this month
    const monthStart = today.substring(0, 7) + '-01';
    const monthRevenue = (await db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date >= ? AND status = 'completed'").get(monthStart)).total;

    // Upcoming appointments (next 10)
    const upcoming = await db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone,
             b.name as barber_name, b.color as barber_color, s.name as service_name,
             c.total_visits as client_visits, c.vip as client_vip
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.date >= ? AND a.status IN ('pending', 'confirmed')
      ORDER BY a.date ASC, a.start_time ASC
      LIMIT 10
    `).all(today);

    // Reminders: pending appointments for today not confirmed
    const reminders = await db.prepare(`
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
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const count = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled')").get(ds)).c;
      weekDays.push({ date: ds, day: d.getDay(), count });
    }

    // Top 5 clients (by visits)
    const topClients = await db.prepare(`
      SELECT id, name, phone, total_visits, vip, last_visit
      FROM clients
      WHERE total_visits > 0
      ORDER BY total_visits DESC
      LIMIT 5
    `).all();

    // Clients at risk (visited before but not in 30+ days)
    const atRiskClients = await db.prepare(`
      SELECT id, name, phone, total_visits, last_visit
      FROM clients
      WHERE last_visit IS NOT NULL
      AND last_visit < NOW() - INTERVAL '30 days'
      ORDER BY last_visit ASC
      LIMIT 5
    `).all();

    // New clients this month
    const newClientsMonth = (await db.prepare(
      "SELECT COUNT(*) as c FROM clients WHERE created_at >= ?"
    ).get(monthStart)).c;

    // Returning client rate (clients with 2+ visits / total clients with visits)
    const clientsWithVisits = (await db.prepare("SELECT COUNT(*) as c FROM clients WHERE total_visits > 0").get()).c;
    const returningClients = (await db.prepare("SELECT COUNT(*) as c FROM clients WHERE total_visits >= 2").get()).c;
    const returningRate = clientsWithVisits > 0 ? Math.round((returningClients / clientsWithVisits) * 100) : 0;

    res.json({
      todayAppointments: todayAppts,
      pendingAppointments: pendingAppts,
      totalClients,
      totalBarbers,
      todayRevenue,
      monthRevenue,
      upcoming,
      reminders,
      weekStats: weekDays,
      topClients,
      atRiskClients,
      newClientsMonth,
      returningRate
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת לוח בקרה' });
  }
});

module.exports = router;
