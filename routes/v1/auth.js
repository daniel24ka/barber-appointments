const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/schema');
const { generateToken, authenticateToken } = require('../../middleware/auth');

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'נא להזין שם משתמש וסיסמה' });
    }

    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    // Check tenant is active (skip for super_admin)
    if (user.role !== 'super_admin' && user.tenant_id) {
      const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ? AND active = 1').get(user.tenant_id);
      if (!tenant) {
        return res.status(403).json({ error: 'העסק לא פעיל' });
      }
      if (tenant.plan === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date()) {
        return res.status(403).json({ error: 'תקופת הניסיון הסתיימה. פנה למנהל המערכת.' });
      }
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        tenant_id: user.tenant_id
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(400).json({ error: 'סיסמה נוכחית שגויה' });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    await db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashed, req.user.id);
    res.json({ message: 'הסיסמה שונתה בהצלחה' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
