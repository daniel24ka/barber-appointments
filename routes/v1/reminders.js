const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { sendWhatsAppReminder, processReminders, getReminderStats } = require('../../services/reminders');

// GET /api/reminders/status - Reminder stats (admin only)
router.get('/status', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const stats = await getReminderStats();
    res.json(stats);
  } catch (err) {
    console.error('Reminder status error:', err);
    res.status(500).json({ error: 'שגיאה בקבלת סטטוס תזכורות' });
  }
});

// GET /api/reminders/test - Send a test WhatsApp message (admin only)
router.get('/test', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ error: 'נא לציין מספר טלפון בפרמטר phone' });
    }

    const result = await sendWhatsAppReminder(phone, {
      barberName: 'ספר לדוגמה',
      date: new Date().toISOString().split('T')[0],
      time: '14:00',
      serviceName: 'תספורת לדוגמה',
      shopName: 'המספרה שלך'
    });

    if (result.success) {
      res.json({ message: 'הודעת טסט נשלחה בהצלחה', phone });
    } else {
      res.status(400).json({ error: 'שליחה נכשלה', details: result.error });
    }
  } catch (err) {
    console.error('Test reminder error:', err);
    res.status(500).json({ error: 'שגיאה בשליחת הודעת טסט' });
  }
});

// POST /api/reminders/run - Manually trigger reminder processing (admin only)
router.post('/run', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await processReminders();
    res.json({ message: 'עיבוד תזכורות הושלם', ...result });
  } catch (err) {
    console.error('Manual reminder run error:', err);
    res.status(500).json({ error: 'שגיאה בעיבוד תזכורות' });
  }
});

module.exports = router;
