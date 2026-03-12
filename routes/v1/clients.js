const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireTenant);

// Loyalty tier logic
function getLoyaltyTier(totalVisits) {
  if (totalVisits >= 20) return { tier: 'gold', name: 'זהב', icon: 'crown', color: '#F59E0B' };
  if (totalVisits >= 10) return { tier: 'silver', name: 'כסף', icon: 'medal', color: '#9CA3AF' };
  if (totalVisits >= 3) return { tier: 'bronze', name: 'ארד', icon: 'award', color: '#CD7F32' };
  return { tier: 'new', name: 'חדש', icon: 'user', color: '#6B7280' };
}

// Days since last visit
function daysSinceVisit(lastVisit) {
  if (!lastVisit) return null;
  const last = new Date(lastVisit);
  const now = new Date();
  return Math.floor((now - last) / (1000 * 60 * 60 * 24));
}

// Get all clients (enriched)
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { search, vip, tier, sort } = req.query;

    let sql = 'SELECT * FROM clients WHERE tenant_id = $1';
    const params = [tid];
    let pi = 1;

    if (search) {
      const term = `%${search}%`;
      pi++; sql += ` AND (name LIKE $${pi}`;
      params.push(term);
      pi++; sql += ` OR phone LIKE $${pi}`;
      params.push(term);
      pi++; sql += ` OR email LIKE $${pi})`;
      params.push(term);
    }
    if (vip !== undefined) {
      pi++; sql += ` AND vip = $${pi}`;
      params.push(vip);
    }

    // Sort options
    if (sort === 'visits') sql += ' ORDER BY total_visits DESC';
    else if (sort === 'recent') sql += ' ORDER BY last_visit DESC NULLS LAST';
    else if (sort === 'name') sql += ' ORDER BY name';
    else sql += ' ORDER BY name';

    const result = await db.query(sql, params);

    // Enrich with loyalty data
    let clients = result.rows.map(c => {
      const loyalty = getLoyaltyTier(c.total_visits);
      const daysSince = daysSinceVisit(c.last_visit);
      const churnRisk = daysSince !== null && daysSince > 60 ? 'high' : daysSince !== null && daysSince > 30 ? 'medium' : 'low';
      return { ...c, loyalty, days_since_visit: daysSince, churn_risk: churnRisk };
    });

    // Filter by tier
    if (tier) {
      clients = clients.filter(c => c.loyalty.tier === tier);
    }

    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת לקוחות' });
  }
});

// Get single client with history + analytics
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const client = await db.prepare('SELECT * FROM clients WHERE id = ? AND tenant_id = ?').get(req.params.id, tid);
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    // Full history
    const history = await db.prepare(`
      SELECT a.*, b.name as barber_name, s.name as service_name
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      WHERE a.client_id = ? AND a.tenant_id = ?
      ORDER BY a.date DESC, a.start_time DESC
      LIMIT 50
    `).all(req.params.id, tid);

    // Preferred barber (most visits)
    const preferredBarber = await db.prepare(`
      SELECT b.id, b.name, COUNT(*) as visit_count
      FROM appointments a
      JOIN barbers b ON a.barber_id = b.id
      WHERE a.client_id = ? AND a.status = 'completed' AND a.tenant_id = ?
      GROUP BY b.id, b.name
      ORDER BY visit_count DESC
      LIMIT 1
    `).get(req.params.id, tid);

    // Preferred service (most booked)
    const preferredService = await db.prepare(`
      SELECT s.id, s.name, COUNT(*) as book_count
      FROM appointments a
      JOIN services s ON a.service_id = s.id
      WHERE a.client_id = ? AND a.status = 'completed' AND a.tenant_id = ?
      GROUP BY s.id, s.name
      ORDER BY book_count DESC
      LIMIT 1
    `).get(req.params.id, tid);

    // Total spent
    const spentResult = await db.prepare(
      "SELECT COALESCE(SUM(price), 0) as total_spent FROM appointments WHERE client_id = ? AND status = 'completed' AND tenant_id = ?"
    ).get(req.params.id, tid);

    // Average visit interval (days between visits)
    const completedDates = await db.prepare(
      "SELECT DISTINCT date FROM appointments WHERE client_id = ? AND status = 'completed' AND tenant_id = ? ORDER BY date"
    ).all(req.params.id, tid);

    let avgInterval = null;
    if (completedDates.length >= 2) {
      let totalDays = 0;
      for (let i = 1; i < completedDates.length; i++) {
        const d1 = new Date(completedDates[i - 1].date);
        const d2 = new Date(completedDates[i].date);
        totalDays += Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
      }
      avgInterval = Math.round(totalDays / (completedDates.length - 1));
    }

    // No-show rate
    const noShowCount = history.filter(h => h.status === 'no_show').length;
    const completedCount = history.filter(h => h.status === 'completed').length;
    const cancelledCount = history.filter(h => h.status === 'cancelled').length;

    const loyalty = getLoyaltyTier(client.total_visits);
    const daysSince = daysSinceVisit(client.last_visit);

    res.json({
      ...client,
      history,
      loyalty,
      days_since_visit: daysSince,
      preferred_barber: preferredBarber || null,
      preferred_service: preferredService || null,
      total_spent: spentResult.total_spent,
      avg_visit_interval: avgInterval,
      stats: {
        completed: completedCount,
        cancelled: cancelledCount,
        no_show: noShowCount,
        no_show_rate: completedCount + noShowCount > 0 ? Math.round((noShowCount / (completedCount + noShowCount)) * 100) : 0
      }
    });
  } catch (err) {
    console.error('Get client error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת לקוח' });
  }
});

// Create client
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { name, phone, email, notes, vip } = req.body;
    if (!name) return res.status(400).json({ error: 'שם הלקוח הוא שדה חובה' });

    const cleanPhone = phone ? phone.replace(/[-\s]/g, '') : '';

    const result = await db.prepare('INSERT INTO clients (tenant_id, name, phone, email, notes, vip) VALUES (?, ?, ?, ?, ?, ?)').run(
      tid, name.trim(), cleanPhone, email || '', notes || '', vip ? 1 : 0
    );

    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(client);
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת לקוח' });
  }
});

// Update client
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const { name, phone, email, notes, vip } = req.body;

    const existing = await db.prepare('SELECT * FROM clients WHERE id = ? AND tenant_id = ?').get(req.params.id, tid);
    if (!existing) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const cleanPhone = phone !== undefined ? phone.replace(/[-\s]/g, '') : undefined;

    await db.prepare(`
      UPDATE clients SET name = ?, phone = ?, email = ?, notes = ?, vip = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).run(name || existing.name, cleanPhone ?? existing.phone, email ?? existing.email, notes ?? existing.notes, vip !== undefined ? (vip ? 1 : 0) : existing.vip, req.params.id, tid);

    const updated = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון לקוח' });
  }
});

// Delete client
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const apptCount = await db.prepare("SELECT COUNT(*) as c FROM appointments WHERE client_id = ? AND status IN ('pending','confirmed') AND tenant_id = ?").get(req.params.id, tid);

    if (apptCount.c > 0) {
      return res.status(400).json({ error: 'לא ניתן למחוק לקוח עם תורים פעילים' });
    }

    await db.prepare('DELETE FROM clients WHERE id = ? AND tenant_id = ?').run(req.params.id, tid);
    res.json({ message: 'הלקוח נמחק בהצלחה' });
  } catch (err) {
    res.status(500).json({ error: 'שגיאה במחיקת לקוח' });
  }
});

module.exports = router;
