const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;

function isConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!isConfigured()) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
  }
  return transporter;
}

/**
 * Base HTML email layout with RTL Hebrew, DaniTech branding
 */
function emailLayout(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4F46E5,#6366F1);padding:32px 24px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">DaniTech</h1>
              <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">ניהול תורים חכם</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 24px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 24px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">נשלח מ-DaniTech - מערכת ניהול תורים</p>
              <a href="#unsubscribe" style="color:#4F46E5;font-size:12px;text-decoration:underline;">הסרה מרשימת התפוצה</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send an email. Logs warning and skips if SMTP is not configured.
 */
async function sendEmail(to, subject, html) {
  const transport = getTransporter();
  if (!transport) {
    console.warn('[Email] SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing). Skipping email.');
    return;
  }

  try {
    const info = await transport.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html
    });
    console.log(`[Email] Sent to ${to} - messageId: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

/**
 * Send booking confirmation email
 */
async function sendBookingConfirmation(to, details) {
  const { clientName, barberName, date, time, serviceName, shopName, price } = details;

  const formattedDate = formatHebrewDate(date);

  const html = emailLayout('אישור תור', `
    <h2 style="margin:0 0 16px;color:#1f2937;font-size:20px;">שלום ${clientName || ''},</h2>
    <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
      התור שלך נקבע בהצלחה! להלן הפרטים:
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f0f0ff;border-radius:8px;border:1px solid #e0e0ff;">
      <tr>
        <td style="padding:20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;width:100px;">מספרה:</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;">${shopName || ''}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">ספר/ית:</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;">${barberName || ''}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">שירות:</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;">${serviceName || ''}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">תאריך:</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;">${formattedDate}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">שעה:</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;">${time || ''}</td>
            </tr>
            ${price ? `<tr>
              <td style="padding:8px 0;color:#6b7280;font-size:14px;">מחיר:</td>
              <td style="padding:8px 0;color:#1f2937;font-size:14px;font-weight:600;">${price} &#8362;</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">
      לביטול או שינוי התור, אנא צרו קשר עם המספרה.
    </p>
  `);

  await sendEmail(to, `אישור תור - ${shopName || 'המספרה'}`, html);
}

/**
 * Send welcome email to new tenant
 */
async function sendWelcomeEmail(to, tenantName, loginUrl) {
  const html = emailLayout('ברוכים הבאים', `
    <h2 style="margin:0 0 16px;color:#1f2937;font-size:20px;">ברוכים הבאים ל-DaniTech!</h2>
    <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
      העסק <strong>${tenantName}</strong> נרשם בהצלחה למערכת ניהול התורים שלנו.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
      <tr>
        <td style="padding:20px;">
          <h3 style="margin:0 0 12px;color:#166534;font-size:16px;">מה עכשיו?</h3>
          <ul style="margin:0;padding:0 20px;color:#4b5563;font-size:14px;line-height:2;">
            <li>הוסיפו את הספרים/ות שלכם</li>
            <li>הגדירו את השירותים והמחירים</li>
            <li>שתפו את קישור ההזמנה עם הלקוחות</li>
            <li>התחילו לקבל תורים!</li>
          </ul>
        </td>
      </tr>
    </table>
    <div style="text-align:center;margin:32px 0 16px;">
      <a href="${loginUrl || '/login'}" style="display:inline-block;background-color:#4F46E5;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">
        כניסה למערכת
      </a>
    </div>
    <p style="margin:16px 0 0;color:#9ca3af;font-size:13px;text-align:center;">
      תקופת הניסיון שלכם: 30 יום
    </p>
  `);

  await sendEmail(to, `ברוכים הבאים ל-DaniTech - ${tenantName}`, html);
}

/**
 * Send appointment reminder email
 */
async function sendReminderEmail(to, details) {
  const { clientName, barberName, date, time, serviceName, shopName } = details;

  const formattedDate = formatHebrewDate(date);

  const html = emailLayout('תזכורת תור', `
    <h2 style="margin:0 0 16px;color:#1f2937;font-size:20px;">שלום ${clientName || ''},</h2>
    <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
      רצינו להזכיר לך שיש לך תור מחר:
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#fef3c7;border-radius:8px;border:1px solid #fde68a;">
      <tr>
        <td style="padding:20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding:8px 0;color:#92400e;font-size:14px;width:100px;">מספרה:</td>
              <td style="padding:8px 0;color:#78350f;font-size:14px;font-weight:600;">${shopName || ''}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#92400e;font-size:14px;">ספר/ית:</td>
              <td style="padding:8px 0;color:#78350f;font-size:14px;font-weight:600;">${barberName || ''}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#92400e;font-size:14px;">שירות:</td>
              <td style="padding:8px 0;color:#78350f;font-size:14px;font-weight:600;">${serviceName || ''}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#92400e;font-size:14px;">תאריך:</td>
              <td style="padding:8px 0;color:#78350f;font-size:14px;font-weight:600;">${formattedDate}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#92400e;font-size:14px;">שעה:</td>
              <td style="padding:8px 0;color:#78350f;font-size:14px;font-weight:600;">${time || ''}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;color:#6b7280;font-size:14px;line-height:1.6;">
      לביטול או שינוי התור, אנא צרו קשר עם המספרה.
    </p>
  `);

  await sendEmail(to, `תזכורת: יש לך תור מחר ב-${shopName || 'המספרה'}`, html);
}

/**
 * Format a YYYY-MM-DD date string to a Hebrew-friendly display
 */
function formatHebrewDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const dayName = days[d.getDay()];
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    return `יום ${dayName}, ${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

module.exports = {
  sendBookingConfirmation,
  sendWelcomeEmail,
  sendReminderEmail,
  isConfigured
};
