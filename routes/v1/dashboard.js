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

// Revenue reports
router.get('/revenue', async (req, res) => {
  try {
    const db = getDb();
    const numMonths = parseInt(req.query.months) || 6;

    // Monthly revenue for last N months
    const monthlyRevenue = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

      const row = await db.prepare(
        "SELECT COALESCE(SUM(price), 0) as revenue, COUNT(*) as count FROM appointments WHERE date >= ? AND date < ? AND status = 'completed'"
      ).get(monthStart, monthEnd);

      monthlyRevenue.push({
        month: monthStart.substring(0, 7),
        label: `${d.getMonth() + 1}/${d.getFullYear()}`,
        revenue: row.revenue,
        count: row.count
      });
    }

    // Revenue by barber (current month)
    const now = new Date();
    const curMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const revenueByBarber = await db.prepare(`
      SELECT b.id, b.name, b.color, COALESCE(SUM(a.price), 0) as revenue, COUNT(a.id) as count
      FROM barbers b
      LEFT JOIN appointments a ON a.barber_id = b.id AND a.date >= ? AND a.status = 'completed'
      WHERE b.active = 1
      GROUP BY b.id, b.name, b.color
      ORDER BY revenue DESC
    `).all(curMonthStart);

    // Revenue by service (current month)
    const revenueByService = await db.prepare(`
      SELECT s.id, s.name, s.color, COALESCE(SUM(a.price), 0) as revenue, COUNT(a.id) as count
      FROM services s
      LEFT JOIN appointments a ON a.service_id = s.id AND a.date >= ? AND a.status = 'completed'
      WHERE s.active = 1
      GROUP BY s.id, s.name, s.color
      ORDER BY revenue DESC
    `).all(curMonthStart);

    // Weekly revenue (last 4 weeks)
    const weeklyRevenue = [];
    for (let i = 3; i >= 0; i--) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);

      const ws = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const we = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

      const row = await db.prepare(
        "SELECT COALESCE(SUM(price), 0) as revenue, COUNT(*) as count FROM appointments WHERE date >= ? AND date <= ? AND status = 'completed'"
      ).get(ws, we);

      weeklyRevenue.push({
        start: ws,
        end: we,
        label: `${weekStart.getDate()}/${weekStart.getMonth() + 1} - ${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`,
        revenue: row.revenue,
        count: row.count
      });
    }

    // Summary
    const totalRevenue = monthlyRevenue.reduce((s, m) => s + m.revenue, 0);
    const totalAppointments = monthlyRevenue.reduce((s, m) => s + m.count, 0);
    const avgPerAppointment = totalAppointments > 0 ? Math.round(totalRevenue / totalAppointments) : 0;

    res.json({
      monthlyRevenue,
      weeklyRevenue,
      revenueByBarber,
      revenueByService,
      summary: { totalRevenue, totalAppointments, avgPerAppointment }
    });
  } catch (err) {
    console.error('Revenue report error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת דוחות' });
  }
});

module.exports = router;
