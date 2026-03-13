const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
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

    // Audit log
    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, 'create_tenant', 'tenant', ?, ?)`).run(req.user.id, result.id, `Created tenant "${name}" (${slug})`);

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

    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, 'update_tenant', 'tenant', ?, ?)`).run(req.user.id, req.params.id, `Updated tenant "${updated.name}"`);

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

    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, 'deactivate_tenant', 'tenant', ?, ?)`).run(req.user.id, req.params.id, `Deactivated tenant "${tenant.name}"`);

    res.json({ message: 'העסק הושבת בהצלחה' });
  } catch (err) {
    console.error('Delete tenant error:', err);
    res.status(500).json({ error: 'שגיאה בהשבתת עסק' });
  }
});

// Get users for a specific tenant
router.get('/:id/users', async (req, res) => {
  try {
    const db = getDb();
    const users = await db.prepare(`
      SELECT id, username, role, display_name, email, phone, active, created_at, updated_at
      FROM users WHERE tenant_id = ? ORDER BY role, display_name
    `).all(req.params.id);
    res.json(users);
  } catch (err) {
    console.error('Get tenant users error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת משתמשים' });
  }
});

// Reset tenant user password
router.post('/:id/users/:userId/reset-password', async (req, res) => {
  try {
    const db = getDb();
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    }
    const user = await db.prepare('SELECT id, tenant_id FROM users WHERE id = ? AND tenant_id = ?').get(req.params.userId, req.params.id);
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

    const hashed = bcrypt.hashSync(newPassword, 10);
    await db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashed, req.params.userId);

    // Log action
    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, 'reset_password', 'user', ?, ?)`).run(req.user.id, req.params.userId, `Reset password for user in tenant ${req.params.id}`);

    res.json({ message: 'הסיסמה אופסה בהצלחה' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'שגיאה באיפוס סיסמה' });
  }
});

// Toggle user active status
router.post('/:id/users/:userId/toggle-active', async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare('SELECT id, active, tenant_id FROM users WHERE id = ? AND tenant_id = ?').get(req.params.userId, req.params.id);
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

    const newActive = user.active ? 0 : 1;
    await db.prepare('UPDATE users SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newActive, req.params.userId);

    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, ?, 'user', ?, ?)`).run(req.user.id, newActive ? 'activate_user' : 'deactivate_user', req.params.userId, `Tenant ${req.params.id}`);

    res.json({ message: newActive ? 'המשתמש הופעל' : 'המשתמש הושבת', active: newActive });
  } catch (err) {
    console.error('Toggle user error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון משתמש' });
  }
});

// Create user for tenant
router.post('/:id/users', async (req, res) => {
  try {
    const db = getDb();
    const { username, password, role, display_name, email, phone } = req.body;
    if (!username || !password || !role || !display_name) {
      return res.status(400).json({ error: 'חסרים שדות חובה' });
    }
    if (!['admin', 'barber'].includes(role)) {
      return res.status(400).json({ error: 'תפקיד לא תקין' });
    }
    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'שם משתמש כבר קיים' });

    const hashed = bcrypt.hashSync(password, 10);
    const result = await db.prepare(`
      INSERT INTO users (tenant_id, username, password, role, display_name, email, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, username, hashed, role, display_name, email || null, phone || null);

    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, 'create_user', 'user', ?, ?)`).run(req.user.id, result.lastInsertRowid, `Created ${role} user "${username}" for tenant ${req.params.id}`);

    res.status(201).json({ message: 'המשתמש נוצר בהצלחה', id: result.lastInsertRowid });
  } catch (err) {
    console.error('Create tenant user error:', err);
    res.status(500).json({ error: 'שגיאה ביצירת משתמש' });
  }
});

// Update tenant trial_ends_at
router.post('/:id/set-trial', async (req, res) => {
  try {
    const db = getDb();
    const { trial_ends_at } = req.body;
    await db.prepare('UPDATE tenants SET trial_ends_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(trial_ends_at, req.params.id);

    await db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details)
      VALUES (?, 'update_trial', 'tenant', ?, ?)`).run(req.user.id, req.params.id, `Trial set to ${trial_ends_at}`);

    res.json({ message: 'תקופת הניסיון עודכנה' });
  } catch (err) {
    console.error('Set trial error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון ניסיון' });
  }
});

// Admin audit log - get recent actions
router.get('/system/audit-log', async (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const logs = await db.prepare(`
      SELECT l.*, u.display_name as admin_name
      FROM admin_audit_log l
      LEFT JOIN users u ON l.admin_user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(logs);
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת לוג' });
  }
});

// System health stats
router.get('/system/health', async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    // Trials expiring in next 7 days
    const expiringTrials = await db.prepare(`
      SELECT id, name, slug, owner_name, owner_phone, trial_ends_at
      FROM tenants WHERE plan = 'trial' AND active = 1
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ORDER BY trial_ends_at ASC
    `).all();

    // Expired trials still active
    const expiredTrials = await db.prepare(`
      SELECT id, name, slug, owner_name, trial_ends_at
      FROM tenants WHERE plan = 'trial' AND active = 1
      AND trial_ends_at IS NOT NULL AND trial_ends_at < NOW()
    `).all();

    // Inactive tenants
    const inactiveTenants = await db.prepare(`
      SELECT id, name, slug, owner_name FROM tenants WHERE active = 0
    `).all();

    // Recent registrations (last 30 days)
    const recentRegistrations = await db.prepare(`
      SELECT id, name, slug, owner_name, plan, created_at
      FROM tenants WHERE created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
    `).all();

    // Monthly revenue trend (last 6 months)
    const revenueTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      const nextMonth = new Date(d.getFullYear(), d.getMonth()+1, 1);
      const me = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}-01`;
      const row = await db.prepare("SELECT COALESCE(SUM(price),0) as revenue, COUNT(*) as count FROM appointments WHERE date >= ? AND date < ? AND status = 'completed'").get(ms, me);
      revenueTrend.push({ month: ms.substring(0,7), revenue: row.revenue, appointments: row.count });
    }

    // New tenants per month (last 6 months)
    const tenantGrowth = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      const nextMonth = new Date(d.getFullYear(), d.getMonth()+1, 1);
      const me = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}-01`;
      const row = await db.prepare("SELECT COUNT(*) as c FROM tenants WHERE created_at >= ? AND created_at < ?").get(ms, me);
      tenantGrowth.push({ month: ms.substring(0,7), count: row.c });
    }

    res.json({ expiringTrials, expiredTrials, inactiveTenants, recentRegistrations, revenueTrend, tenantGrowth });
  } catch (err) {
    console.error('System health error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת נתוני מערכת' });
  }
});

module.exports = router;
