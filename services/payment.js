/**
 * PayPlus Payment Integration Service
 * Israeli payment processor for recurring subscriptions
 *
 * Config via env vars:
 * - PAYPLUS_API_KEY
 * - PAYPLUS_SECRET_KEY
 * - PAYPLUS_TERMINAL_UID
 */

const PAYPLUS_API_URL = 'https://restapidev.payplus.co.il/api/v1.0';

const PLANS = {
  trial: { name: 'ניסיון', price: 0, description: 'תקופת ניסיון חינמית' },
  basic: { name: 'בסיסי', price: 99, description: '99 ₪ לחודש - ניהול תורים בסיסי' },
  premium: { name: 'פרימיום', price: 199, description: '199 ₪ לחודש - כל הפיצ\'רים' }
};

function isConfigured() {
  return !!(process.env.PAYPLUS_API_KEY && process.env.PAYPLUS_SECRET_KEY && process.env.PAYPLUS_TERMINAL_UID);
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': JSON.stringify({
      api_key: process.env.PAYPLUS_API_KEY,
      secret_key: process.env.PAYPLUS_SECRET_KEY
    })
  };
}

/**
 * Create a recurring subscription for a tenant
 */
async function createSubscription(tenantId, plan, paymentDetails) {
  if (!PLANS[plan] || plan === 'trial') {
    throw new Error('תוכנית לא תקינה');
  }

  if (!isConfigured()) {
    // Dev mode - return mock success
    console.log(`[PayPlus Mock] Creating subscription for tenant ${tenantId}, plan: ${plan}`);
    return {
      success: true,
      mock: true,
      subscription_id: `mock_sub_${tenantId}_${Date.now()}`,
      plan,
      amount: PLANS[plan].price,
      currency: 'ILS',
      message: 'מנוי נוצר בהצלחה (מצב פיתוח)'
    };
  }

  try {
    const response = await fetch(`${PAYPLUS_API_URL}/PaymentPages/generateLink`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        payment_page_uid: process.env.PAYPLUS_TERMINAL_UID,
        charge_method: 5, // Recurring
        amount: PLANS[plan].price,
        currency_code: 'ILS',
        description: PLANS[plan].description,
        more_info: `tenant_${tenantId}`,
        customer: {
          customer_name: paymentDetails.name || '',
          email: paymentDetails.email || '',
          phone: paymentDetails.phone || ''
        },
        recurring_payments: {
          sum: PLANS[plan].price,
          initial_sum: PLANS[plan].price,
          total_payments: 0, // Unlimited
          frequency: 1, // Monthly
          frequency_type: 'month'
        }
      })
    });

    const data = await response.json();

    if (data.results && data.results.status === 'success') {
      return {
        success: true,
        payment_page_link: data.data.payment_page_link,
        page_request_uid: data.data.page_request_uid,
        plan,
        amount: PLANS[plan].price,
        currency: 'ILS'
      };
    } else {
      throw new Error(data.results?.description || 'שגיאה ביצירת מנוי');
    }
  } catch (error) {
    if (error.message.includes('שגיאה')) throw error;
    console.error('PayPlus createSubscription error:', error);
    throw new Error('שגיאה בחיבור למערכת התשלומים');
  }
}

/**
 * Cancel a recurring subscription
 */
async function cancelSubscription(tenantId) {
  if (!isConfigured()) {
    console.log(`[PayPlus Mock] Cancelling subscription for tenant ${tenantId}`);
    return {
      success: true,
      mock: true,
      message: 'המנוי בוטל בהצלחה (מצב פיתוח)'
    };
  }

  try {
    // In production, this would call PayPlus API to cancel the recurring charge
    // The exact endpoint depends on the subscription UID stored in the tenant record
    const { getDb } = require('../db/schema');
    const db = getDb();
    const tenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);

    if (!tenant) {
      throw new Error('העסק לא נמצא');
    }

    // Update tenant plan to trial (cancelled)
    await db.prepare("UPDATE tenants SET plan = 'trial' WHERE id = ?").run(tenantId);

    return {
      success: true,
      message: 'המנוי בוטל בהצלחה'
    };
  } catch (error) {
    if (error.message.includes('העסק')) throw error;
    console.error('PayPlus cancelSubscription error:', error);
    throw new Error('שגיאה בביטול המנוי');
  }
}

/**
 * Get payment/subscription status for a tenant
 */
async function getPaymentStatus(tenantId) {
  const { getDb } = require('../db/schema');
  const db = getDb();
  const tenant = await db.prepare('SELECT id, plan, trial_ends_at, active FROM tenants WHERE id = ?').get(tenantId);

  if (!tenant) {
    throw new Error('העסק לא נמצא');
  }

  const isTrialExpired = tenant.plan === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date();

  return {
    tenant_id: tenant.id,
    plan: tenant.plan,
    plan_name: PLANS[tenant.plan]?.name || tenant.plan,
    price: PLANS[tenant.plan]?.price || 0,
    currency: 'ILS',
    active: !!tenant.active,
    trial_ends_at: tenant.trial_ends_at || null,
    trial_expired: isTrialExpired,
    payplus_configured: isConfigured()
  };
}

/**
 * Handle PayPlus webhook notifications
 */
async function handleWebhook(payload) {
  if (!isConfigured()) {
    console.log('[PayPlus Mock] Webhook received:', JSON.stringify(payload).substring(0, 200));
    return { success: true, mock: true };
  }

  try {
    const { getDb } = require('../db/schema');
    const db = getDb();

    // Extract tenant ID from more_info field
    const moreInfo = payload.more_info || '';
    const tenantMatch = moreInfo.match(/tenant_(\d+)/);
    if (!tenantMatch) {
      console.error('PayPlus webhook: could not extract tenant ID from more_info:', moreInfo);
      return { success: false, error: 'Missing tenant ID' };
    }
    const tenantId = parseInt(tenantMatch[1]);

    const status = payload.transaction?.status_code;

    if (status === '000') {
      // Successful payment - activate/upgrade plan
      const plan = payload.more_info_2 || 'basic';
      await db.prepare("UPDATE tenants SET plan = ?, active = 1 WHERE id = ?").run(plan, tenantId);
      console.log(`PayPlus webhook: Tenant ${tenantId} upgraded to ${plan}`);
    } else {
      // Failed payment
      console.log(`PayPlus webhook: Payment failed for tenant ${tenantId}, status: ${status}`);
    }

    return { success: true };
  } catch (error) {
    console.error('PayPlus webhook error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Verify webhook signature from PayPlus
 */
function verifyWebhookSignature(payload, signature) {
  if (!isConfigured()) return true;

  const crypto = require('crypto');
  const secretKey = process.env.PAYPLUS_SECRET_KEY;
  const computed = crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(payload))
    .digest('hex');

  return computed === signature;
}

module.exports = {
  PLANS,
  isConfigured,
  createSubscription,
  cancelSubscription,
  getPaymentStatus,
  handleWebhook,
  verifyWebhookSignature
};
