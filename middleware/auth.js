const jwt = require('jsonwebtoken');

// JWT_SECRET is loaded asynchronously from the database on startup
// to ensure it persists across Railway deploys
let JWT_SECRET = null;

async function initJwtSecret() {
  const { getOrCreateJwtSecret } = require('../db/schema');
  JWT_SECRET = await getOrCreateJwtSecret();
}

function getSecret() {
  if (!JWT_SECRET) {
    // Fallback: should not happen after init, but just in case
    const crypto = require('crypto');
    JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    console.warn('WARNING: JWT_SECRET used before initialization');
  }
  return JWT_SECRET;
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      tenant_id: user.tenant_id || null
    },
    getSecret(),
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
    const decoded = jwt.verify(token, getSecret());
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

module.exports = { generateToken, authenticateToken, requireRole, initJwtSecret };
