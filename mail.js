const nodemailer = require('nodemailer');

// Ensure port is an integer
const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);

// Create reusable Nodemailer transporter configured for Zoho
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.zoho.com',
  port: smtpPort,
  secure: smtpPort === 465, // true for 465 (SSL), false for 587 (TLS)
  auth: {
    user: process.env.EMAIL_USER, // Full Zoho email address
    pass: process.env.EMAIL_PASS  // 16-character Zoho App Password
  },
  tls: {
    rejectUnauthorized: true
  }
});

// Verify connection configuration on startup
transporter.verify((error) => {
  if (error) {
    console.error('❌ Zoho SMTP Connection Error:', error);
  } else {
    console.log('✅ Zoho SMTP Server is ready to send messages');
  }
});

/**
 * Send OTP Email for Registration or Password Reset
 * @param {string} toEmail - Recipient address
 * @param {string} otp - 6-digit OTP code
 * @param {string} type - 'registration' | 'reset'
 */
async function sendOTPEmail(toEmail, otp, type = 'registration') {
  const isReset = type === 'reset';
  const subject = isReset 
    ? 'Fire Safety Academy - Password Reset Code' 
    : 'Fire Safety Academy - Email Verification Code';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #d32f2f; text-align: center; margin-bottom: 5px;">Fire Safety Academy</h2>
      <hr style="border: none; border-top: 1px solid #eeeeee; margin-bottom: 20px;" />
      <p style="font-size: 15px; color: #333;">Hello,</p>
      <p style="font-size: 15px; color: #333;">
        ${isReset 
          ? 'You requested to reset your password. Use the code below to complete the process:' 
          : 'Thank you for registering. Please use the verification code below to activate your account:'}
      </p>
      <div style="text-align: center; margin: 25px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #d32f2f; background-color: #f9f9f9; padding: 12px 24px; border-radius: 6px; border: 1px solid #e0e0e0; display: inline-block;">
          ${otp}
        </span>
      </div>
      <p style="color: #777; font-size: 13px;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
    </div>
  `;

  const mailOptions = {
    from: `"Fire Safety Academy" <${process.env.EMAIL_USER}>`, // Must match authenticated Zoho account
    to: toEmail,
    subject: subject,
    html: htmlContent
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP sent to ${toEmail} [ID: ${info.messageId}]`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Failed to send email to ${toEmail}:`, error);
    throw error;
  }
}

module.exports = { sendOTPEmail };