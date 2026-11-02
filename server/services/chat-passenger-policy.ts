type Language = "ar" | "en";

const english =
  /\b(refund\w*|reimburs\w*|compensat\w*|entitl\w*|my rights|our rights|passengers?[’']? rights|file a claim|submit a claim|money back|cash back|cancel(?:lation|lations|ed|led|ling)?|denied boarding|fare rules?|gaca|eu261|uk261)\b/i;
const arabic =
  /استرداد|استرجاع|استعيد|استرجع|ارجع فلوس|ترجع فلوس|تعويض|حقوق|حقي(?!\p{L})|يحق لي|استحق|اعادة المبلغ|الغاء|الغيت|الغي|الغت|رفض الاركاب|رفض الصعود|لوائح|سياسة الناقل/u;

export function passengerPolicyLanguage(
  message: string,
  continuing: boolean
): Language | undefined {
  const normalized = message
    .normalize("NFKC")
    .replace(/[\p{M}\u0640]/gu, "")
    .replace(/[أإآٱ]/g, "ا");
  if (continuing || english.test(normalized) || arabic.test(normalized)) {
    return /\p{Script=Arabic}/u.test(normalized) ? "ar" : "en";
  }
}

export const passengerPolicyGuidance = {
  en: "If Saudi passenger-rights regulations apply to your flight, Article 5 requires the carrier to explain how it handles disruptions. Ask the operating airline to review your itinerary, fare terms and the reason for the disruption. Use its customer service channel for an individual decision. This chat has not issued a refund or approved compensation. Start a new chat to search for flights.",
  ar: "إذا كانت رحلتك مشمولة بلائحة حماية حقوق المسافرين السعودية، تُلزم المادة الخامسة الناقل بتوضيح آلية معالجة اضطرابات الرحلات. اطلب من الناقل المشغّل مراجعة مسارك وشروط تذكرتك وسبب الاضطراب عبر قناة خدمة العملاء. لم يصدر عن هذه المحادثة استرداد أو موافقة على تعويض. ابدأ محادثة جديدة للبحث عن رحلات.",
} as const;
