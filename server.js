require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./db/schema');
const { resolveTenantBySlug } = require('./middleware/tenant');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// HTTPS redirect in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Static files with smart caching
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|ico|svg|woff2?)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days for assets
    }
  }
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי בקשות, נסה שוב מאוחר יותר' }
});
app.use('/api/', apiLimiter);

// Stricter rate limit for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי ניסיונות התחברות. נסה שוב בעוד 15 דקות.' }
});
app.use('/api/auth/login', loginLimiter);

// Stricter rate limit for public booking
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי הזמנות. נסה שוב מאוחר יותר.' }
});
app.use('/api/booking/*/book', bookingLimiter);

// Public booking routes - with tenant slug
app.use('/api/booking/:slug', resolveTenantBySlug, require('./routes/v1/booking'));

// Public booking routes - default tenant (backwards compatible)
app.use('/api/booking', (req, res, next) => {
  req.tenantId = 1;
  next();
}, require('./routes/v1/booking'));

// Authenticated routes
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

// Serve booking page for tenant slug
app.get('/book/:slug', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'book.html'));
});

// Landing page
app.get('/landing', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'שגיאת שרת פנימית' : err.message });
});

// Validate required env vars
function validateEnv() {
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    console.error('Missing required environment variable: DATABASE_URL');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.warn('WARNING: JWT_SECRET not set. Using random key (tokens will reset on restart).');
  }
}

// Init
validateEnv();
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DaniTech Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
