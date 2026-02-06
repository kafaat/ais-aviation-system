/**
 * AI Guardrails Service
 *
 * Provides safety controls for AI-powered features:
 * - PII masking (credit cards, emails, phones, passport numbers)
 * - Content filtering (inappropriate content detection)
 * - Message length validation
 * - Rate limiting awareness
 */

// ============================================================================
// PII Patterns
// ============================================================================

const PII_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string;
  name: string;
}> = [
  {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: "[CARD_NUMBER]",
    name: "credit_card",
  },
  {
    pattern: /\b\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/g,
    replacement: "[SSN]",
    name: "ssn",
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[EMAIL]",
    name: "email",
  },
  {
    pattern: /(?:\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g,
    replacement: "[PHONE]",
    name: "phone",
  },
  {
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
    replacement: "[PASSPORT]",
    name: "passport",
  },
  {
    pattern: /\b\d{10}\b/g,
    replacement: "[ID_NUMBER]",
    name: "national_id",
  },
  {
    pattern: /\bSA\d{22}\b/gi,
    replacement: "[IBAN]",
    name: "iban",
  },
];

// ============================================================================
// Content Filtering
// ============================================================================

const BLOCKED_PATTERNS = [
  /\b(hack|exploit|inject|xss|sql\s*injection)\b/i,
  /\b(ignore\s+(previous|above|all)\s+(instructions?|prompts?|rules?))\b/i,
  /\b(you\s+are\s+now|act\s+as\s+if|pretend\s+(to\s+be|you\s+are))\b/i,
  /\b(system\s*prompt|override\s*(instructions?|rules?))\b/i,
];

const INAPPROPRIATE_PATTERNS = [
  /\b(bomb|weapon|terror|kill|murder)\b/i,
  /\b(drug|narcotic|cocaine|heroin)\b/i,
];

// ============================================================================
// Configuration
// ============================================================================

export const AI_LIMITS = {
  maxMessageLength: 2000,
  maxMessagesPerConversation: 100,
  maxConversationsPerUser: 50,
  maxTokensPerRequest: 4000,
  minMessageLength: 1,
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Mask PII in text content
 */
export function maskPII(text: string): {
  masked: string;
  detectedTypes: string[];
} {
  let masked = text;
  const detectedTypes: string[] = [];

  for (const { pattern, replacement, name } of PII_PATTERNS) {
    const newPattern = new RegExp(pattern.source, pattern.flags);
    if (newPattern.test(masked)) {
      detectedTypes.push(name);
      masked = masked.replace(
        new RegExp(pattern.source, pattern.flags),
        replacement
      );
    }
  }

  return { masked, detectedTypes };
}

/**
 * Check content for blocked patterns (prompt injection, etc.)
 */
export function checkContentSafety(text: string): {
  safe: boolean;
  reason?: string;
  severity: "blocked" | "warning" | "clean";
} {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: "Content contains potentially harmful instructions",
        severity: "blocked",
      };
    }
  }

  for (const pattern of INAPPROPRIATE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: true,
        reason: "Content may contain sensitive topics",
        severity: "warning",
      };
    }
  }

  return { safe: true, severity: "clean" };
}

/**
 * Validate message before sending to AI
 */
export function validateMessage(message: string): {
  valid: boolean;
  error?: string;
  sanitized: string;
} {
  if (!message || message.trim().length === 0) {
    return { valid: false, error: "Message cannot be empty", sanitized: "" };
  }

  if (message.length > AI_LIMITS.maxMessageLength) {
    return {
      valid: false,
      error: `Message exceeds maximum length of ${AI_LIMITS.maxMessageLength} characters`,
      sanitized: message.slice(0, AI_LIMITS.maxMessageLength),
    };
  }

  // Check content safety
  const safety = checkContentSafety(message);
  if (safety.severity === "blocked") {
    return {
      valid: false,
      error: safety.reason,
      sanitized: "",
    };
  }

  // Mask PII
  const { masked } = maskPII(message);

  return { valid: true, sanitized: masked };
}

/**
 * Sanitize AI response before sending to user
 */
export function sanitizeResponse(response: string): string {
  // Mask any PII that might have leaked into the response
  const { masked } = maskPII(response);
  return masked;
}

/**
 * Get suggested messages based on conversation context
 */
export function getSuggestedMessages(context?: {
  originId?: number;
  destinationId?: number;
  departureDate?: string;
  passengers?: number;
}): string[] {
  if (!context || (!context.originId && !context.destinationId)) {
    return [
      "أريد حجز رحلة من الرياض إلى جدة",
      "ما هي أرخص الرحلات المتاحة غداً؟",
      "أبحث عن رحلة درجة رجال الأعمال",
      "هل توجد رحلات مباشرة إلى دبي؟",
      "I want to book a flight from Riyadh to Jeddah",
      "Show me the cheapest flights tomorrow",
    ];
  }

  if (context.originId && context.destinationId && !context.departureDate) {
    return [
      "غداً",
      "الأسبوع القادم",
      "أريد تاريخ مرن",
      "Tomorrow",
      "Next week",
      "I'm flexible with dates",
    ];
  }

  if (context.departureDate && !context.passengers) {
    return [
      "مسافر واحد",
      "مسافرين اثنين",
      "عائلة (4 أشخاص)",
      "1 passenger",
      "2 passengers",
      "Family (4 people)",
    ];
  }

  return [
    "أرني أرخص الخيارات",
    "أفضل رحلة مباشرة",
    "درجة رجال الأعمال",
    "Show cheapest options",
    "Best direct flight",
    "Business class",
  ];
}
