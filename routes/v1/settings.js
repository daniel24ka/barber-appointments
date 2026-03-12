const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

router.use(authenticateToken);
router.use(requireTenant);

// Get all settings
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare('SELECT * FROM settings WHERE tenant_id = ?').all(req.tenantId);
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });

    // Include tenant branding fields
    const tenant = await db.prepare('SELECT logo_url, primary_color FROM tenants WHERE id = ?').get(req.tenantId);
    if (tenant) {
      settings.logo_url = tenant.logo_url || '';
      settings.primary_color = tenant.primary_color || '#4F46E5';
    }

    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות' });
  }
});

// Update settings
router.put('/', requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const tid = req.tenantId;
    const updates = { ...req.body };

    // Extract tenant-level branding fields (stored in tenants table, not settings)
    const { primary_color, logo_url, ...settingsUpdates } = updates;

    // Update tenant branding if provided
    if (primary_color !== undefined || logo_url !== undefined) {
      const setClauses = [];
      const params = [];
      if (primary_color !== undefined) {
        setClauses.push('primary_color = ?');
        params.push(primary_color);
      }
      if (logo_url !== undefined) {
        setClauses.push('logo_url = ?');
        params.push(logo_url);
      }
      if (setClauses.length > 0) {
        params.push(tid);
        await db.prepare(`UPDATE tenants SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
      }
    }

    // Update key-value settings
    for (const [key, value] of Object.entries(settingsUpdates)) {
      await db.prepare('INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?) ON CONFLICT (tenant_id, key) DO UPDATE SET value = ?').run(tid, key, String(value), String(value));
    }

    res.json({ message: 'ההגדרות עודכנו בהצלחה' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'שגיאה בעדכון הגדרות' });
  }
});

module.exports = router;
