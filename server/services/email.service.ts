/**
 * Email Notification Service
 * Handles sending emails to passengers for various events
 *
 * Note: This is a mock implementation for demonstration.
 * In production, integrate with a real email service like:
 * - SendGrid
 * - AWS SES
 * - Mailgun
 * - Resend
 */

export interface EmailTemplate {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface BookingConfirmationData {
  passengerName: string;
  passengerEmail: string;
  bookingReference: string;
  pnr: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: Date;
  arrivalTime: Date;
  cabinClass: string;
  numberOfPassengers: number;
  totalAmount: number;
  attachments?: Array<{
    filename: string;
    content: string; // base64 PDF
    contentType?: string;
  }>;
}

export interface FlightStatusChangeData {
  passengerName: string;
  passengerEmail: string;
  bookingReference: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: Date;
  oldStatus: string;
  newStatus: string;
  delayMinutes?: number;
  reason?: string;
}

export interface RefundConfirmationData {
  passengerName: string;
  passengerEmail: string;
  bookingReference: string;
  flightNumber: string;
  refundAmount: number;
  refundReason?: string;
  processingDays: number;
}

export interface CheckInReminderData {
  passengerName: string;
  passengerEmail: string;
  bookingReference: string;
  pnr: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: Date;
  checkInUrl: string;
}

export interface LoyaltyMilesNotificationData {
  passengerName: string;
  passengerEmail: string;
  bookingReference: string;
  milesEarned: number;
  totalMiles: number;
  tierStatus: string;
  nextTierMiles?: number;
}

export interface SplitPaymentRequestData {
  payerName: string;
  payerEmail: string;
  bookingReference: string;
  flightNumber: string;
  route: string;
  departureTime: Date;
  amount: number;
  paymentUrl: string;
  expiresAt?: Date;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
  } catch {
    // invalid URL
  }
  return "#";
}

/**
 * Mock email sending function
 * In production, replace with actual email service API call
 */
async function sendEmail(template: EmailTemplate): Promise<boolean> {
  console.log("[Email Service] Sending email:");
  console.log(`  To: ${template.to}`);
  console.log(`  Subject: ${template.subject}`);
  console.log(
    `  Content: ${template.text || template.html.substring(0, 100)}...`
  );

  // Simulate email sending delay
  await new Promise(resolve => setTimeout(resolve, 100));

  return true;
}

/**
 * Send booking confirmation email
 */
