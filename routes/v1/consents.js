const express = require('express');
const router = express.Router();
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');

// Public: Log consent from booking page (no auth needed)
router.post('/booking', async (req, res) => {
  try {
    const db = getDb();
    const { client_name, client_phone, consent_text } = req.body;
    if (!consent_text) return res.status(400).json({ error: 'חסר טקסט הסכמה' });

    await db.prepare(`
      INSERT INTO consents (consent_type, entity_type, entity_name, entity_phone, ip_address, user_agent, consent_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'booking_privacy',
      'client',
      client_name || '',
      client_phone || '',
      req.ip || req.connection.remoteAddress || '',
      req.headers['user-agent'] || '',
      consent_text
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Consent booking error:', err);
    res.status(500).json({ error: 'שגיאה בשמירת הסכמה' });
  }
});

// Authenticated: Log terms-of-use consent on first login
router.post('/terms', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const { consent_text } = req.body;
    if (!consent_text) return res.status(400).json({ error: 'חסר טקסט הסכמה' });

    await db.prepare(`
      INSERT INTO consents (consent_type, entity_type, entity_id, entity_name, ip_address, user_agent, consent_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'terms_of_use',
      'user',
      req.user.id,
      req.user.display_name,
      req.ip || req.connection.remoteAddress || '',
      req.headers['user-agent'] || '',
      consent_text
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Consent terms error:', err);
    res.status(500).json({ error: 'שגיאה בשמירת הסכמה' });
  }
});

// Check if current user has accepted terms
router.get('/check', authenticateToken, async (req, res) => {
  try {
    const db = getDb();
    const consent = await db.prepare(
      "SELECT id FROM consents WHERE consent_type = 'terms_of_use' AND entity_type = 'user' AND entity_id = ? LIMIT 1"
    ).get(req.user.id);
    res.json({ accepted: !!consent });
  } catch (err) {
    res.json({ accepted: false });
  }
});

// Admin: View consent logs
router.get('/log', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const db = getDb();
    const { type, page } = req.query;
    const limit = 50;
    const offset = ((parseInt(page) || 1) - 1) * limit;

    let sql = 'SELECT * FROM consents';
    const params = [];

    if (type) {
      sql += ' WHERE consent_type = ?';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const consents = await db.prepare(sql).all(...params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as c FROM consents';
    const countParams = [];
    if (type) {
      countSql += ' WHERE consent_type = ?';
      countParams.push(type);
    }
    const total = (await db.prepare(countSql).get(...countParams)).c;

    res.json({ consents, total, page: parseInt(page) || 1, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Consent log error:', err);
    res.status(500).json({ error: 'שגיאה בטעינת יומן הסכמות' });
  }
});

module.exports = router;
