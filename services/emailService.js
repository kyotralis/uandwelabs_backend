import nodemailer from 'nodemailer';

let transporter = null;

// Initialize Gmail SMTP transporter if credentials are provided in .env
function getTransporter() {
  if (transporter) return transporter;

  const emailUser = process.env.EMAIL_USER?.trim();
  const emailPass = process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s+/g, '') : null;

  if (!emailUser || !emailPass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

  return transporter;
}

/**
 * Send 6-digit OTP verification email to user
 * @param {string} toEmail 
 * @param {string} otpCode 
 * @param {string} userName 
 * @param {boolean} isResend
 * @returns {Promise<{ delivered: boolean, preview?: string }>}
 */
export async function sendOtpEmail(toEmail, otpCode, userName = 'there', isResend = false) {
  const mailer = getTransporter();

  const emailSubject = isResend
    ? `${otpCode} is your NEW UandWe Labs verification code`
    : `${otpCode} is your UandWe Labs verification code`;

  const emailDescription = isResend
    ? 'You requested a new verification code for your UandWe Labs sign-in. Please enter the updated 6-digit code below.'
    : 'You recently initiated sign-in to your UandWe Labs platform account. Please use the verification code below to confirm your identity.';

  // HTML email template
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your UandWe Labs Verification Code</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #1e293b; }
        .container { max-width: 520px; margin: 40px auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 30px rgba(0,0,0,0.06); }
        .header { background-color: #0c1017; padding: 32px 36px; text-align: left; }
        .logo-text { font-size: 19px; font-weight: 700; color: #ffffff; letter-spacing: 0.05em; text-transform: uppercase; }
        .logo-sub { color: #f97316; font-weight: 600; }
        .content { padding: 40px 36px; }
        .greeting { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
        .desc { font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 28px; }
        .otp-box { background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 14px; padding: 22px; text-align: center; margin-bottom: 28px; }
        .otp-number { font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0f172a; font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; }
        .otp-expiry { font-size: 12px; color: #94a3b8; margin-top: 8px; font-weight: 500; }
        .security-note { font-size: 12px; line-height: 1.6; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; margin-top: 10px; }
        .footer { background-color: #f8fafc; padding: 20px 36px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-text">UANDWE<span class="logo-sub">LABS</span></div>
        </div>
        <div class="content">
          <div class="greeting">Hi ${userName},</div>
          ${isResend ? '<div style="margin-bottom: 14px;"><span style="background: #ffedd5; color: #c2410c; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Updated Security Code</span></div>' : ''}
          <p class="desc">
            ${emailDescription}
          </p>
          <div class="otp-box">
            <div class="otp-number">${otpCode}</div>
            <div class="otp-expiry">This single-use code expires in 5 minutes</div>
          </div>
          <p class="security-note">
            If you did not request this authentication code, you can safely disregard this email. Never share this code with anyone.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} UandWe Labs Inc. All rights reserved. &bull; Secure Two-Factor Authentication
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `${isResend ? 'Updated Code: ' : ''}Your UandWe Labs verification code is: ${otpCode}. It expires in 5 minutes. If you did not request this, please disregard.`;

  if (mailer) {
    try {
      const fromSender = process.env.EMAIL_FROM || `"UandWe Labs Security" <${process.env.EMAIL_USER}>`;
      const info = await mailer.sendMail({
        from: fromSender,
        to: toEmail,
        subject: emailSubject,
        text: textContent,
        html: htmlContent,
      });

      console.log(`[Email Service] ${isResend ? 'Resent' : 'Sent'} OTP successfully to ${toEmail}. MessageId: ${info.messageId}`);
      return { delivered: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[Email Service Warning] Failed to send email to ${toEmail} via SMTP:`, err.message);
      // Fallback: log code in terminal so user can proceed in dev/test
      console.log(`\n======================================================`);
      console.log(`[FALLBACK DEV OTP CODE ${isResend ? '(RESENT)' : ''}] For ${toEmail}: ${otpCode}`);
      console.log(`======================================================\n`);
      return { delivered: false, error: err.message };
    }
  } else {
    // No SMTP credentials in .env yet: print directly to server console
    console.log(`\n======================================================`);
    console.log(`[UANDWELABS OTP DEV CODE ${isResend ? '(RESENT)' : ''}]`);
    console.log(`Email: ${toEmail}`);
    console.log(`Code:  ${otpCode}`);
    console.log(`Expires in: 5 minutes`);
    console.log(`(Configure EMAIL_USER and EMAIL_PASS in server/.env to send real emails via Gmail)`);
    console.log(`======================================================\n`);
    return { delivered: false, simulated: true };
  }
}

