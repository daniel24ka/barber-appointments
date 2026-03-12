const jwt = require('jsonwebtoken');

const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      tenant_id: user.tenant_id || null
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    // Set tenantId for convenience (super_admin may not have one)
    if (decoded.tenant_id) {
      req.tenantId = decoded.tenant_id;
    }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'טוקן לא תקין או פג תוקף' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'נדרשת התחברות' });
    }
    // super_admin has access to everything
    if (req.user.role === 'super_admin') {
      return next();
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
    }
    next();
  };
}

module.exports = { generateToken, authenticateToken, requireRole, JWT_SECRET };
