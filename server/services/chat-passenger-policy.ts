type Language = "ar" | "en";

// Only wording about money back, compensation or passenger rights routes to
// the local referral. Words such as "cancel", "fare rules" or a bare "rights"
// also describe ordinary shopping and servicing questions, so they do not.
const english =
  /\b(refund\w*|reimburs\w*|compensat\w*|entitl\w*|my rights|our rights|passengers?[’']? rights|file a claim|submit a claim|money back|cash back|denied boarding|gaca|eu261|uk261)\b/i;
const arabic =
  /استرداد|استرجاع|استعيد|استرجع|ارجع فلوس|ترجع فلوس|تعويض|حقوق(?:ي| المسافر| الركاب| العملاء)|حقي(?!\p{L})|يحق لي|استحق|اعادة المبلغ|رفض الاركاب|رفض الصعود|سياسة الناقل/u;

type Referral = "passenger_rights_review" | "exchange_review";

const exchangeEnglish =
  /\b(?:rebook(?:ing)?|reschedul(?:e|ing)|(?:change|exchange|switch|modify|move|open) (?:my |the |a |an |our |this )?(?:(?:return|outbound|second|first|paid|connecting) )?(?:bookings?|reservations?|tickets?|flights?|legs?|segments?|travel date))\b/i;
const exchangeArabic =
  /(?:تغيير|تعديل|تبديل|استبدال|اغير|اعدل|ابدل)\s+(?:(?:موعد|تاريخ|وقت)\s+)?(?:ال)?(?:رحل|حجز|تذكر|قطاع|مقطع)|اعادة (?:ال)?حجز/;

export function chatReferral(
  message: string,
  previousIntent?: string
):
  | { intent: Referral; language: Language; trigger: "keyword" | "follow_up" }
  | undefined {
  const normalized = message
    .normalize("NFKC")
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/[أإآٱ]/g, "ا");
  const language = /\p{Script=Arabic}/u.test(normalized) ? "ar" : "en";
  if (english.test(normalized) || arabic.test(normalized)) {
    return { intent: "passenger_rights_review", language, trigger: "keyword" };
  }
  if (exchangeEnglish.test(normalized) || exchangeArabic.test(normalized)) {
    return { intent: "exchange_review", language, trigger: "keyword" };
  }
  if (
    previousIntent === "passenger_rights_review" ||
    previousIntent === "exchange_review"
  ) {
    return { intent: previousIntent, language, trigger: "follow_up" };
  }
}

export const passengerPolicyGuidance = {
  en: "If Saudi passenger-rights regulations apply to your flight, Article 5 requires the carrier to explain how it handles disruptions. Ask the operating airline to review your itinerary, fare terms and the reason for the disruption. Use its customer service channel for an individual decision. This chat has not issued a refund or approved compensation.",
  ar: "إذا كانت رحلتك مشمولة بلائحة حماية حقوق المسافرين السعودية، تُلزم المادة الخامسة الناقل بتوضيح آلية معالجة اضطرابات الرحلات. اطلب من الناقل المشغّل مراجعة مسارك وشروط تذكرتك وسبب الاضطراب عبر قناة خدمة العملاء. لم يصدر عن هذه المحادثة استرداد أو موافقة على تعويض.",
} as const;

export const exchangeGuidance = {
  en: "Choose your booking to review the segments, fare difference and seat details before confirming a change.",
  ar: "اختر حجزك لمراجعة القطاعات وعرض فرق السعر وحالة المقعد قبل تأكيد التغيير.",
} as const;

export const referralLabels = {
  exchange_review: {
    en: "Booking change review requested",
    ar: "مراجعة تغيير الحجز",
  },
  passenger_rights_review: {
    en: "Passenger rights review requested",
    ar: "طلب مراجعة حقوق المسافر",
  },
} as const;