export async function sendBookingConfirmation(
  data: BookingConfirmationData
): Promise<boolean> {
  try {
    const template: EmailTemplate = {
      to: data.passengerEmail,
      subject: `تأكيد الحجز - ${data.bookingReference}`,
      attachments: data.attachments?.map(att => ({
        filename: att.filename,
        content: Buffer.from(att.content, "base64"),
        contentType: att.contentType || "application/pdf",
      })),
      text: `
مرحباً ${data.passengerName},

تم تأكيد حجزك بنجاح!

تفاصيل الحجز:
- رقم الحجز: ${data.bookingReference}
- رقم PNR: ${data.pnr}
- رقم الرحلة: ${data.flightNumber}
- من: ${data.origin}
- إلى: ${data.destination}
- تاريخ المغادرة: ${data.departureTime.toLocaleString("ar-SA")}
- تاريخ الوصول: ${data.arrivalTime.toLocaleString("ar-SA")}
- الدرجة: ${data.cabinClass === "economy" ? "اقتصادية" : "أعمال"}
- عدد الركاب: ${data.numberOfPassengers}
- المبلغ الإجمالي: ${(data.totalAmount / 100).toFixed(2)} ر.س

يرجى الاحتفاظ برقم الحجز للرجوع إليه.

شكراً لاختياركم خدماتنا!
نظام الطيران المتكامل
      `.trim(),
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>تأكيد الحجز | Booking Confirmation</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .fluid { max-width: 100% !important; height: auto !important; }
      .stack-column { display: block !important; width: 100% !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; -webkit-font-smoothing: antialiased; direction: rtl;">

  <!-- Preheader (hidden preview text) -->
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f4f6f9;">
    تم تأكيد حجزك بنجاح - رقم الحجز: ${data.bookingReference} | Your booking has been confirmed - Ref: ${data.bookingReference}
  </div>

  <!-- Email wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f6f9;">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); padding: 32px 40px; text-align: center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 1px;">AIS Aviation</p>
                    <p style="margin: 4px 0 0; font-size: 14px; color: #bfdbfe; letter-spacing: 0.5px;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644;</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Confirmation Banner -->
          <tr>
            <td style="background-color: #059669; padding: 20px 40px; text-align: center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff;">&#x2713; &#x062A;&#x0645; &#x062A;&#x0623;&#x0643;&#x064A;&#x062F; &#x0627;&#x0644;&#x062D;&#x062C;&#x0632; &#x0628;&#x0646;&#x062C;&#x0627;&#x062D;</p>
                    <p style="margin: 6px 0 0; font-size: 14px; color: #d1fae5;">Booking Confirmed Successfully</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PNR / Reference Highlight -->
          <tr>
            <td style="padding: 28px 40px 0;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #eff6ff; border: 2px dashed #1e40af; border-radius: 10px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="margin: 0 0 4px; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x062D;&#x062C;&#x0632; | Booking Reference</p>
                    <p style="margin: 0; font-size: 32px; font-weight: 800; color: #1e40af; letter-spacing: 4px; font-family: 'Courier New', monospace;">${data.bookingReference}</p>
                    <p style="margin: 8px 0 0; font-size: 13px; color: #64748b;">PNR: <span style="font-weight: 700; color: #1e40af; letter-spacing: 2px;">${data.pnr}</span></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 24px 40px 0;" class="mobile-padding">
              <p style="margin: 0; font-size: 16px; color: #1e293b; line-height: 1.6;">
                &#x0645;&#x0631;&#x062D;&#x0628;&#x0627;&#x064B; <strong>${escapeHtml(data.passengerName)}</strong>,
              </p>
              <p style="margin: 8px 0 0; font-size: 15px; color: #475569; line-height: 1.6;">
                &#x064A;&#x0633;&#x0639;&#x062F;&#x0646;&#x0627; &#x0625;&#x0628;&#x0644;&#x0627;&#x063A;&#x0643; &#x0628;&#x0623;&#x0646; &#x062D;&#x062C;&#x0632;&#x0643; &#x0642;&#x062F; &#x062A;&#x0645; &#x062A;&#x0623;&#x0643;&#x064A;&#x062F;&#x0647; &#x0628;&#x0646;&#x062C;&#x0627;&#x062D;. &#x064A;&#x0631;&#x062C;&#x0649; &#x0645;&#x0631;&#x0627;&#x062C;&#x0639;&#x0629; &#x062A;&#x0641;&#x0627;&#x0635;&#x064A;&#x0644; &#x0631;&#x062D;&#x0644;&#x062A;&#x0643; &#x0623;&#x062F;&#x0646;&#x0627;&#x0647;.
              </p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
                We are pleased to confirm your booking. Please review your flight details below.
              </p>
            </td>
          </tr>

          <!-- Flight Details Table -->
          <tr>
            <td style="padding: 24px 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0;">
                <!-- Table Header -->
                <tr>
                  <td colspan="2" style="background-color: #1e40af; padding: 14px 20px;">
                    <p style="margin: 0; font-size: 15px; font-weight: 700; color: #ffffff;">&#x062A;&#x0641;&#x0627;&#x0635;&#x064A;&#x0644; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629; | Flight Details</p>
                  </td>
                </tr>
                <!-- Flight Number -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b; width: 40%;">&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629; | Flight</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #1e293b;">${data.flightNumber}</td>
                </tr>
                <!-- Origin -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0645;&#x0646; | From</td>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 600; color: #1e293b;">${data.origin}</td>
                </tr>
                <!-- Destination -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0625;&#x0644;&#x0649; | To</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 600; color: #1e293b;">${data.destination}</td>
                </tr>
                <!-- Departure -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x0645;&#x063A;&#x0627;&#x062F;&#x0631;&#x0629; | Departure</td>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #1e293b;">${data.departureTime.toLocaleString("ar-SA")}</td>
                </tr>
                <!-- Arrival -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x0648;&#x0635;&#x0648;&#x0644; | Arrival</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #1e293b;">${data.arrivalTime.toLocaleString("ar-SA")}</td>
                </tr>
                <!-- Cabin Class -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x062F;&#x0631;&#x062C;&#x0629; | Class</td>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #1e293b;">
                    <span style="display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; ${data.cabinClass === "economy" ? "background-color: #dbeafe; color: #1e40af;" : "background-color: #fef3c7; color: #92400e;"}">
                      ${data.cabinClass === "economy" ? "&#x0627;&#x0642;&#x062A;&#x0635;&#x0627;&#x062F;&#x064A;&#x0629; | Economy" : "&#x0623;&#x0639;&#x0645;&#x0627;&#x0644; | Business"}
                    </span>
                  </td>
                </tr>
                <!-- Passengers -->
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0639;&#x062F;&#x062F; &#x0627;&#x0644;&#x0631;&#x0643;&#x0627;&#x0628; | Passengers</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 600; color: #1e293b;">${data.numberOfPassengers}</td>
                </tr>
                <!-- Total Amount -->
                <tr>
                  <td style="padding: 16px 20px; background-color: #1e3a8a; font-size: 14px; font-weight: 600; color: #bfdbfe;">&#x0627;&#x0644;&#x0645;&#x0628;&#x0644;&#x063A; &#x0627;&#x0644;&#x0625;&#x062C;&#x0645;&#x0627;&#x0644;&#x064A; | Total</td>
                  <td style="padding: 16px 20px; background-color: #1e3a8a; font-size: 20px; font-weight: 800; color: #ffffff;">${(data.totalAmount / 100).toFixed(2)} &#x0631;.&#x0633; <span style="font-size: 13px; font-weight: 400; color: #bfdbfe;">SAR</span></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Important Notice -->
          <tr>
            <td style="padding: 0 40px 24px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #92400e;">&#x0645;&#x0644;&#x0627;&#x062D;&#x0638;&#x0629; &#x0645;&#x0647;&#x0645;&#x0629; | Important Notice</p>
                    <p style="margin: 0; font-size: 13px; color: #a16207; line-height: 1.5;">
                      &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x0627;&#x062D;&#x062A;&#x0641;&#x0627;&#x0638; &#x0628;&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x062D;&#x062C;&#x0632; &#x0644;&#x0644;&#x0631;&#x062C;&#x0648;&#x0639; &#x0625;&#x0644;&#x064A;&#x0647;. &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x0648;&#x0635;&#x0648;&#x0644; &#x0644;&#x0644;&#x0645;&#x0637;&#x0627;&#x0631; &#x0642;&#x0628;&#x0644; 3 &#x0633;&#x0627;&#x0639;&#x0627;&#x062A; &#x0645;&#x0646; &#x0645;&#x0648;&#x0639;&#x062F; &#x0627;&#x0644;&#x0645;&#x063A;&#x0627;&#x062F;&#x0631;&#x0629;.
                      <br>Please keep your booking reference for future use. Arrive at the airport at least 3 hours before departure.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td style="background-color: #1e40af; border-radius: 8px;">
                    <a href="#" style="display: inline-block; padding: 14px 36px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 8px;">&#x0625;&#x062F;&#x0627;&#x0631;&#x0629; &#x0627;&#x0644;&#x062D;&#x062C;&#x0632; | Manage Booking</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; height: 1px; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 16px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 14px; font-weight: 600; color: #1e40af;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644; | AIS Aviation</p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                &#x0634;&#x0643;&#x0631;&#x0627;&#x064B; &#x0644;&#x0627;&#x062E;&#x062A;&#x064A;&#x0627;&#x0631;&#x0643;&#x0645; &#x062E;&#x062F;&#x0645;&#x0627;&#x062A;&#x0646;&#x0627;. &#x0644;&#x0623;&#x064A; &#x0627;&#x0633;&#x062A;&#x0641;&#x0633;&#x0627;&#x0631;&#x0627;&#x062A;&#x060C; &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x062A;&#x0648;&#x0627;&#x0635;&#x0644; &#x0645;&#x0639; &#x0641;&#x0631;&#x064A;&#x0642; &#x0627;&#x0644;&#x062F;&#x0639;&#x0645;.
                <br>Thank you for choosing our services. For inquiries, please contact our support team.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 12px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                <a href="mailto:support@ais-aviation.com" style="color: #1e40af; text-decoration: underline;">support@ais-aviation.com</a>
                &nbsp;|&nbsp;
                <a href="tel:+966112345678" style="color: #1e40af; text-decoration: underline;">+966 11 234 5678</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 11px; color: #cbd5e1; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} AIS Aviation. &#x062C;&#x0645;&#x064A;&#x0639; &#x0627;&#x0644;&#x062D;&#x0642;&#x0648;&#x0642; &#x0645;&#x062D;&#x0641;&#x0648;&#x0638;&#x0629; | All rights reserved.
                <br>
                <a href="#" style="color: #94a3b8; text-decoration: underline;">&#x0625;&#x0644;&#x063A;&#x0627;&#x0621; &#x0627;&#x0644;&#x0627;&#x0634;&#x062A;&#x0631;&#x0627;&#x0643; | Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error("[Email Service] Error sending booking confirmation:", error);
    return false;
  }
}

/**
 * Send flight status change notification
 */
export async function sendFlightStatusChange(
  data: FlightStatusChangeData
): Promise<boolean> {
  try {
    const statusText =
      {
        delayed: "تأخرت",
        cancelled: "ألغيت",
        completed: "اكتملت",
        scheduled: "مجدولة",
      }[data.newStatus] || data.newStatus;

    const delayText = data.delayMinutes
      ? ` لمدة ${data.delayMinutes} دقيقة`
      : "";
    const reasonText = data.reason ? `\n\nالسبب: ${data.reason}` : "";

    // Status-dependent colors
    const statusColors: Record<
      string,
      {
        bg: string;
        text: string;
        banner: string;
        label: string;
        labelEn: string;
      }
    > = {
      delayed: {
        bg: "#fff7ed",
        text: "#c2410c",
        banner: "#ea580c",
        label: "&#x0645;&#x062A;&#x0623;&#x062E;&#x0631;&#x0629;",
        labelEn: "Delayed",
      },
      cancelled: {
        bg: "#fef2f2",
        text: "#dc2626",
        banner: "#dc2626",
        label: "&#x0645;&#x0644;&#x063A;&#x0627;&#x0629;",
        labelEn: "Cancelled",
      },
      completed: {
        bg: "#f0fdf4",
        text: "#16a34a",
        banner: "#16a34a",
        label: "&#x0645;&#x0643;&#x062A;&#x0645;&#x0644;&#x0629;",
        labelEn: "Completed",
      },
      scheduled: {
        bg: "#eff6ff",
        text: "#1e40af",
        banner: "#1e40af",
        label:
          "&#x0641;&#x064A; &#x0627;&#x0644;&#x0645;&#x0648;&#x0639;&#x062F;",
        labelEn: "On Schedule",
      },
    };
    const colors = statusColors[data.newStatus] || statusColors.scheduled;

    const template: EmailTemplate = {
      to: data.passengerEmail,
      subject: `تحديث حالة الرحلة ${data.flightNumber}`,
      text: `
مرحباً ${data.passengerName},

نود إعلامك بتحديث حالة رحلتك.

رقم الحجز: ${data.bookingReference}
رقم الرحلة: ${data.flightNumber}
المسار: ${data.origin} → ${data.destination}

الحالة الجديدة: ${statusText}${delayText}${reasonText}

نعتذر عن أي إزعاج قد يسببه هذا التغيير.

نظام الطيران المتكامل
      `.trim(),
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>&#x062A;&#x062D;&#x062F;&#x064A;&#x062B; &#x062D;&#x0627;&#x0644;&#x0629; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629; | Flight Status Update</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; -webkit-font-smoothing: antialiased; direction: rtl;">

  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f4f6f9;">
    &#x062A;&#x062D;&#x062F;&#x064A;&#x062B; &#x0631;&#x062D;&#x0644;&#x0629; ${data.flightNumber}: ${statusText}${delayText} | Flight ${data.flightNumber} status update: ${colors.labelEn}
  </div>

  <!-- Email wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f6f9;">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); padding: 32px 40px; text-align: center;">
              <p style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 1px;">AIS Aviation</p>
              <p style="margin: 4px 0 0; font-size: 14px; color: #bfdbfe;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644;</p>
            </td>
          </tr>

          <!-- Status Banner -->
          <tr>
            <td style="background-color: ${colors.banner}; padding: 20px 40px; text-align: center;">
              <p style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff;">&#x062A;&#x062D;&#x062F;&#x064A;&#x062B; &#x062D;&#x0627;&#x0644;&#x0629; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629;</p>
              <p style="margin: 6px 0 0; font-size: 14px; color: rgba(255,255,255,0.85);">Flight Status Update</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 28px 40px 0;" class="mobile-padding">
              <p style="margin: 0; font-size: 16px; color: #1e293b; line-height: 1.6;">
                &#x0645;&#x0631;&#x062D;&#x0628;&#x0627;&#x064B; <strong>${escapeHtml(data.passengerName)}</strong>,
              </p>
              <p style="margin: 8px 0 0; font-size: 15px; color: #475569; line-height: 1.6;">
                &#x0646;&#x0648;&#x062F; &#x0625;&#x0639;&#x0644;&#x0627;&#x0645;&#x0643; &#x0628;&#x062A;&#x062D;&#x062F;&#x064A;&#x062B; &#x062D;&#x0627;&#x0644;&#x0629; &#x0631;&#x062D;&#x0644;&#x062A;&#x0643;.
              </p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">
                We would like to inform you of an update to your flight status.
              </p>
            </td>
          </tr>

          <!-- Status Highlight Box -->
          <tr>
            <td style="padding: 24px 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${colors.bg}; border: 2px solid ${colors.text}; border-radius: 10px;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <p style="margin: 0 0 4px; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">&#x0627;&#x0644;&#x062D;&#x0627;&#x0644;&#x0629; &#x0627;&#x0644;&#x062C;&#x062F;&#x064A;&#x062F;&#x0629; | New Status</p>
                    <p style="margin: 0; font-size: 28px; font-weight: 800; color: ${colors.text};">${statusText}</p>
                    <p style="margin: 4px 0 0; font-size: 14px; font-weight: 600; color: ${colors.text};">${colors.labelEn}</p>
                    ${data.delayMinutes ? `<p style="margin: 12px 0 0; font-size: 15px; color: ${colors.text}; font-weight: 600;">&#x0645;&#x062F;&#x0629; &#x0627;&#x0644;&#x062A;&#x0623;&#x062E;&#x064A;&#x0631;: ${data.delayMinutes} &#x062F;&#x0642;&#x064A;&#x0642;&#x0629; | Delay: ${data.delayMinutes} minutes</p>` : ""}
                    ${data.reason ? `<p style="margin: 8px 0 0; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x0633;&#x0628;&#x0628; | Reason: ${escapeHtml(data.reason)}</p>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Flight Details -->
          <tr>
            <td style="padding: 0 40px 24px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0;">
                <tr>
                  <td colspan="2" style="background-color: #1e40af; padding: 14px 20px;">
                    <p style="margin: 0; font-size: 15px; font-weight: 700; color: #ffffff;">&#x062A;&#x0641;&#x0627;&#x0635;&#x064A;&#x0644; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629; | Flight Details</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b; width: 40%;">&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x062D;&#x062C;&#x0632; | Ref</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #1e40af; letter-spacing: 2px;">${data.bookingReference}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629; | Flight</td>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #1e293b;">${data.flightNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x0645;&#x0633;&#x0627;&#x0631; | Route</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 600; color: #1e293b;">${data.origin} &#x2192; ${data.destination}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 20px; background-color: #ffffff; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x0645;&#x063A;&#x0627;&#x062F;&#x0631;&#x0629; | Departure</td>
                  <td style="padding: 12px 20px; background-color: #ffffff; font-size: 15px; color: #1e293b;">${data.departureTime.toLocaleString("ar-SA")}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Apology / Note -->
          <tr>
            <td style="padding: 0 40px 28px;" class="mobile-padding">
              <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.6;">
                &#x0646;&#x0639;&#x062A;&#x0630;&#x0631; &#x0639;&#x0646; &#x0623;&#x064A; &#x0625;&#x0632;&#x0639;&#x0627;&#x062C; &#x0642;&#x062F; &#x064A;&#x0633;&#x0628;&#x0628;&#x0647; &#x0647;&#x0630;&#x0627; &#x0627;&#x0644;&#x062A;&#x063A;&#x064A;&#x064A;&#x0631;. &#x0644;&#x0644;&#x0645;&#x0632;&#x064A;&#x062F; &#x0645;&#x0646; &#x0627;&#x0644;&#x0645;&#x0639;&#x0644;&#x0648;&#x0645;&#x0627;&#x062A;&#x060C; &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x062A;&#x0648;&#x0627;&#x0635;&#x0644; &#x0645;&#x0639; &#x0641;&#x0631;&#x064A;&#x0642; &#x0627;&#x0644;&#x062F;&#x0639;&#x0645;.
              </p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">
                We apologize for any inconvenience. For further information, please contact our support team.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; height: 1px; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 16px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 14px; font-weight: 600; color: #1e40af;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644; | AIS Aviation</p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                &#x0644;&#x0623;&#x064A; &#x0627;&#x0633;&#x062A;&#x0641;&#x0633;&#x0627;&#x0631;&#x0627;&#x062A;&#x060C; &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x062A;&#x0648;&#x0627;&#x0635;&#x0644; &#x0645;&#x0639; &#x0641;&#x0631;&#x064A;&#x0642; &#x0627;&#x0644;&#x062F;&#x0639;&#x0645;.
                <br>For inquiries, please contact our support team.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 12px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                <a href="mailto:support@ais-aviation.com" style="color: #1e40af; text-decoration: underline;">support@ais-aviation.com</a>
                &nbsp;|&nbsp;
                <a href="tel:+966112345678" style="color: #1e40af; text-decoration: underline;">+966 11 234 5678</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 11px; color: #cbd5e1; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} AIS Aviation. &#x062C;&#x0645;&#x064A;&#x0639; &#x0627;&#x0644;&#x062D;&#x0642;&#x0648;&#x0642; &#x0645;&#x062D;&#x0641;&#x0648;&#x0638;&#x0629; | All rights reserved.
                <br>
                <a href="#" style="color: #94a3b8; text-decoration: underline;">&#x0625;&#x0644;&#x063A;&#x0627;&#x0621; &#x0627;&#x0644;&#x0627;&#x0634;&#x062A;&#x0631;&#x0627;&#x0643; | Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error("[Email Service] Error sending flight status change:", error);
    return false;
  }
}

/**
 * Send refund confirmation email
 */
export async function sendRefundConfirmation(
  data: RefundConfirmationData
): Promise<boolean> {
  try {
    const template: EmailTemplate = {
      to: data.passengerEmail,
      subject: `تأكيد استرداد المبلغ - ${data.bookingReference}`,
      text: `
مرحباً ${data.passengerName},

تم معالجة طلب استرداد المبلغ الخاص بك بنجاح.

تفاصيل الاسترداد:
- رقم الحجز: ${data.bookingReference}
- رقم الرحلة: ${data.flightNumber}
- المبلغ المسترد: ${(data.refundAmount / 100).toFixed(2)} ر.س
${data.refundReason ? `- السبب: ${data.refundReason}` : ""}

سيتم إرجاع المبلغ إلى طريقة الدفع الأصلية خلال ${data.processingDays} أيام عمل.

شكراً لتفهمكم.
نظام الطيران المتكامل
      `.trim(),
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>&#x062A;&#x0623;&#x0643;&#x064A;&#x062F; &#x0627;&#x0633;&#x062A;&#x0631;&#x062F;&#x0627;&#x062F; | Refund Confirmation</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; -webkit-font-smoothing: antialiased; direction: rtl;">

  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f4f6f9;">
    &#x062A;&#x0645; &#x0627;&#x0633;&#x062A;&#x0631;&#x062F;&#x0627;&#x062F; ${(data.refundAmount / 100).toFixed(2)} &#x0631;.&#x0633; - &#x062D;&#x062C;&#x0632; ${data.bookingReference} | Refund of ${(data.refundAmount / 100).toFixed(2)} SAR processed - Ref: ${data.bookingReference}
  </div>

  <!-- Email wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f6f9;">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); padding: 32px 40px; text-align: center;">
              <p style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 1px;">AIS Aviation</p>
              <p style="margin: 4px 0 0; font-size: 14px; color: #bfdbfe;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644;</p>
            </td>
          </tr>

          <!-- Refund Confirmed Banner -->
          <tr>
            <td style="background-color: #059669; padding: 20px 40px; text-align: center;">
              <p style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff;">&#x2713; &#x062A;&#x0645; &#x062A;&#x0623;&#x0643;&#x064A;&#x062F; &#x0627;&#x0644;&#x0627;&#x0633;&#x062A;&#x0631;&#x062F;&#x0627;&#x062F;</p>
              <p style="margin: 6px 0 0; font-size: 14px; color: #d1fae5;">Refund Confirmed</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 28px 40px 0;" class="mobile-padding">
              <p style="margin: 0; font-size: 16px; color: #1e293b; line-height: 1.6;">
                &#x0645;&#x0631;&#x062D;&#x0628;&#x0627;&#x064B; <strong>${escapeHtml(data.passengerName)}</strong>,
              </p>
              <p style="margin: 8px 0 0; font-size: 15px; color: #475569; line-height: 1.6;">
                &#x062A;&#x0645; &#x0645;&#x0639;&#x0627;&#x0644;&#x062C;&#x0629; &#x0637;&#x0644;&#x0628; &#x0627;&#x0633;&#x062A;&#x0631;&#x062F;&#x0627;&#x062F; &#x0627;&#x0644;&#x0645;&#x0628;&#x0644;&#x063A; &#x0627;&#x0644;&#x062E;&#x0627;&#x0635; &#x0628;&#x0643; &#x0628;&#x0646;&#x062C;&#x0627;&#x062D;.
              </p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">
                Your refund request has been processed successfully.
              </p>
            </td>
          </tr>

          <!-- Refund Amount Highlight -->
          <tr>
            <td style="padding: 24px 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0fdf4; border: 2px solid #059669; border-radius: 10px;">
                <tr>
                  <td style="padding: 28px; text-align: center;">
                    <p style="margin: 0 0 4px; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">&#x0627;&#x0644;&#x0645;&#x0628;&#x0644;&#x063A; &#x0627;&#x0644;&#x0645;&#x0633;&#x062A;&#x0631;&#x062F; | Refund Amount</p>
                    <p style="margin: 0; font-size: 36px; font-weight: 800; color: #059669;">${(data.refundAmount / 100).toFixed(2)} <span style="font-size: 18px;">&#x0631;.&#x0633;</span></p>
                    <p style="margin: 4px 0 0; font-size: 14px; color: #059669; font-weight: 600;">SAR</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Refund Details Table -->
          <tr>
            <td style="padding: 0 40px 24px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0;">
                <tr>
                  <td colspan="2" style="background-color: #1e40af; padding: 14px 20px;">
                    <p style="margin: 0; font-size: 15px; font-weight: 700; color: #ffffff;">&#x062A;&#x0641;&#x0627;&#x0635;&#x064A;&#x0644; &#x0627;&#x0644;&#x0627;&#x0633;&#x062A;&#x0631;&#x062F;&#x0627;&#x062F; | Refund Details</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b; width: 40%;">&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x062D;&#x062C;&#x0632; | Ref</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #1e40af; letter-spacing: 2px;">${data.bookingReference}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0631;&#x0642;&#x0645; &#x0627;&#x0644;&#x0631;&#x062D;&#x0644;&#x0629; | Flight</td>
                  <td style="padding: 12px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #1e293b;">${data.flightNumber}</td>
                </tr>
                ${
                  data.refundReason
                    ? `
                <tr>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b;">&#x0627;&#x0644;&#x0633;&#x0628;&#x0628; | Reason</td>
                  <td style="padding: 12px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #1e293b;">${escapeHtml(data.refundReason)}</td>
                </tr>
                `
                    : ""
                }
                <tr>
                  <td style="padding: 12px 20px; background-color: ${data.refundReason ? "#ffffff" : "#f8fafc"}; font-size: 14px; color: #64748b;">&#x0645;&#x062F;&#x0629; &#x0627;&#x0644;&#x0645;&#x0639;&#x0627;&#x0644;&#x062C;&#x0629; | Processing</td>
                  <td style="padding: 12px 20px; background-color: ${data.refundReason ? "#ffffff" : "#f8fafc"}; font-size: 15px; font-weight: 600; color: #1e293b;">${data.processingDays} &#x0623;&#x064A;&#x0627;&#x0645; &#x0639;&#x0645;&#x0644; | ${data.processingDays} business days</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Processing Info -->
          <tr>
            <td style="padding: 0 40px 28px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <p style="margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #1e40af;">&#x0645;&#x0639;&#x0644;&#x0648;&#x0645;&#x0627;&#x062A; &#x0627;&#x0644;&#x0645;&#x0639;&#x0627;&#x0644;&#x062C;&#x0629; | Processing Information</p>
                    <p style="margin: 0; font-size: 13px; color: #1e40af; line-height: 1.6;">
                      &#x0633;&#x064A;&#x062A;&#x0645; &#x0625;&#x0631;&#x062C;&#x0627;&#x0639; &#x0627;&#x0644;&#x0645;&#x0628;&#x0644;&#x063A; &#x0625;&#x0644;&#x0649; &#x0637;&#x0631;&#x064A;&#x0642;&#x0629; &#x0627;&#x0644;&#x062F;&#x0641;&#x0639; &#x0627;&#x0644;&#x0623;&#x0635;&#x0644;&#x064A;&#x0629; &#x062E;&#x0644;&#x0627;&#x0644; <strong>${data.processingDays} &#x0623;&#x064A;&#x0627;&#x0645; &#x0639;&#x0645;&#x0644;</strong>.
                      <br>The refund will be credited to your original payment method within <strong>${data.processingDays} business days</strong>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; height: 1px; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 16px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 14px; font-weight: 600; color: #1e40af;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644; | AIS Aviation</p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                &#x0634;&#x0643;&#x0631;&#x0627;&#x064B; &#x0644;&#x062A;&#x0641;&#x0647;&#x0645;&#x0643;&#x0645;. &#x0644;&#x0623;&#x064A; &#x0627;&#x0633;&#x062A;&#x0641;&#x0633;&#x0627;&#x0631;&#x0627;&#x062A;&#x060C; &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x062A;&#x0648;&#x0627;&#x0635;&#x0644; &#x0645;&#x0639; &#x0641;&#x0631;&#x064A;&#x0642; &#x0627;&#x0644;&#x062F;&#x0639;&#x0645;.
                <br>Thank you for your understanding. For inquiries, please contact our support team.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 12px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                <a href="mailto:support@ais-aviation.com" style="color: #1e40af; text-decoration: underline;">support@ais-aviation.com</a>
                &nbsp;|&nbsp;
                <a href="tel:+966112345678" style="color: #1e40af; text-decoration: underline;">+966 11 234 5678</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 11px; color: #cbd5e1; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} AIS Aviation. &#x062C;&#x0645;&#x064A;&#x0639; &#x0627;&#x0644;&#x062D;&#x0642;&#x0648;&#x0642; &#x0645;&#x062D;&#x0641;&#x0648;&#x0638;&#x0629; | All rights reserved.
                <br>
                <a href="#" style="color: #94a3b8; text-decoration: underline;">&#x0625;&#x0644;&#x063A;&#x0627;&#x0621; &#x0627;&#x0644;&#x0627;&#x0634;&#x062A;&#x0631;&#x0627;&#x0643; | Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error("[Email Service] Error sending refund confirmation:", error);
    return false;
  }
}

/**
 * Send check-in reminder email (24 hours before flight)
 */
export async function sendCheckInReminder(
  data: CheckInReminderData
): Promise<boolean> {
  try {
    const template: EmailTemplate = {
      to: data.passengerEmail,
      subject: `تذكير بتسجيل الوصول - رحلة ${data.flightNumber}`,
      text: `
مرحباً ${data.passengerName},

تذكير: رحلتك ستقلع خلال 24 ساعة!

تفاصيل الرحلة:
- رقم الحجز: ${data.bookingReference}
- رقم PNR: ${data.pnr}
- رقم الرحلة: ${data.flightNumber}
- من: ${data.origin}
- إلى: ${data.destination}
- موعد المغادرة: ${data.departureTime.toLocaleString("ar-SA")}

يمكنك الآن تسجيل الوصول عبر الرابط التالي:
${data.checkInUrl}

نصائح مهمة:
- يرجى الوصول للمطار قبل 3 ساعات على الأقل للرحلات الدولية
- تأكد من إحضار جواز السفر ساري المفعول
- يرجى التأكد من متطلبات الأمتعة

رحلة سعيدة!
نظام الطيران المتكامل
      `.trim(),
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f59e0b; color: white; padding: 20px; text-align: center; }
    .content { background: #fffbeb; padding: 20px; margin: 20px 0; border-right: 4px solid #f59e0b; }
    .detail { margin: 10px 0; }
    .label { font-weight: bold; color: #1f2937; }
    .cta-button { display: inline-block; background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .tips { background: #f3f4f6; padding: 15px; border-radius: 8px; margin-top: 20px; }
    .tips h3 { margin-top: 0; color: #1f2937; }
    .tips ul { margin: 0; padding-right: 20px; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⏰ تذكير بتسجيل الوصول</h1>
      <p>رحلتك ستقلع خلال 24 ساعة!</p>
    </div>
    <div class="content">
      <p>مرحباً ${escapeHtml(data.passengerName)},</p>

      <div class="detail"><span class="label">رقم الحجز:</span> ${data.bookingReference}</div>
      <div class="detail"><span class="label">رقم PNR:</span> ${data.pnr}</div>
      <div class="detail"><span class="label">رقم الرحلة:</span> ${data.flightNumber}</div>
      <div class="detail"><span class="label">من:</span> ${data.origin}</div>
      <div class="detail"><span class="label">إلى:</span> ${data.destination}</div>
      <div class="detail"><span class="label">موعد المغادرة:</span> ${data.departureTime.toLocaleString("ar-SA")}</div>

      <div style="text-align: center;">
        <a href="${sanitizeUrl(data.checkInUrl)}" class="cta-button">سجل الوصول الآن ✈️</a>
      </div>

      <div class="tips">
        <h3>نصائح مهمة:</h3>
        <ul>
          <li>يرجى الوصول للمطار قبل 3 ساعات على الأقل للرحلات الدولية</li>
          <li>تأكد من إحضار جواز السفر ساري المفعول</li>
          <li>يرجى التأكد من متطلبات الأمتعة</li>
        </ul>
      </div>
    </div>
    <div class="footer">
      <p>رحلة سعيدة! ✈️</p>
      <p>نظام الطيران المتكامل</p>
    </div>
  </div>
</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error("[Email Service] Error sending check-in reminder:", error);
    return false;
  }
}

/**
 * Send loyalty miles notification email
 */
export async function sendLoyaltyMilesNotification(
  data: LoyaltyMilesNotificationData
): Promise<boolean> {
  try {
    const tierNames: Record<string, string> = {
      bronze: "برونزي",
      silver: "فضي",
      gold: "ذهبي",
      platinum: "بلاتيني",
    };

    const tierName = tierNames[data.tierStatus] || data.tierStatus;
    const nextTierText = data.nextTierMiles
      ? `أنت على بعد ${data.nextTierMiles.toLocaleString("ar-SA")} ميل من المستوى التالي!`
      : "لقد وصلت للمستوى الأعلى!";

    const template: EmailTemplate = {
      to: data.passengerEmail,
      subject: `تهانينا! حصلت على ${data.milesEarned.toLocaleString("ar-SA")} ميل`,
      text: `
مرحباً ${data.passengerName},

تهانينا! لقد حصلت على أميال جديدة من رحلتك الأخيرة.

تفاصيل الأميال:
- رقم الحجز: ${data.bookingReference}
- الأميال المكتسبة: ${data.milesEarned.toLocaleString("ar-SA")} ميل
- إجمالي الأميال: ${data.totalMiles.toLocaleString("ar-SA")} ميل
- مستوى العضوية: ${tierName}

${nextTierText}

استخدم أميالك للحصول على:
- ترقية الدرجة
- رحلات مجانية
- خدمات إضافية مميزة

شكراً لولائك!
نظام الطيران المتكامل
      `.trim(),
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #8b5cf6, #6366f1); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; }
    .miles-badge { background: white; color: #8b5cf6; padding: 10px 20px; border-radius: 50px; display: inline-block; font-weight: bold; font-size: 24px; margin-top: 15px; }
    .content { background: #f5f3ff; padding: 20px; margin: 20px 0; }
    .stats { display: flex; justify-content: space-around; text-align: center; margin: 20px 0; }
    .stat { background: white; padding: 15px 25px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: #6366f1; }
    .stat-label { font-size: 12px; color: #6b7280; }
    .tier-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; }
    .tier-bronze { background: #cd7f32; color: white; }
    .tier-silver { background: #c0c0c0; color: #333; }
    .tier-gold { background: #ffd700; color: #333; }
    .tier-platinum { background: #e5e4e2; color: #333; }
    .benefits { background: white; padding: 15px; border-radius: 8px; margin-top: 20px; }
    .benefits h3 { margin-top: 0; color: #1f2937; }
    .benefits ul { margin: 0; padding-right: 20px; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 تهانينا!</h1>
      <p>لقد حصلت على أميال جديدة</p>
      <div class="miles-badge">+${data.milesEarned.toLocaleString("ar-SA")} ميل</div>
    </div>
    <div class="content">
      <p>مرحباً ${escapeHtml(data.passengerName)},</p>

      <div class="stats">
        <div class="stat">
          <div class="stat-value">${data.totalMiles.toLocaleString("ar-SA")}</div>
          <div class="stat-label">إجمالي الأميال</div>
        </div>
        <div class="stat">
          <span class="tier-badge tier-${data.tierStatus}">${tierName}</span>
          <div class="stat-label" style="margin-top: 8px;">مستوى العضوية</div>
        </div>
      </div>

      <p style="text-align: center; color: #6366f1; font-weight: bold;">${nextTierText}</p>

      <div class="benefits">
        <h3>استخدم أميالك للحصول على:</h3>
        <ul>
          <li>ترقية الدرجة</li>
          <li>رحلات مجانية</li>
          <li>خدمات إضافية مميزة</li>
        </ul>
      </div>
    </div>
    <div class="footer">
      <p>شكراً لولائك! ⭐</p>
      <p>نظام الطيران المتكامل</p>
    </div>
  </div>
</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error(
      "[Email Service] Error sending loyalty miles notification:",
      error
    );
    return false;
  }
}

/**
 * Send a generic notification email
 * Used by the notification service to email users for important events
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  message: string
): Promise<boolean> {
  try {
    const template: EmailTemplate = {
      to,
      subject,
      text: message,
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; -webkit-font-smoothing: antialiased; direction: rtl;">

  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f4f6f9;">
    ${escapeHtml(subject)} - &#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644; | AIS Aviation
  </div>

  <!-- Email wrapper -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f6f9;">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); padding: 32px 40px; text-align: center;">
              <p style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 1px;">AIS Aviation</p>
              <p style="margin: 4px 0 0; font-size: 14px; color: #bfdbfe;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644;</p>
            </td>
          </tr>

          <!-- Subject Banner -->
          <tr>
            <td style="background-color: #1e40af; padding: 16px 40px; text-align: center; border-top: 1px solid #2563eb;">
              <p style="margin: 0; font-size: 18px; font-weight: 700; color: #ffffff;">${escapeHtml(subject)}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;" class="mobile-padding">
              <p style="margin: 0; font-size: 15px; color: #1e293b; line-height: 1.8; white-space: pre-line;">${escapeHtml(message)}</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;" class="mobile-padding">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; height: 1px; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 16px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 14px; font-weight: 600; color: #1e40af;">&#x0646;&#x0638;&#x0627;&#x0645; &#x0627;&#x0644;&#x0637;&#x064A;&#x0631;&#x0627;&#x0646; &#x0627;&#x0644;&#x0645;&#x062A;&#x0643;&#x0627;&#x0645;&#x0644; | AIS Aviation</p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                &#x0644;&#x0623;&#x064A; &#x0627;&#x0633;&#x062A;&#x0641;&#x0633;&#x0627;&#x0631;&#x0627;&#x062A;&#x060C; &#x064A;&#x0631;&#x062C;&#x0649; &#x0627;&#x0644;&#x062A;&#x0648;&#x0627;&#x0635;&#x0644; &#x0645;&#x0639; &#x0641;&#x0631;&#x064A;&#x0642; &#x0627;&#x0644;&#x062F;&#x0639;&#x0645;.
                <br>For inquiries, please contact our support team.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 12px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                <a href="mailto:support@ais-aviation.com" style="color: #1e40af; text-decoration: underline;">support@ais-aviation.com</a>
                &nbsp;|&nbsp;
                <a href="tel:+966112345678" style="color: #1e40af; text-decoration: underline;">+966 11 234 5678</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px; text-align: center;" class="mobile-padding">
              <p style="margin: 0; font-size: 11px; color: #cbd5e1; line-height: 1.5;">
                &copy; ${new Date().getFullYear()} AIS Aviation. &#x062C;&#x0645;&#x064A;&#x0639; &#x0627;&#x0644;&#x062D;&#x0642;&#x0648;&#x0642; &#x0645;&#x062D;&#x0641;&#x0648;&#x0638;&#x0629; | All rights reserved.
                <br>
                <a href="#" style="color: #94a3b8; text-decoration: underline;">&#x0625;&#x0644;&#x063A;&#x0627;&#x0621; &#x0627;&#x0644;&#x0627;&#x0634;&#x062A;&#x0631;&#x0627;&#x0643; | Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error("[Email Service] Error sending notification email:", error);
    return false;
  }
}

/**
 * Send split payment request email
 */
export async function sendSplitPaymentRequest(
  data: SplitPaymentRequestData
): Promise<boolean> {
  try {
    const expiryText = data.expiresAt
      ? `يرجى إتمام الدفع قبل ${data.expiresAt.toLocaleDateString("ar-SA")}`
      : "";

    const template: EmailTemplate = {
      to: data.payerEmail,
      subject: `طلب دفع حصتك - الحجز ${data.bookingReference}`,
      text: `
مرحباً ${data.payerName},

تمت دعوتك للمشاركة في دفع حجز رحلة طيران.

تفاصيل الحجز:
- رقم الحجز: ${data.bookingReference}
- رقم الرحلة: ${data.flightNumber}
- المسار: ${data.route}
- تاريخ المغادرة: ${data.departureTime.toLocaleString("ar-SA")}

حصتك في الدفع: ${(data.amount / 100).toFixed(2)} ر.س

${expiryText}

يمكنك إتمام الدفع من خلال الرابط التالي:
${data.paymentUrl}

شكراً لاستخدامك خدماتنا!
نظام الطيران المتكامل
      `.trim(),
      html: `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f9fafb; padding: 25px; margin: 0; border: 1px solid #e5e7eb; }
    .amount-box { background: white; border: 2px solid #6366f1; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
    .amount { font-size: 32px; font-weight: bold; color: #6366f1; }
    .amount-label { font-size: 14px; color: #6b7280; }
    .detail { margin: 10px 0; padding: 10px; background: white; border-radius: 8px; }
    .label { font-weight: bold; color: #1f2937; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; font-size: 16px; }
    .cta-button:hover { background: linear-gradient(135deg, #4f46e5, #7c3aed); }
    .expiry-notice { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-top: 20px; color: #92400e; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; padding: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>طلب دفع حصتك</h1>
      <p>تمت دعوتك للمشاركة في دفع حجز رحلة</p>
    </div>
    <div class="content">
      <p>مرحباً ${escapeHtml(data.payerName)},</p>
      <p>تمت دعوتك للمشاركة في دفع حجز رحلة طيران. يرجى مراجعة التفاصيل أدناه وإتمام الدفع.</p>

      <div class="amount-box">
        <div class="amount-label">حصتك في الدفع</div>
        <div class="amount">${(data.amount / 100).toFixed(2)} ر.س</div>
      </div>

      <div class="detail"><span class="label">رقم الحجز:</span> ${data.bookingReference}</div>
      <div class="detail"><span class="label">رقم الرحلة:</span> ${data.flightNumber}</div>
      <div class="detail"><span class="label">المسار:</span> ${data.route}</div>
      <div class="detail"><span class="label">تاريخ المغادرة:</span> ${data.departureTime.toLocaleString("ar-SA")}</div>

      <div style="text-align: center;">
        <a href="${sanitizeUrl(data.paymentUrl)}" class="cta-button">ادفع الآن</a>
      </div>

      ${
        data.expiresAt
          ? `
      <div class="expiry-notice">
        <strong>تنبيه:</strong> يرجى إتمام الدفع قبل ${data.expiresAt.toLocaleDateString("ar-SA")}
      </div>
      `
          : ""
      }
    </div>
    <div class="footer">
      <p>شكراً لاستخدامك خدماتنا!</p>
      <p>نظام الطيران المتكامل</p>
    </div>
  </div>
</body>
</html>
      `.trim(),
    };

    return await sendEmail(template);
  } catch (error) {
    console.error(
      "[Email Service] Error sending split payment request:",
      error
    );
    return false;
  }
}
