const { getDb } = require('../db/schema');

// Resolve tenant from slug (for public booking routes)
function resolveTenantBySlug(req, res, next) {
  const slug = req.params.slug;
  if (!slug) {
    return res.status(400).json({ error: 'חסר מזהה עסק' });
  }

  const db = getDb();
  db.prepare("SELECT * FROM tenants WHERE slug = ? AND active = 1").get(slug)
    .then(tenant => {
      if (!tenant) {
        return res.status(404).json({ error: 'העסק לא נמצא' });
      }
      // Check trial expiry
      if (tenant.plan === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date()) {
        return res.status(403).json({ error: 'תקופת הניסיון הסתיימה' });
      }
      req.tenant = tenant;
      req.tenantId = tenant.id;
      next();
    })
    .catch(err => {
      console.error('Tenant resolution error:', err);
      res.status(500).json({ error: 'שגיאת שרת' });
    });
}

// Inject tenant_id from authenticated user's JWT token
function requireTenant(req, res, next) {
  if (req.user && req.user.role === 'super_admin') {
    // Super admin can specify tenant_id via query, or falls back to their own tenant_id (1)
    req.tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id) : (req.user.tenant_id || 1);
    return next();
  }

  if (!req.user || !req.user.tenant_id) {
    return res.status(400).json({ error: 'חסר מזהה עסק' });
  }

  req.tenantId = req.user.tenant_id;
  next();
}

module.exports = { resolveTenantBySlug, requireTenant };
