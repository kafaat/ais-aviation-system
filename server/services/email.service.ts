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

/**
 * Mock email sending function
 * In production, replace with actual email service API call
 */
async function sendEmail(template: EmailTemplate): Promise<boolean> {
  console.log("[Email Service] Sending email:");
  console.log(`  To: ${template.to}`);
  console.log(`  Subject: ${template.subject}`);
  console.log(`  Content: ${template.text || template.html.substring(0, 100)}...`);
  
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
      text: `
مرحباً ${data.passengerName},

تم تأكيد حجزك بنجاح!

تفاصيل الحجز:
- رقم الحجز: ${data.bookingReference}
- رقم PNR: ${data.pnr}
- رقم الرحلة: ${data.flightNumber}
- من: ${data.origin}
- إلى: ${data.destination}
- تاريخ المغادرة: ${data.departureTime.toLocaleString('ar-SA')}
- تاريخ الوصول: ${data.arrivalTime.toLocaleString('ar-SA')}
- الدرجة: ${data.cabinClass === 'economy' ? 'اقتصادية' : 'أعمال'}
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
      <div class="detail"><span class="label">تاريخ المغادرة:</span> ${data.departureTime.toLocaleString('ar-SA')}</div>
      <div class="detail"><span class="label">تاريخ الوصول:</span> ${data.arrivalTime.toLocaleString('ar-SA')}</div>
      <div class="detail"><span class="label">الدرجة:</span> ${data.cabinClass === 'economy' ? 'اقتصادية' : 'أعمال'}</div>
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
    const statusText = {
      delayed: 'تأخرت',
      cancelled: 'ألغيت',
      completed: 'اكتملت',
      scheduled: 'مجدولة',
    }[data.newStatus] || data.newStatus;

    const delayText = data.delayMinutes ? ` لمدة ${data.delayMinutes} دقيقة` : '';
    const reasonText = data.reason ? `\n\nالسبب: ${data.reason}` : '';

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
      ${data.reason ? `<div class="detail"><span class="label">السبب:</span> ${data.reason}</div>` : ''}
      
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
${data.refundReason ? `- السبب: ${data.refundReason}` : ''}

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
      ${data.refundReason ? `<div class="detail"><span class="label">السبب:</span> ${data.refundReason}</div>` : ''}
      
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
