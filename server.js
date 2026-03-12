require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./db/schema');
const { resolveTenantBySlug } = require('./middleware/tenant');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
// No cache for HTML/JS/CSS so updates show immediately
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'יותר מדי בקשות, נסה שוב מאוחר יותר' }
});
app.use('/api/', limiter);

// Public booking routes - with tenant slug
app.use('/api/booking/:slug', resolveTenantBySlug, require('./routes/v1/booking'));

// Public booking routes - default tenant (backwards compatible)
app.use('/api/booking', (req, res, next) => {
  // Default to tenant_id 1 for backwards compatibility
  req.tenantId = 1;
  next();
}, require('./routes/v1/booking'));

// Routes (all use tenant_id from JWT via requireTenant middleware)
app.use('/api/auth', require('./routes/v1/auth'));
app.use('/api/appointments', require('./routes/v1/appointments'));
app.use('/api/barbers', require('./routes/v1/barbers'));
app.use('/api/clients', require('./routes/v1/clients'));
app.use('/api/services', require('./routes/v1/services'));
app.use('/api/dashboard', require('./routes/v1/dashboard'));
app.use('/api/settings', require('./routes/v1/settings'));
app.use('/api/export', require('./routes/v1/export'));
app.use('/api/consents', require('./routes/v1/consents'));
app.use('/api/tenants', require('./routes/v1/tenants'));

// Serve booking page for tenant slug: /book/:slug
app.get('/book/:slug', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'שגיאת שרת פנימית' });
});

// Init DB (async) then start server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Barber Appointments Server running on port ${PORT}`);
    console.log(`http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
