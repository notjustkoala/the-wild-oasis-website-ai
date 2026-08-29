import "server-only";

import { readBoundedConciergeJson, validateConciergeRequestBody } from "@/app/_ai/concierge-request";
import { addRelativeOperationsDateHint } from "@/app/_ai/operations-types";

export const MAX_OPERATIONS_BODY_BYTES = 40_000;
export const MAX_OPERATIONS_AGENT_TEXT_CHARS = 2_000;

const sensitiveValuePattern =
  /((?:name|email|e-mail|phone|telephone|mobile|observations?|note|姓名|名字|邮箱|邮件|电话|手机号|备注|留言)\s*[:：=]\s*)[\s\S]*?(?=(?:\s*(?:name|email|e-mail|phone|telephone|mobile|observations?|note|姓名|名字|邮箱|邮件|电话|手机号|备注|留言)\s*[:：=])|(?:\s*[;,]\s*(?:add|create|write|draft)\s+(?:an?\s+)?(?:internal\s+)?note\b)|(?:\s*[;,]\s*(?:添加|创建|写入|草拟)\s*(?:内部)?备注\b)|$)/giu;
const freeformNoteCommandPattern =
  /((?:add|create|write|draft)\s+(?:an?\s+)?(?:internal\s+)?note\s*[:：-]?\s*)(?:(?:(?:for\s+)?booking(?:id)?\s*[:=]?\s*#?\s*)([1-9]\d*)\s*[:：-]?\s*)?([\s\S]+)$/giu;
const cjkNoteCommandPattern =
  /((?:添加|创建|写入|草拟)\s*(?:内部)?备注\s*[:：-]?\s*)([\s\S]+)$/gu;
const bookingIdPattern = /(?:(?:(?:for\s+)?booking(?:id)?)|(?:订单|预订))\s*[:：=]?\s*#?\s*([1-9]\d*)/iu;
const ordinaryBookingIdPattern =
  /((?:\bbooking(?:\s*id)?|预订|订单)\s*(?:[:：=#]\s*)?#?\s*)([1-9]\d*)\b/giu;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phonePattern = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/gu;
const englishPossessiveNamePattern = /\b[A-Z][a-z]{1,30}['’]s\b/gu;
const explicitLatinNameSlotPattern =
  /\b((?:guest|customer|name|booking\s+for)\s+)((?:\p{L}[\p{L}'’\-]{0,40})(?:(?:\s*(?:,|and|&)\s+|\s+)\p{L}[\p{L}'’\-]{0,40}){0,4}?)(?=\s*(?:,|;|$|booking|reservation|tomorrow|today|next|on|from|between|__OPERATIONS_RELATIVE_DATE_\d+__))/giu;
const latinNameContextPattern =
  /\b((?:for|from)\s+)((?:\p{Lu}[\p{L}'’\-]{1,40})(?:(?:\s*(?:,|and|&)\s+|\s+)\p{Lu}[\p{L}'’\-]{1,40})*)(?=\s*(?:,|;|$|booking|reservation|tomorrow|today|next|on|from|between|__OPERATIONS_RELATIVE_DATE_\d+__))/giu;
const englishSearchNamePattern =
  /\b((?:find|show|open|lookup|locate|search)\s+)((?:\p{Lu}[\p{L}'’\-]{1,40})(?:(?:\s*(?:,|and|&)\s+|\s+)\p{Lu}[\p{L}'’\-]{1,40})*)(?=\s+(?:booking|reservation)\b)/giu;
const multilingualNameContextPattern =
  /\b((?:para|desde|huésped|cliente|nombre|pour|invité|client|nom|für|gast|kunde|name)\s+)(?!\d+\b)(\p{L}[\p{L}'’\-]{1,40}(?:(?:\s*(?:,|and|y|et|und|&)\s+|\s+)\p{L}[\p{L}'’\-]{1,40}){0,2})(?=\s*(?:,|;|$|booking|reservation|reserva|réservation|reservierung))/giu;
const cjkNameListContextPattern =
  /\b((?:for|from|guest|customer|booking\s+for)\s+)([\u3400-\u9fff]{2,4}(?:(?:\s*[,，、和及与]\s*)[\u3400-\u9fff]{2,4})+)/gu;
const nonLatinNameContextPattern =
  /\b((?:for|from|guest|customer|booking\s+for)\s+)([\u3400-\u9fff]{2,4})/gu;
const chineseNameContextPattern =
  /((?:查询|查找|显示|打开|定位|搜索|为|给|姓名|名字|客户|宾客|预订|予約)\s*)([\u3400-\u9fff]{2,4})(?=(?:的)?(?:预订|订单|booking|reservation)|\s|[，,;。！？!?]|$)/gu;
const russianNameContextPattern =
  /((?:для|гость|имя|клиент)\s+)([А-ЯЁ][а-яё]{1,30}(?:\s+[А-ЯЁ][а-яё]{1,30})?)/giu;
const bareLatinNameLookupPattern =
  /(^|[\n,;.!?]\s*)(\p{L}[\p{L}'’\-]{1,40}\s+\p{L}[\p{L}'’\-]{1,40}(?:\s+\p{L}[\p{L}'’\-]{1,40})?)(?=\s+(?:booking|reservation)\b)/giu;
const frenchNameLookupPattern =
  /(\b(?:réservation|reservation)\s+(?:de|pour)\s+)(\p{L}[\p{L}'’\-]{1,40}\s+\p{L}[\p{L}'’\-]{1,40}(?:\s+\p{L}[\p{L}'’\-]{1,40})?)/giu;
const russianBookingNamePattern =
  /(^|[\s,;.!?])((?:бронировани\p{L}*|заказ\p{L}*)\s+(?:для\s+)?)([а-яё][а-яё'’\-]{1,40}\s+[а-яё][а-яё'’\-]{1,40}(?:\s+[а-яё][а-яё'’\-]{1,40})?)/giu;
const bareCjkNameLookupPattern =
  /(^|[\s，,;。！？!?])([\u3400-\u9fff]{2,4})(?=的(?:预订|订单))/gu;
const relativeOperationsDatePhrasePattern =
  /\b(?:today|tomorrow)(?:['’]s)?\b|\b(?:next|past|last)\s+[1-9]\d{0,2}\s+(?:days?|weeks?|months?|years?)\b|\bthis\s+(?:week|month|year)\b|(?:未来|接下来)\s*(?:[1-9]\d{0,2}|七)\s*天|(?:今天|明天|未来七天|本周|下周|本月|上月)/giu;
const operationalLatinLookupWords = new Set([
  "active", "all", "arrival", "arrivals", "booking", "bookings", "cabin", "cabins", "cancelled", "canceled",
  "checked", "count", "current", "detail", "details", "find", "for", "guest", "guests", "locate", "lookup",
  "metric", "metrics", "next", "of", "open", "operational", "paid", "past", "payment", "payments", "pending",
  "performance", "recent", "report", "revenue", "risk", "risks", "risky", "search", "show", "status", "summary",
  "today", "tomorrow", "unpaid", "upcoming",
]);
const operationalCjkLookupTerms = new Set([
  "今天", "明天", "未来", "未来七天", "接下来", "未付款", "已付款", "已取消", "取消", "到店",
  "离店", "高风险", "有风险", "所有", "本周", "下周", "本月", "上月", "收入", "统计", "收入统计",
]);
const SAFE_BOOKING_LOOKUP_FALLBACK = "Booking lookup requires a numeric bookingId; guest names are not sent to the AI.";
// Validation consumes composable, known-safe grammar categories: operational
// intents/filters, booking nouns, bounded time phrases, and allow-listed
// actions/connectors. Anything left that is a Unicode letter is ambiguous and
// therefore never reaches the model. Date units are consumed only as complete
// phrases, so safe-word collisions such as "All Day booking" fail closed.
const safeOperationsSyntax = [
  /\[redacted\]/giu,
  /__(?:BOOKING_ID|OPERATIONS_DATE|OPERATIONS_RELATIVE_DATE)_\d+__/gu,
  /\bbooking\s*id\b/giu,
  /\b(?:bookings?|reservations?)\b/giu,
  /(?:预订|订单)/gu,
  /\bcabin\s+performance\b/giu,
  /\btotal\s+revenue\b/giu,
  /\bspecial\s+(?:requests?|attention)\b/giu,
  /\bhow\s+many\b/giu,
  /\b(?:is|are)\s+there\b/giu,
  /\b(?:metrics?|revenue|payments?|status|details?|counts?|summary|reports?|risks?|arrivals?|departures?|cabins?|guests?|customers?|notes?|approvals?)\b/giu,
  /\b(?:operational|unpaid|paid|upcoming|active|current|past|pending|cancelled|canceled|unconfirmed|risky|all|total|recent|checked|attention|internal|usd)\b/giu,
  /\b(?:please|show|find|open|lookup|locate|search|retrieve|list|check|get|give|add|create|write|draft|approve|reject)\b/giu,
  /\b(?:who|what|which|how|is|are|do|does|need|needs|arrive|arriving|depart|departing)\b/giu,
  /\b(?:for|from|to|through|on|in|the|with|between|and|of|at|during|within|by|as|a|an|me)\b/giu,
  /\b(?:name|e-?mail|phone|telephone|mobile|observations?)\b/giu,
  /(?:舱房表现|收入统计|特殊需求|特殊要求|高风险|有风险|未付款|已付款|已取消|取消|到店|离店|所有|指标|统计|收入|付款|状态|详情|汇总|总计|风险|预订|订单|舱房|宾客|客户|备注|审批|运营|注意)/gu,
  /(?:添加|创建|写入|草拟|批准|拒绝|帮我查|查询|查找|查看|显示|打开|定位|搜索|请查|列出|获取|查)/gu,
  /(?:姓名|名字|邮箱|邮件|电话|手机号|观察|留言|内部)/gu,
  /(?:有哪些|哪些|什么|是否|有|需要|的|从|至|到|和|与|以及|且|请|吗)/gu,
];

function isOperationalLatinCandidate(candidate: string) {
  const normalized = candidate.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
  if (/^(?:metrics?|revenue) for$/u.test(normalized) || normalized === "total revenue for") {
    return true;
  }
  const words = normalized.split(" ");
  return words.length > 0 && words.every((word) => operationalLatinLookupWords.has(word));
}

function redactLatinNameCandidate(match: string, prefix: string, candidate: string) {
  return isOperationalLatinCandidate(candidate) ? match : `${prefix}[redacted]`;
}

function redactCjkNameCandidate(match: string, prefix: string, candidate: string) {
  const hasPossessiveSuffix = candidate.endsWith("的");
  const normalizedCandidate = hasPossessiveSuffix ? candidate.slice(0, -1) : candidate;
  if (operationalCjkLookupTerms.has(normalizedCandidate)) return match;
  return `${prefix}[redacted]${hasPossessiveSuffix ? "的" : ""}`;
}

function containsUnsupportedLetterScript(text: string) {
  return Array.from(text).some(
    (character) =>
      /\p{L}/u.test(character) &&
      !/[\p{Script=Latin}\p{Script=Han}]/u.test(character)
  );
}

function enforceOperationsTextBoundary(text: string) {
  let remainder = text;
  for (const pattern of safeOperationsSyntax) remainder = remainder.replace(pattern, " ");
  const unexpected = remainder.replace(/[=\p{P}\p{Z}\s]/gu, "");
  return unexpected.length > 0 ? SAFE_BOOKING_LOOKUP_FALLBACK : text;
}

function safeStructuredPrefix(text: string, maxLength: number) {
  let cutAt = maxLength;
  const structuredValues = [
    /(?:\bbooking(?:\s*id)?|预订|订单)\s*(?:[:：=#]\s*)?#?\s*[1-9]\d*/giu,
    /\b\d{4}-\d{2}-\d{2}\b/gu,
    new RegExp(relativeOperationsDatePhrasePattern.source, relativeOperationsDatePhrasePattern.flags),
  ];
  for (const pattern of structuredValues) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (start < cutAt && end > cutAt) cutAt = start;
    }
  }
  return text.slice(0, cutAt).trimEnd();
}

function addBoundedOperationsDateHint(text: string, referenceDate: Date, originalText: string) {
  if (text === SAFE_BOOKING_LOOKUP_FALLBACK) return text;
  const withHint = addRelativeOperationsDateHint(text, referenceDate, originalText);
  if (withHint.length <= MAX_OPERATIONS_AGENT_TEXT_CHARS) return withHint;

  const hintStart = withHint.indexOf("\n[Server-");
  if (hintStart < 0) return safeStructuredPrefix(withHint, MAX_OPERATIONS_AGENT_TEXT_CHARS);
  const hint = withHint.slice(hintStart);
  const availableForText = Math.max(0, MAX_OPERATIONS_AGENT_TEXT_CHARS - hint.length);
  return `${safeStructuredPrefix(text, availableForText)}${hint}`;
}

/**
 * The staff question is untrusted input too. Keep the natural-language
 * intent, but ensure obvious guest identifiers and free-form observation
 * values never become model context. Booking IDs remain available through
 * the allow-listed booking detail tool.
 */
export function sanitizeOperationsUserText(text: string) {
  if (text.length > MAX_OPERATIONS_AGENT_TEXT_CHARS) {
    return SAFE_BOOKING_LOOKUP_FALLBACK;
  }

  const bookingIdTokens: string[] = [];
  const dateTokens: string[] = [];
  const relativeDateTokens: string[] = [];
  const tokenForBookingId = (bookingId: string) => {
    const token = `__BOOKING_ID_${bookingIdTokens.length}__`;
    bookingIdTokens.push(bookingId);
    return token;
  };
  const tokenForDate = (date: string) => {
    const token = `__OPERATIONS_DATE_${dateTokens.length}__`;
    dateTokens.push(date);
    return token;
  };
  const tokenForRelativeDate = (datePhrase: string) => {
    const token = `__OPERATIONS_RELATIVE_DATE_${relativeDateTokens.length}__`;
    relativeDateTokens.push(datePhrase);
    return token;
  };
  const redactNoteCommand = (value: string, pattern: RegExp) => value.replace(
    pattern,
    (match: string, commandPrefix: string) => {
      const bookingId = bookingIdPattern.exec(match.slice(commandPrefix.length))?.[1];
      // A labelled-value pass runs afterwards. Avoid recreating a `备注：...`
      // shape here, otherwise that pass would consume the protected booking ID
      // together with the already-redacted body.
      const safeCommandPrefix = commandPrefix.includes("备注")
        ? commandPrefix.replace(/[:：-]\s*$/u, " ")
        : commandPrefix;
      return bookingId
        ? `${safeCommandPrefix}bookingId=${tokenForBookingId(bookingId)}: [redacted]`
        : `${safeCommandPrefix}[redacted]`;
    }
  );

  const noteRedacted = redactNoteCommand(
    redactNoteCommand(text, freeformNoteCommandPattern),
    cjkNoteCommandPattern
  );
  const tokenized = noteRedacted
    .replace(ordinaryBookingIdPattern, (_match, prefix: string, bookingId: string) =>
      `${prefix}${tokenForBookingId(bookingId)}`
    )
    .replace(/\b\d{4}-\d{2}-\d{2}\b/gu, (date) => tokenForDate(date))
    // Protect only complete, allow-listed relative-date phrases. This keeps
    // CJK dates and today/tomorrow possessives out of the deliberately broad
    // fail-closed name detectors without protecting arbitrary nearby words.
    .replace(relativeOperationsDatePhrasePattern, (datePhrase) => tokenForRelativeDate(datePhrase));

  // Operations prompts intentionally support Latin and Han text only. Once
  // note bodies and safe numeric/date values are protected, any remaining
  // letter from another script is ambiguous and must fail closed regardless
  // of which language-specific word was used for "booking".
  if (containsUnsupportedLetterScript(tokenized)) {
    return SAFE_BOOKING_LOOKUP_FALLBACK;
  }

  const sanitized = tokenized
    .replace(sensitiveValuePattern, "$1[redacted]")
    .replace(emailPattern, "[redacted]")
    .replace(phonePattern, "[redacted]")
    .replace(explicitLatinNameSlotPattern, "$1[redacted]")
    .replace(latinNameContextPattern, redactLatinNameCandidate)
    .replace(englishSearchNamePattern, redactLatinNameCandidate)
    .replace(multilingualNameContextPattern, "$1[redacted]")
    .replace(frenchNameLookupPattern, "$1[redacted]")
    .replace(russianBookingNamePattern, "$1$2[redacted]")
    .replace(bareLatinNameLookupPattern, redactLatinNameCandidate)
    .replace(cjkNameListContextPattern, "$1[redacted]")
    .replace(nonLatinNameContextPattern, "$1[redacted]")
    .replace(chineseNameContextPattern, redactCjkNameCandidate)
    .replace(bareCjkNameLookupPattern, redactCjkNameCandidate)
    .replace(russianNameContextPattern, "$1[redacted]")
    .replace(englishPossessiveNamePattern, "[redacted]");

  const bounded = enforceOperationsTextBoundary(sanitized);
  if (bounded === SAFE_BOOKING_LOOKUP_FALLBACK) return bounded;

  const restored = bounded
    .replace(/__BOOKING_ID_(\d+)__/g, (_token, index: string) => bookingIdTokens[Number(index)] ?? "[redacted]")
    .replace(/__OPERATIONS_DATE_(\d+)__/g, (_token, index: string) => dateTokens[Number(index)] ?? "[redacted]")
    .replace(/__OPERATIONS_RELATIVE_DATE_(\d+)__/g, (_token, index: string) => relativeDateTokens[Number(index)] ?? "[redacted]");

  return restored.length > MAX_OPERATIONS_AGENT_TEXT_CHARS
    ? SAFE_BOOKING_LOOKUP_FALLBACK
    : restored;
}

export async function readOperationsRequest(request: Request, referenceDate = new Date()) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_OPERATIONS_BODY_BYTES) {
    return { ok: false as const, status: 413 as const, message: "The request is too large." };
  }
  const parsed = await readBoundedConciergeJson(request);
  if (!parsed.ok) return parsed;
  const validated = validateConciergeRequestBody(parsed.body);
  if (!validated.ok) return { ok: false as const, status: 400 as const, message: validated.message };
  return {
    ok: true as const,
    uiMessages: validated.uiMessages.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "text"
          ? { ...part, text: addBoundedOperationsDateHint(sanitizeOperationsUserText(part.text), referenceDate, part.text) }
          : part
        ),
    })),
  };
}
