'use strict';
const nodemailer = require('nodemailer');

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const configured = !!RESEND_KEY || smtpConfigured;
const FROM = process.env.MAIL_FROM || 'Fire Safety Academy <no-reply@example.com>';
const APP_NAME = 'Fire Safety Academy';
const RESEND_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

let transporter = null;
if (!RESEND_KEY && smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
  });
}

console.log(RESEND_KEY ? `[mail] Using Resend HTTPS API. From: ${FROM}`
  : smtpConfigured ? `[mail] Using SMTP ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}. From: ${FROM}`
  : '[mail] NO email provider configured: codes are printed to this log only.');
if (configured && /example\.com/.test(FROM)) console.log('[mail] WARNING: MAIL_FROM is not set to an address on your verified domain, so the provider will reject emails.');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function viaResend(payload) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`Resend rejected the email (HTTP ${r.status}): ${body.slice(0, 300)}`);
    return body;
  } finally { clearTimeout(t); }
}

async function sendOtp(to, name, code, purpose) {
  const verify = purpose === 'verify';
  const subject = verify ? `Confirm your email: your code is ${code}` : `Password reset code: ${code}`;
  const intro = verify
    ? 'Welcome! Enter this code to confirm your email address and activate your account.'
    : 'We received a request to reset your password. Enter this code to continue.';
  const text = `Hello ${name},\n\n${intro}\n\nYour code: ${code}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.\n\n${APP_NAME}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
    <h2 style="color:#00a396">${APP_NAME}</h2><p>Hello ${esc(name)},</p><p>${intro}</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f2f2f2;padding:16px;text-align:center">${code}</p>
    <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`;

  if (!configured) {
    console.log(`[DEV MAIL - no email provider configured] To: ${to} | ${purpose.toUpperCase()} code: ${code}`);
    return;
  }
  try {
    if (RESEND_KEY) await viaResend({ from: FROM, to: [to], subject, text, html });
    else await transporter.sendMail({ from: FROM, to, subject, text, html });
    console.log(`[mail] ${purpose} email accepted for delivery to ${to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
  } catch (e) {
    console.error(`[mail] FAILED to send ${purpose} email: ${e.message}`);
    throw e;
  }
}

module.exports = { sendOtp, configured };