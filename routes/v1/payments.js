const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { requireTenant } = require('../../middleware/tenant');
const payment = require('../../services/payment');

// POST /api/payments/subscribe - Initiate subscription
router.post('/subscribe', authenticateToken, requireRole('admin'), requireTenant, async (req, res) => {
  try {
    const { plan, name, email, phone } = req.body;

    if (!plan || !['basic', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'יש לבחור תוכנית תקינה (basic או premium)' });
    }

    const result = await payment.createSubscription(req.tenantId, plan, {
      name: name || '',
      email: email || '',
      phone: phone || ''
    });

    res.json(result);
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: error.message || 'שגיאה ביצירת מנוי' });
  }
});

// POST /api/payments/cancel - Cancel subscription
router.post('/cancel', authenticateToken, requireRole('admin'), requireTenant, async (req, res) => {
  try {
    const result = await payment.cancelSubscription(req.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: error.message || 'שגיאה בביטול מנוי' });
  }
});

// GET /api/payments/status - Get payment status
router.get('/status', authenticateToken, requireRole('admin'), requireTenant, async (req, res) => {
  try {
    const result = await payment.getPaymentStatus(req.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ error: error.message || 'שגיאה בבדיקת סטטוס תשלום' });
  }
});

// POST /api/payments/webhook - PayPlus webhook handler (no auth, verify signature)
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['payplus-signature'] || req.headers['x-payplus-signature'] || '';

    // Verify webhook signature
    if (!payment.verifyWebhookSignature(req.body, signature)) {
      console.error('PayPlus webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await payment.handleWebhook(req.body);
    res.json(result);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
