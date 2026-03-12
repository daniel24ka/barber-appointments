const express = require('express');
const router = express.Router();
const { getDb, createTenant } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');

// All routes require super_admin
router.use(authenticateToken);
router.use(requireRole('super_admin'));

// List all tenants
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const tenants = await db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();

    // Enrich with stats
    const enriched = [];
    for (const t of tenants) {
      const users = (await db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(t.id)).c;
      const clients = (await db.prepare('SELECT COUNT(*) as c FROM clients WHERE tenant_id = ?').get(t.id)).c;
      const appointments = (await db.prepare('SELECT COUNT(*) as c FROM appointments WHERE tenant_id = ?').get(t.id)).c;
      enriched.push({ ...t, stats: { users, clients, appointments } });
    }

    res.json(enriched);
  } catch (err) {
    console.error('List tenants error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת עסקים' });
  }
});

// Get single tenant
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'עסק לא נמצא' });

    const users = await db.prepare('SELECT id, username, role, display_name, active, created_at FROM users WHERE tenant_id = ?').all(tenant.id);
    const clientCount = (await db.prepare('SELECT COUNT(*) as c FROM clients WHERE tenant_id = ?').get(tenant.id)).c;
    const appointmentCount = (await db.prepare('SELECT COUNT(*) as c FROM appointments WHERE tenant_id = ?').get(tenant.id)).c;
    const monthRevenue = (await db.prepare(`
      SELECT COALESCE(SUM(price), 0) as total FROM appointments
      WHERE tenant_id = ? AND status = 'completed' AND date >= ?
    `).get(tenant.id, new Date().toISOString().substring(0, 7) + '-01')).total;

    res.json({
      ...tenant,
      users,
      stats: { clients: clientCount, appointments: appointmentCount, monthRevenue }
    });
  } catch (err) {
    console.error('Get tenant error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת עסק' });
  }
});

// Create new tenant
router.post('/', async (req, res) => {
  try {
    const { slug, name, owner_name, owner_email, owner_phone, admin_username, admin_password } = req.body;

    if (!slug || !name || !admin_username || !admin_password) {
      return res.status(400).json({ error: 'חסרים שדות חובה: slug, name, admin_username, admin_password' });
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'ה-slug יכול להכיל רק אותיות קטנות באנגלית, מספרים ומקפים' });
    }

    // Check slug uniqueness
    const db = getDb();
    const existing = await db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: 'ה-slug כבר קיים' });
    }

    const result = await createTenant({
      slug,
      name,
      ownerName: owner_name || name,
      ownerEmail: owner_email || '',
      ownerPhone: owner_phone || '',
      adminUsername: admin_username,
      adminPassword: admin_password
    });

    res.status(201).json({
      message: 'העסק נוצר בהצלחה',
      tenant: result,
      bookingUrl: `/book/${slug}`
    });
  } catch (err) {
    console.error('Create tenant error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת עסק' });
  }
});

// Update tenant
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { name, owner_name, owner_email, owner_phone, logo_url, primary_color, plan, active } = req.body;

    const existing = await db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'עסק לא נמצא' });

    await db.prepare(`
      UPDATE tenants SET name = ?, owner_name = ?, owner_email = ?, owner_phone = ?,
      logo_url = ?, primary_color = ?, plan = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      owner_name ?? existing.owner_name,
      owner_email ?? existing.owner_email,
      owner_phone ?? existing.owner_phone,
      logo_url ?? existing.logo_url,
      primary_color || existing.primary_color,
      plan || existing.plan,
      active !== undefined ? active : existing.active,
      req.params.id
    );

    const updated = await db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update tenant error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון עסק' });
  }
});

// Deactivate tenant
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'עסק לא נמצא' });
    if (tenant.slug === 'default') return res.status(400).json({ error: 'לא ניתן למחוק את העסק הראשי' });

    await db.prepare('UPDATE tenants SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ message: 'העסק הושבת בהצלחה' });
  } catch (err) {
    console.error('Delete tenant error:', err);
    res.status(500).json({ error: 'שגיאה בהשבתת עסק' });
  }
});

module.exports = router;
