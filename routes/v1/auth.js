const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb, createTenant } = require('../../db/schema');
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

// Public registration - create new tenant (shop)
router.post('/register', async (req, res) => {
  try {
    const { shop_name, owner_name, owner_phone, owner_email, admin_username, admin_password } = req.body;

    // Validate required fields
    if (!shop_name || !owner_name || !owner_phone || !owner_email || !admin_username || !admin_password) {
      return res.status(400).json({ error: 'נא למלא את כל השדות הנדרשים' });
    }

    // Validate phone format (Israeli)
    const cleanPhone = owner_phone.replace(/[-\s]/g, '');
    if (!/^0[2-9]\d{7,8}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    }

    // Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner_email)) {
      return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });
    }

    // Validate username (alphanumeric, 3-30 chars)
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(admin_username)) {
      return res.status(400).json({ error: 'שם משתמש חייב להכיל 3-30 תווים באנגלית, מספרים או קו תחתון' });
    }

    // Validate password (min 6 chars)
    if (admin_password.length < 6) {
      return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    }

    const db = getDb();

    // Check if username already exists
    const existingUser = await db.prepare('SELECT id FROM users WHERE username = ?').get(admin_username);
    if (existingUser) {
      return res.status(409).json({ error: 'שם המשתמש כבר תפוס. נא לבחור שם משתמש אחר.' });
    }

    // Generate slug from phone number
    let slug = cleanPhone;

    // Check if slug already exists, append number if needed
    let slugExists = await db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
    let counter = 1;
    while (slugExists) {
      slug = `${cleanPhone}-${counter}`;
      slugExists = await db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
      counter++;
    }

    // Create tenant using existing createTenant function
    const tenant = await createTenant({
      slug,
      name: shop_name,
      ownerName: owner_name,
      ownerEmail: owner_email,
      ownerPhone: owner_phone,
      adminUsername: admin_username,
      adminPassword: admin_password
    });

    res.status(201).json({
      message: 'העסק נרשם בהצלחה!',
      tenant: {
        id: tenant.id,
        slug: tenant.slug
      },
      login_url: '/login',
      booking_url: `/book/${tenant.slug}`,
      username: admin_username
    });
  } catch (err) {
    console.error('Registration error:', err);
    if (err.code === '23505') {
      // Unique constraint violation
      return res.status(409).json({ error: 'העסק או שם המשתמש כבר קיימים במערכת' });
    }
    res.status(500).json({ error: 'שגיאה ברישום. נסה שוב מאוחר יותר.' });
  }
});

module.exports = router;
