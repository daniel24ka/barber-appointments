const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireTenant);

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const todayAppts = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled') AND tenant_id = ?").get(today, tid)).c;
    const pendingAppts = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status = 'pending' AND tenant_id = ?").get(today, tid)).c;
    const totalClients = (await db.prepare('SELECT COUNT(*) as c FROM clients WHERE tenant_id = ?').get(tid)).c;
    const totalBarbers = (await db.prepare('SELECT COUNT(*) as c FROM barbers WHERE active = 1 AND tenant_id = ?').get(tid)).c;

    // Revenue today
    const todayRevenue = (await db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date = ? AND status = 'completed' AND tenant_id = ?").get(today, tid)).total;

    // Revenue this month
    const monthStart = today.substring(0, 7) + '-01';
    const monthRevenue = (await db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date >= ? AND status = 'completed' AND tenant_id = ?").get(monthStart, tid)).total;

    // Upcoming appointments (next 10)
    const upcoming = await db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone,
             b.name as barber_name, b.color as barber_color, s.name as service_name,
             c.total_visits as client_visits, c.vip as client_vip
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.date >= ? AND a.status IN ('pending', 'confirmed') AND a.tenant_id = ?
      ORDER BY a.date ASC, a.start_time ASC
      LIMIT 10
    `).all(today, tid);

    // Reminders: pending appointments for today not confirmed
    const reminders = await db.prepare(`
      SELECT a.*, c.name as client_name, c.phone as client_phone, b.name as barber_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      WHERE a.date = ? AND a.status = 'pending' AND a.tenant_id = ?
      ORDER BY a.start_time
    `).all(today, tid);

    // Week stats
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const count = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled') AND tenant_id = ?").get(ds, tid)).c;
      weekDays.push({ date: ds, day: d.getDay(), count });
    }

    // Top 5 clients (by visits)
    const topClients = await db.prepare(`
      SELECT id, name, phone, total_visits, vip, last_visit
      FROM clients
      WHERE total_visits > 0 AND tenant_id = ?
      ORDER BY total_visits DESC
      LIMIT 5
    `).all(tid);

    // Clients at risk (visited before but not in 30+ days)
    const atRiskClients = await db.prepare(`
      SELECT id, name, phone, total_visits, last_visit
      FROM clients
      WHERE last_visit IS NOT NULL
      AND last_visit < NOW() - INTERVAL '30 days'
      AND tenant_id = ?
      ORDER BY last_visit ASC
      LIMIT 5
    `).all(tid);

    // New clients this month
    const newClientsMonth = (await db.prepare(
      "SELECT COUNT(*) as c FROM clients WHERE created_at >= ? AND tenant_id = ?"
    ).get(monthStart, tid)).c;

    // Returning client rate (clients with 2+ visits / total clients with visits)
    const clientsWithVisits = (await db.prepare("SELECT COUNT(*) as c FROM clients WHERE total_visits > 0 AND tenant_id = ?").get(tid)).c;
    const returningClients = (await db.prepare("SELECT COUNT(*) as c FROM clients WHERE total_visits >= 2 AND tenant_id = ?").get(tid)).c;
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
    const tid = req.tenantId;
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
        "SELECT COALESCE(SUM(price), 0) as revenue, COUNT(*) as count FROM appointments WHERE date >= ? AND date < ? AND status = 'completed' AND tenant_id = ?"
      ).get(monthStart, monthEnd, tid);

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
      WHERE b.active = 1 AND b.tenant_id = ?
      GROUP BY b.id, b.name, b.color
      ORDER BY revenue DESC
    `).all(curMonthStart, tid);

    // Revenue by service (current month)
    const revenueByService = await db.prepare(`
      SELECT s.id, s.name, s.color, COALESCE(SUM(a.price), 0) as revenue, COUNT(a.id) as count
      FROM services s
      LEFT JOIN appointments a ON a.service_id = s.id AND a.date >= ? AND a.status = 'completed'
      WHERE s.active = 1 AND s.tenant_id = ?
      GROUP BY s.id, s.name, s.color
      ORDER BY revenue DESC
    `).all(curMonthStart, tid);

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
        "SELECT COALESCE(SUM(price), 0) as revenue, COUNT(*) as count FROM appointments WHERE date >= ? AND date <= ? AND status = 'completed' AND tenant_id = ?"
      ).get(ws, we, tid);

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

// Super admin aggregate stats (across all tenants)
router.get('/super-stats', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'אין הרשאה' });
    }
    const db = getDb();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const monthStart = today.substring(0, 7) + '-01';

    // Aggregate stats across ALL tenants
    const totalTenants = (await db.prepare("SELECT COUNT(*) as c FROM tenants").get()).c;
    const activeTenants = (await db.prepare("SELECT COUNT(*) as c FROM tenants WHERE active = 1").get()).c;
    const trialTenants = (await db.prepare("SELECT COUNT(*) as c FROM tenants WHERE plan = 'trial' AND active = 1").get()).c;
    const totalClients = (await db.prepare("SELECT COUNT(*) as c FROM clients").get()).c;
    const totalBarbers = (await db.prepare("SELECT COUNT(*) as c FROM barbers WHERE active = 1").get()).c;
    const todayAppointments = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date = ? AND status NOT IN ('cancelled')").get(today)).c;
    const monthAppointments = (await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE date >= ? AND status NOT IN ('cancelled')").get(monthStart)).c;
    const monthRevenue = (await db.prepare("SELECT COALESCE(SUM(price), 0) as total FROM appointments WHERE date >= ? AND status = 'completed'").get(monthStart)).total;

    // Per-tenant breakdown
    const tenants = await db.prepare(`
      SELECT t.id, t.name, t.slug, t.plan, t.active, t.owner_name, t.owner_phone, t.trial_ends_at,
        (SELECT COUNT(*) FROM clients c WHERE c.tenant_id = t.id) as client_count,
        (SELECT COUNT(*) FROM barbers b WHERE b.tenant_id = t.id AND b.active = 1) as barber_count,
        (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id AND a.date = $1 AND a.status NOT IN ('cancelled')) as today_appointments,
        (SELECT COALESCE(SUM(a.price), 0) FROM appointments a WHERE a.tenant_id = t.id AND a.date >= $2 AND a.status = 'completed') as month_revenue
      FROM tenants t
      ORDER BY t.created_at DESC
    `).all(today, monthStart);

    res.json({
      totalTenants,
      activeTenants,
      trialTenants,
      totalClients,
      totalBarbers,
      todayAppointments,
      monthAppointments,
      monthRevenue,
      tenants
    });
  } catch (err) {
    console.error('Super admin stats error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת נתוני מערכת' });
  }
});

module.exports = router;
