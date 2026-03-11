require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'יותר מדי בקשות, נסה שוב מאוחר יותר' }
});
app.use('/api/', limiter);

// Public booking routes (no auth required)
app.use('/api/booking', require('./routes/v1/booking'));

// Routes
app.use('/api/auth', require('./routes/v1/auth'));
app.use('/api/appointments', require('./routes/v1/appointments'));
app.use('/api/barbers', require('./routes/v1/barbers'));
app.use('/api/clients', require('./routes/v1/clients'));
app.use('/api/services', require('./routes/v1/services'));
app.use('/api/dashboard', require('./routes/v1/dashboard'));
app.use('/api/settings', require('./routes/v1/settings'));

// SPA fallback
app.get('*', (req, res) => {
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
