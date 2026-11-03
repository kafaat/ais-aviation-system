type Language = "ar" | "en";

const english =
  /\b(refund\w*|reimburs\w*|compensat\w*|entitl\w*|my rights|our rights|passengers?[’']? rights|file a claim|submit a claim|money back|cash back|cancel(?:lation|lations|ed|led|ling)?|denied boarding|fare rules?|gaca|eu261|uk261)\b/i;
const arabic =
  /استرداد|استرجاع|استعيد|استرجع|ارجع فلوس|ترجع فلوس|تعويض|حقوق|حقي(?!\p{L})|يحق لي|استحق|اعادة المبلغ|الغاء|الغيت|الغي|الغت|رفض الاركاب|رفض الصعود|لوائح|سياسة الناقل/u;

type Referral = "passenger_rights_review" | "exchange_review";

const exchangeEnglish =
  /\b(?:rebook(?:ing)?|reschedul(?:e|ing)|(?:change|exchange|switch|modify|move) (?:my |the |a |an |our |this )?(?:(?:return|outbound|second|first|paid|connecting) )?(?:bookings?|reservations?|tickets?|flights?|legs?|segments?|travel date))\b/i;
const exchangeArabic =
  /(?:تغيير|تعديل|تبديل|استبدال|اغير|اعدل|ابدل)\s+(?:(?:موعد|تاريخ|وقت)\s+)?(?:ال)?(?:رحل|حجز|تذكر|قطاع|مقطع)|اعادة (?:ال)?حجز/;

export function chatReferral(
  message: string,
  previousIntent?: string
): { intent: Referral; language: Language } | undefined {
  const normalized = message
    .normalize("NFKC")
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/[أإآٱ]/g, "ا");
  const language = /\p{Script=Arabic}/u.test(normalized) ? "ar" : "en";
  if (english.test(normalized) || arabic.test(normalized)) {
    return { intent: "passenger_rights_review", language };
  }
  if (exchangeEnglish.test(normalized) || exchangeArabic.test(normalized)) {
    return { intent: "exchange_review", language };
  }
  if (
    previousIntent === "passenger_rights_review" ||
    previousIntent === "exchange_review"
  ) {
    return { intent: previousIntent, language };
  }
}

export const passengerPolicyGuidance = {
  en: "If Saudi passenger-rights regulations apply to your flight, Article 5 requires the carrier to explain how it handles disruptions. Ask the operating airline to review your itinerary, fare terms and the reason for the disruption. Use its customer service channel for an individual decision. This chat has not issued a refund or approved compensation. Start a new chat to search for flights.",
  ar: "إذا كانت رحلتك مشمولة بلائحة حماية حقوق المسافرين السعودية، تُلزم المادة الخامسة الناقل بتوضيح آلية معالجة اضطرابات الرحلات. اطلب من الناقل المشغّل مراجعة مسارك وشروط تذكرتك وسبب الاضطراب عبر قناة خدمة العملاء. لم يصدر عن هذه المحادثة استرداد أو موافقة على تعويض. ابدأ محادثة جديدة للبحث عن رحلات.",
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
