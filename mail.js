'use strict';
const nodemailer = require('nodemailer');

const configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
let transporter = null;
if (configured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
const FROM = process.env.MAIL_FROM || 'Fire Safety Academy <info@cityofrefuge-sheffield.org>';
const APP_NAME = 'Fire Safety Academy';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    // Development only: no SMTP set, so print the code to the server console. Never exposed to the browser.
    console.log(`[DEV MAIL - SMTP not configured] To: ${to} | ${purpose.toUpperCase()} code: ${code}`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, text, html });
}

module.exports = { sendOtp, configured };
