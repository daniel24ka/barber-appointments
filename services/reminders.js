const { getDb } = require('../db/schema');
const { sendReminderEmail } = require('./email');

const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * Format Israeli phone number to international format (+972...)
 */
function formatPhoneInternational(phone) {
  if (!phone) return null;
  let clean = phone.replace(/[-\s()]/g, '');
  // Already international
  if (clean.startsWith('+972')) return clean;
  if (clean.startsWith('972')) return '+' + clean;
  // Local format: 05x -> +9725x
  if (clean.startsWith('0')) {
    return '+972' + clean.substring(1);
  }
  return '+972' + clean;
}

/**
 * Send a WhatsApp reminder to a single client
 * Returns { success: boolean, error?: string }
 */
async function sendWhatsAppReminder(phone, appointmentDetails) {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn('[WhatsApp] API not configured (WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing). Skipping.');
    return { success: false, error: 'WhatsApp API not configured' };
  }

  const internationalPhone = formatPhoneInternational(phone);
  if (!internationalPhone) {
    return { success: false, error: 'Invalid phone number' };
  }

  const { barberName, date, time, serviceName, shopName } = appointmentDetails;

  try {
    const response = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: internationalPhone.replace('+', ''),
        type: 'template',
        template: {
          name: 'appointment_reminder',
          language: { code: 'he' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: shopName || 'המספרה' },
                { type: 'text', text: barberName || '' },
                { type: 'text', text: date || '' },
                { type: 'text', text: time || '' },
                { type: 'text', text: serviceName || '' }
              ]
            }
          ]
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[WhatsApp] API error:', response.status, errorData);
      return { success: false, error: `API returned ${response.status}` };
    }

    const data = await response.json();
    console.log(`[WhatsApp] Reminder sent to ${internationalPhone} - message id: ${data.messages?.[0]?.id || 'unknown'}`);
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] Send error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Process all pending reminders for tomorrow's appointments.
 * Sends WhatsApp + Email reminders, then marks reminder_sent = 1.
 */
async function processReminders() {
  try {
    const db = getDb();

    // Calculate tomorrow's date in YYYY-MM-DD format
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    console.log(`[Reminders] Processing reminders for ${tomorrowStr}...`);

    // Get all appointments for tomorrow that haven't had reminders sent
    const appointments = await db.prepare(`
      SELECT
        a.id, a.date, a.start_time, a.tenant_id,
        c.name AS client_name, c.phone AS client_phone, c.email AS client_email,
        b.name AS barber_name,
        s.name AS service_name,
        t.name AS shop_name
      FROM appointments a
      JOIN clients c ON a.client_id = c.id
      JOIN barbers b ON a.barber_id = b.id
      JOIN services s ON a.service_id = s.id
      JOIN tenants t ON a.tenant_id = t.id
      WHERE a.date = ?
        AND a.reminder_sent = 0
        AND a.status NOT IN ('cancelled')
      ORDER BY a.tenant_id, a.start_time
    `).all(tomorrowStr);

    console.log(`[Reminders] Found ${appointments.length} appointments needing reminders.`);

    let sentCount = 0;
    let failCount = 0;

    for (const appt of appointments) {
      const details = {
        barberName: appt.barber_name,
        date: appt.date,
        time: appt.start_time,
        serviceName: appt.service_name,
        shopName: appt.shop_name
      };

      let whatsappOk = false;
      let emailOk = false;

      // Send WhatsApp reminder
      if (appt.client_phone) {
        const result = await sendWhatsAppReminder(appt.client_phone, details);
        whatsappOk = result.success;
      }

      // Send email reminder
      if (appt.client_email) {
        try {
          await sendReminderEmail(appt.client_email, {
            clientName: appt.client_name,
            barberName: appt.barber_name,
            date: appt.date,
            time: appt.start_time,
            serviceName: appt.service_name,
            shopName: appt.shop_name
          });
          emailOk = true;
        } catch (err) {
          console.error(`[Reminders] Email failed for appointment ${appt.id}:`, err.message);
        }
      }

      // Mark as sent if at least one channel succeeded, or if neither channel is configured
      if (whatsappOk || emailOk || (!appt.client_phone && !appt.client_email)) {
        await db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
        sentCount++;
      } else {
        // Still mark as sent to avoid infinite retries, but log the failure
        await db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(appt.id);
        failCount++;
      }
    }

    console.log(`[Reminders] Done. Sent: ${sentCount}, Failed: ${failCount}`);
    return { total: appointments.length, sent: sentCount, failed: failCount };
  } catch (err) {
    console.error('[Reminders] processReminders error:', err);
    return { total: 0, sent: 0, failed: 0, error: err.message };
  }
}

/**
 * Get reminder statistics
 */
async function getReminderStats() {
  const db = getDb();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const today = new Date().toISOString().split('T')[0];

  // Appointments with reminders sent today (based on tomorrow's date)
  const sentToday = await db.prepare(`
    SELECT COUNT(*) as count FROM appointments
    WHERE date = ? AND reminder_sent = 1 AND status NOT IN ('cancelled')
  `).get(tomorrowStr);

  // Pending reminders for tomorrow
  const pendingTomorrow = await db.prepare(`
    SELECT COUNT(*) as count FROM appointments
    WHERE date = ? AND reminder_sent = 0 AND status NOT IN ('cancelled')
  `).get(tomorrowStr);

  return {
    sent_today: parseInt(sentToday.count) || 0,
    pending_tomorrow: parseInt(pendingTomorrow.count) || 0,
    tomorrow_date: tomorrowStr,
    whatsapp_configured: !!(WHATSAPP_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID),
    smtp_configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER)
  };
}

module.exports = {
  sendWhatsAppReminder,
  processReminders,
  getReminderStats,
  formatPhoneInternational
};
