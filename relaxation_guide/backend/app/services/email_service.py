"""
Email Service Module.
Provides SMTP email delivery for 6-digit account authorization codes.
Supports standard SMTP (Gmail, SendGrid, Mailgun) with server console logging fallback.
"""

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM

class EmailService:
    def send_verification_code(self, recipient_email: str, code: str, full_name: str = "Participant") -> bool:
        """Sends a styled 6-digit email authorization code to the specified address."""
        subject = f"🔐 Your CAPS Stress System Email Authorization Code is: {code}"

        # HTML Email Template
        html_body = f"""
        <html>
          <body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #0F172A; color: #F8FAFC; padding: 24px;">
            <div style="max-width: 500px; margin: 0 auto; background: #1E293B; border-radius: 16px; padding: 32px; border: 1px solid #38BDF8;">
              <h2 style="color: #38BDF8; margin-top: 0;">Welcome to CAPS, {full_name}!</h2>
              <p style="color: #94A3B8; font-size: 15px; line-height: 1.5;">
                Thank you for joining the Closed-Loop Bio-Feedback & Adaptive Stress System study.
              </p>
              <p style="color: #E2E8F0; font-size: 14px;">
                Your 6-digit email authorization code is:
              </p>
              <div style="background: #0284C7; color: #FFFFFF; font-size: 32px; font-weight: 800; text-align: center; padding: 16px; border-radius: 12px; letter-spacing: 8px; margin: 20px 0;">
                {code}
              </div>
              <p style="color: #64748B; font-size: 12px; text-align: center; margin-top: 24px;">
                If you did not request this authorization code, please ignore this email.
              </p>
            </div>
          </body>
        </html>
        """

        text_body = f"Hello {full_name},\n\nYour CAPS email authorization code is: {code}\n\nEnter this 6-digit code in the app to verify your authorization."

        # If SMTP credentials are provided in environment / config
        if SMTP_USER and SMTP_PASSWORD:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"] = EMAIL_FROM or SMTP_USER
                msg["To"] = recipient_email

                msg.attach(MIMEText(text_body, "plain"))
                msg.attach(MIMEText(html_body, "html"))

                if SMTP_PORT == 465:
                    server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10)
                    server.login(SMTP_USER, SMTP_PASSWORD)
                    server.sendmail(msg["From"], [recipient_email], msg.as_string())
                    server.quit()
                else:
                    server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
                    server.starttls()
                    server.login(SMTP_USER, SMTP_PASSWORD)
                    server.sendmail(msg["From"], [recipient_email], msg.as_string())
                    server.quit()

                print(f"[EmailService] [SMTP SUCCESS] Authorization email sent to {recipient_email}")
                return True
            except Exception as e:
                print(f"[EmailService] [SMTP Warning] Connection Error to {recipient_email}: {e}")
                print("[EmailService] Falling back to server console display.")

        else:
            print(f"[EmailService] [Info] SMTP credentials missing in backend/.env (SMTP_USER / SMTP_PASSWORD).")

        # Fallback server console display for local testing / debugging
        print("\n=======================================================")
        print(f"[EmailService] AUTHORIZATION CODE FOR: {recipient_email}")
        print(f"VERIFICATION CODE: {code}")
        print("=======================================================\n")
        return True

# Global EmailService Instance
email_service = EmailService()
