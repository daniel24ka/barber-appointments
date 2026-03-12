const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../../db/schema');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../public/uploads/logos');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `tenant_${req.tenantId}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('סוג קובץ לא נתמך. יש להעלות תמונה בפורמט JPG, PNG, SVG או WEBP'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// POST /api/upload/logo - Upload tenant logo
router.post('/logo', authenticateToken, requireRole('admin'), requireTenant, (req, res) => {
  upload.single('logo')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'הקובץ גדול מדי. גודל מקסימלי 2MB' });
        }
        return res.status(400).json({ error: 'שגיאה בהעלאת הקובץ' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'לא נבחר קובץ' });
    }

    try {
      const db = getDb();
      const logoUrl = `/uploads/logos/${req.file.filename}`;

      // Delete old logo file if exists
      const tenant = await db.prepare('SELECT logo_url FROM tenants WHERE id = ?').get(req.tenantId);
      if (tenant && tenant.logo_url) {
        const oldPath = path.join(__dirname, '../../public', tenant.logo_url);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      // Update tenant record
      await db.prepare('UPDATE tenants SET logo_url = ? WHERE id = ?').run(logoUrl, req.tenantId);

      res.json({ logo_url: logoUrl, message: 'הלוגו עודכן בהצלחה' });
    } catch (error) {
      console.error('Logo upload error:', error);
      res.status(500).json({ error: 'שגיאה בשמירת הלוגו' });
    }
  });
});

module.exports = router;
