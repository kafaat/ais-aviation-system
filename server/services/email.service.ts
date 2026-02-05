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
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
    .content { background: #f9fafb; padding: 20px; margin: 20px 0; }
    .detail { margin: 10px 0; }
    .label { font-weight: bold; color: #1f2937; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>تأكيد الحجز</h1>
    </div>
    <div class="content">
      <p>مرحباً ${data.passengerName},</p>
      <p>تم تأكيد حجزك بنجاح!</p>
      
      <div class="detail"><span class="label">رقم الحجز:</span> ${data.bookingReference}</div>
      <div class="detail"><span class="label">رقم PNR:</span> ${data.pnr}</div>
      <div class="detail"><span class="label">رقم الرحلة:</span> ${data.flightNumber}</div>
      <div class="detail"><span class="label">من:</span> ${data.origin}</div>
      <div class="detail"><span class="label">إلى:</span> ${data.destination}</div>
      <div class="detail"><span class="label">تاريخ المغادرة:</span> ${data.departureTime.toLocaleString("ar-SA")}</div>
      <div class="detail"><span class="label">تاريخ الوصول:</span> ${data.arrivalTime.toLocaleString("ar-SA")}</div>
      <div class="detail"><span class="label">الدرجة:</span> ${data.cabinClass === "economy" ? "اقتصادية" : "أعمال"}</div>
      <div class="detail"><span class="label">عدد الركاب:</span> ${data.numberOfPassengers}</div>
      <div class="detail"><span class="label">المبلغ الإجمالي:</span> ${(data.totalAmount / 100).toFixed(2)} ر.س</div>
    </div>
    <div class="footer">
      <p>شكراً لاختياركم خدماتنا!</p>
      <p>نظام الطيران المتكامل</p>
    </div>
  </div>
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
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
    .content { background: #fef2f2; padding: 20px; margin: 20px 0; border-right: 4px solid #dc2626; }
    .detail { margin: 10px 0; }
    .label { font-weight: bold; color: #1f2937; }
    .status { font-size: 18px; color: #dc2626; font-weight: bold; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>تحديث حالة الرحلة</h1>
    </div>
    <div class="content">
      <p>مرحباً ${data.passengerName},</p>
      <p>نود إعلامك بتحديث حالة رحلتك.</p>
      
      <div class="detail"><span class="label">رقم الحجز:</span> ${data.bookingReference}</div>
      <div class="detail"><span class="label">رقم الرحلة:</span> ${data.flightNumber}</div>
      <div class="detail"><span class="label">المسار:</span> ${data.origin} → ${data.destination}</div>
      
      <div class="detail status">الحالة الجديدة: ${statusText}${delayText}</div>
      ${data.reason ? `<div class="detail"><span class="label">السبب:</span> ${data.reason}</div>` : ""}
      
      <p>نعتذر عن أي إزعاج قد يسببه هذا التغيير.</p>
    </div>
    <div class="footer">
      <p>نظام الطيران المتكامل</p>
    </div>
  </div>
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
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #059669; color: white; padding: 20px; text-align: center; }
    .content { background: #f0fdf4; padding: 20px; margin: 20px 0; border-right: 4px solid #059669; }
    .detail { margin: 10px 0; }
    .label { font-weight: bold; color: #1f2937; }
    .amount { font-size: 24px; color: #059669; font-weight: bold; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>تأكيد استرداد المبلغ</h1>
    </div>
    <div class="content">
      <p>مرحباً ${data.passengerName},</p>
      <p>تم معالجة طلب استرداد المبلغ الخاص بك بنجاح.</p>
      
      <div class="detail"><span class="label">رقم الحجز:</span> ${data.bookingReference}</div>
      <div class="detail"><span class="label">رقم الرحلة:</span> ${data.flightNumber}</div>
      <div class="detail amount">المبلغ المسترد: ${(data.refundAmount / 100).toFixed(2)} ر.س</div>
      ${data.refundReason ? `<div class="detail"><span class="label">السبب:</span> ${data.refundReason}</div>` : ""}
      
      <p>سيتم إرجاع المبلغ إلى طريقة الدفع الأصلية خلال <strong>${data.processingDays} أيام عمل</strong>.</p>
    </div>
    <div class="footer">
      <p>شكراً لتفهمكم</p>
      <p>نظام الطيران المتكامل</p>
    </div>
  </div>
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
      <p>مرحباً ${data.passengerName},</p>

      <div class="detail"><span class="label">رقم الحجز:</span> ${data.bookingReference}</div>
      <div class="detail"><span class="label">رقم PNR:</span> ${data.pnr}</div>
      <div class="detail"><span class="label">رقم الرحلة:</span> ${data.flightNumber}</div>
      <div class="detail"><span class="label">من:</span> ${data.origin}</div>
      <div class="detail"><span class="label">إلى:</span> ${data.destination}</div>
      <div class="detail"><span class="label">موعد المغادرة:</span> ${data.departureTime.toLocaleString("ar-SA")}</div>

      <div style="text-align: center;">
        <a href="${data.checkInUrl}" class="cta-button">سجل الوصول الآن ✈️</a>
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
      <p>مرحباً ${data.passengerName},</p>

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
      <p>مرحباً ${data.payerName},</p>
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
        <a href="${data.paymentUrl}" class="cta-button">ادفع الآن</a>
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
