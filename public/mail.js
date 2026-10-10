'use strict';
const nodemailer = require('nodemailer');

// Two ways to send: Resend's web API (RESEND_API_KEY, works on Render's free plan) or classic SMTP.
// Render's free plan blocks outgoing SMTP ports (25/465/587), so on Render prefer RESEND_API_KEY.
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_URL = (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, '');
const smtpOk = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const provider = RESEND_KEY ? 'resend' : smtpOk ? 'smtp' : 'none';
const configured = provider !== 'none';
let transporter = null;
if (provider === 'smtp') {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
  });
}
const FROM = process.env.MAIL_FROM || 'Fire Safety Academy <no-reply@example.com>';
const APP_NAME = 'Fire Safety Academy';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function deliver({ to, subject, text, html }) {
  if (provider === 'resend') {
    let res;
    try {
      res = await fetch(RESEND_URL + '/emails', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject, text, html })
      });
    } catch (e) { throw new Error('Could not reach Resend: ' + e.message); }
    if (!res.ok) {
      let msg = ''; try { const j = await res.json(); msg = j.message || j.error || ''; } catch (_) {}
      throw new Error(`Resend refused the email (${res.status}): ${msg || 'no details'}`);
    }
    return;
  }
  try { await transporter.sendMail({ from: FROM, to, subject, text, html }); }
  catch (e) {
    if (process.env.RENDER && /timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|ESOCKET/i.test(e.message + ' ' + (e.code || ''))) {
      throw new Error(e.message + ' (Render blocks outgoing SMTP on free web services. Use RESEND_API_KEY instead of SMTP, or upgrade the Render plan.)');
    }
    throw e;
  }
}

// Used by the Super Admin "Send test email" button: throws the real error so it can be shown.
async function sendTest(to) {
  if (!configured) throw new Error('No email service is set up. Add RESEND_API_KEY (or SMTP_HOST, SMTP_USER and SMTP_PASS) in Render and restart.');
  const text = `This is a test email from ${APP_NAME}. If you can read this, sign-in and confirmation codes will reach you.`;
  await deliver({ to, subject: `${APP_NAME}: test email`, text, html: `<p>${esc(text)}</p>` });
}

async function sendOtp(to, name, code, purpose) {
  const verify = purpose === 'verify', login = purpose === 'login';
  const subject = verify ? `Confirm your email: your code is ${code}` : login ? `Your sign-in code: ${code}` : `Password reset code: ${code}`;
  const intro = verify
    ? 'Welcome! Enter this code to confirm your email address and activate your account.'
    : login ? 'Someone just entered your password to sign in to the administration area. Enter this code to finish signing in. If it was not you, change your password.'
    : 'We received a request to reset your password. Enter this code to continue.';
  const text = `Hello ${name},\n\n${intro}\n\nYour code: ${code}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.\n\n${APP_NAME}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
    <h2 style="color:#00a396">${APP_NAME}</h2><p>Hello ${esc(name)},</p><p>${intro}</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f2f2f2;padding:16px;text-align:center">${code}</p>
    <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`;

  if (!configured) {
    // Development only: no SMTP set, so print the code to the server console. Never exposed to the browser.
    console.log(`[DEV MAIL - SMTP not configured] To: ${to} | ${purpose.toUpperCase()} code: ${code}`);
    return;
  }
  await deliver({ to, subject, text, html });
}

module.exports = { sendOtp, sendTest, configured, provider, FROM };
