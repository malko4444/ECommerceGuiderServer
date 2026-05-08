import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Single shared transporter — reused by every send-email helper below.
const buildTransporter = () =>
  nodemailer.createTransport({
    host: process.env.MAIL_SERVER,
    port: process.env.MAIL_PORT,
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
  });

// Tiny HTML escape — never trust user-typed content in mail bodies.
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const sendOTPEmail = async (to, otp) => {
  try {
    console.log(`📧 Sending OTP email to ${to} with OTP: ${otp}`);
    const transporter = buildTransporter();

    const mailOptions = {
      from: `"Product Management App" <${process.env.MAIL_FROM}>`,
      to,
      subject: "Your OTP Code",
      html: `
        <h2>Email Verification</h2>
        <p>Your OTP code is:</p>
        <h1 style="color: #2e86de;">${otp}</h1>
        <p>This code will expire in <b>5 minutes</b>.</p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send OTP email:", error);
    throw new Error("Email sending failed");
  }
};

/**
 * Send a buyer's inquiry to a vendor.
 * @param {Object} args
 * @param {string} args.vendorEmail   - vendor inbox
 * @param {string} args.vendorName    - displayed in subject + greeting
 * @param {string} args.fromName      - inquirer name
 * @param {string} args.fromEmail     - inquirer email (Reply-To target)
 * @param {string} [args.fromPhone]
 * @param {string} [args.budget]
 * @param {string} args.message
 */
export const sendInquiryEmail = async ({
  vendorEmail,
  vendorName,
  fromName,
  fromEmail,
  fromPhone = "",
  budget = "",
  message,
}) => {
  try {
    console.log(`📧 Sending inquiry to vendor ${vendorEmail}`);
    const transporter = buildTransporter();

    const mailOptions = {
      from: `"ECommerce Guider" <${process.env.MAIL_FROM}>`,
      to: vendorEmail,
      replyTo: fromEmail, // vendor can hit Reply and reach the buyer directly
      subject: `New inquiry for ${vendorName} — via ECommerce Guider`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; padding: 20px; background: #f8fafc; border-radius: 12px;">
          <div style="background: linear-gradient(135deg, #14b8a6, #0f766e); padding: 16px 20px; border-radius: 10px 10px 0 0; color: white;">
            <h2 style="margin: 0; font-size: 18px;">New Inquiry</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">A buyer is interested in ${esc(vendorName)}</p>
          </div>

          <div style="background: white; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0;">
            <p style="color: #334155; margin: 0 0 12px;">Hello ${esc(vendorName)},</p>
            <p style="color: #475569; line-height: 1.5; margin: 0 0 16px;">
              You have received a new business inquiry through the
              <strong>ECommerce Guider</strong> directory.
            </p>

            <table cellpadding="6" style="width: 100%; font-size: 14px; color: #1e293b; border-collapse: collapse;">
              <tr><td style="color:#64748b; width: 110px;">From</td><td><strong>${esc(fromName)}</strong></td></tr>
              <tr><td style="color:#64748b;">Email</td><td><a href="mailto:${esc(fromEmail)}" style="color:#0d9488;">${esc(fromEmail)}</a></td></tr>
              ${fromPhone ? `<tr><td style="color:#64748b;">Phone</td><td>${esc(fromPhone)}</td></tr>` : ""}
              ${budget ? `<tr><td style="color:#64748b;">Budget</td><td>${esc(budget)}</td></tr>` : ""}
            </table>

            <div style="margin-top: 16px; padding: 14px; background: #f1f5f9; border-left: 4px solid #14b8a6; border-radius: 6px; color: #334155; line-height: 1.55; white-space: pre-wrap;">${esc(message)}</div>

            <p style="margin: 22px 0 0; font-size: 12px; color: #94a3b8;">
              Tip: simply <strong>reply</strong> to this email to respond directly to ${esc(fromName)}.
            </p>
          </div>

          <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 14px;">
            Powered by ECommerce Guider · Helping Pakistani sellers grow
          </p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Inquiry email sent to ${vendorEmail}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send inquiry email:", error);
    throw new Error("Inquiry email failed");
  }
};
