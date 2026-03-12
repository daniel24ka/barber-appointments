const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireRole('admin'));
router.use(requireTenant);

function toCsv(rows, columns) {
  const BOM = '\uFEFF';
  const header = columns.map(c => c.label).join(',');
  const lines = rows.map(row =>
    columns.map(c => {
      let val = row[c.key];
      if (val === null || val === undefined) val = '';
      val = String(val).replace(/"/g, '""');
      if (val.includes(',') || val.includes('"') || val.includes('\n')) val = `"${val}"`;
      return val;
    }).join(',')
  );
  return BOM + header + '\n' + lines.join('\n');
}

// Export clients CSV
router.get('/clients', async (req, res) => {
  try {
    const db = getDb();
    const clients = await db.prepare('SELECT * FROM clients WHERE tenant_id = ? ORDER BY name').all(req.tenantId);

    const columns = [
      { key: 'id', label: 'מזהה' },
      { key: 'name', label: 'שם' },
      { key: 'phone', label: 'טלפון' },
      { key: 'email', label: 'אימייל' },
      { key: 'total_visits', label: 'ביקורים' },
      { key: 'last_visit', label: 'ביקור אחרון' },
      { key: 'vip', label: 'VIP' },
      { key: 'notes', label: 'הערות' },
      { key: 'created_at', label: 'תאריך יצירה' }
    ];

    const csv = toCsv(clients, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=clients.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export clients error:', err);
    res.status(500).json({ error: 'שגיאה בייצוא לקוחות' });
  }
});

// Export appointments CSV
router.get('/appointments', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { start_date, end_date } = req.query;

    let sql = `
      SELECT a.id, a.date, a.start_time, a.end_time, a.duration, a.price, a.status, a.notes,
             c.name as client_name, c.phone as client_phone,
             b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.tenant_id = $1
    `;
    const params = [tid];
    let pi = 1;

    if (start_date) {
      pi++; sql += ` AND a.date >= $${pi}`;
      params.push(start_date);
    }
    if (end_date) {
      pi++; sql += ` AND a.date <= $${pi}`;
      params.push(end_date);
    }

    sql += ' ORDER BY a.date DESC, a.start_time DESC';

    const result = await db.query(sql, params);

    const STATUS_HE = { pending: 'ממתין', confirmed: 'מאושר', completed: 'הושלם', cancelled: 'בוטל', no_show: 'לא הגיע' };

    const rows = result.rows.map(r => ({ ...r, status_he: STATUS_HE[r.status] || r.status }));

    const columns = [
      { key: 'id', label: 'מזהה' },
      { key: 'date', label: 'תאריך' },
      { key: 'start_time', label: 'שעת התחלה' },
      { key: 'end_time', label: 'שעת סיום' },
      { key: 'client_name', label: 'לקוח' },
      { key: 'client_phone', label: 'טלפון' },
      { key: 'barber_name', label: 'ספר' },
      { key: 'service_name', label: 'שירות' },
      { key: 'duration', label: 'משך (דק)' },
      { key: 'price', label: 'מחיר' },
      { key: 'status_he', label: 'סטטוס' },
      { key: 'notes', label: 'הערות' }
    ];

    const csv = toCsv(rows, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=appointments.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export appointments error:', err);
    res.status(500).json({ error: 'שגיאה בייצוא תורים' });
  }
});

// Export revenue CSV
router.get('/revenue', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const numMonths = parseInt(req.query.months) || 12;

    const rows = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

      // Revenue by barber for this month
      const barberRevenue = await db.prepare(`
        SELECT b.name as barber_name, COALESCE(SUM(a.price), 0) as revenue, COUNT(a.id) as count
        FROM barbers b
        LEFT JOIN appointments a ON a.barber_id = b.id AND a.date >= ? AND a.date < ? AND a.status = 'completed'
        WHERE b.active = 1 AND b.tenant_id = ?
        GROUP BY b.id, b.name
        ORDER BY b.name
      `).all(monthStart, monthEnd, tid);

      barberRevenue.forEach(br => {
        rows.push({
          month: `${d.getMonth() + 1}/${d.getFullYear()}`,
          barber_name: br.barber_name,
          count: br.count,
          revenue: br.revenue
        });
      });
    }

    const columns = [
      { key: 'month', label: 'חודש' },
      { key: 'barber_name', label: 'ספר' },
      { key: 'count', label: 'מספר תורים' },
      { key: 'revenue', label: 'הכנסות' }
    ];

    const csv = toCsv(rows, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=revenue.csv');
    res.send(csv);
  } catch (err) {
    console.error('Export revenue error:', err);
    res.status(500).json({ error: 'שגיאה בייצוא הכנסות' });
  }
});

module.exports = router;
