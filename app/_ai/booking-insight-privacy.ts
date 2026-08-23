import "server-only";

import { createHash } from "node:crypto";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d\s().-]{6,}\d)(?!\w)/g;
// A long identifier must contain a digit. This avoids redacting ordinary words
// such as "celebration" while still covering passports and national IDs.
const LONG_ID_PATTERN =
  /\b(?=[A-Z0-9-]{10,}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/gi;
const LABELED_NAME_PATTERN =
  /\b(guest\s+name|name)\s*(?::|=|-)?\s+([A-Z][A-Za-z'’-]{1,30}(?:\s+[A-Z][A-Za-z'’-]{1,30}){0,3})\b/gi;
const UNLABELED_TITLECASE_NAME_PATTERN =
  /\b[A-Z][a-z'’-]{1,30}\s+[A-Z][a-z'’-]{1,30}\b/;
const SENSITIVE_LABEL_PATTERN =
  /\b(passport|national\s+id|social\s+security|ssn|date\s+of\s+birth|dob|home\s+address|street\s+address|phone|telephone|mobile|email|address)\b/i;
const CJK_SENSITIVE_LABEL_PATTERN =
  /(姓名|客人姓名|护照|身份证|证件号|证件号码|出生日期|出生年月日|住址|地址|电话|手机|邮箱|电子邮箱)\s*[:：=]?/u;
// Without locale-specific NER, free-form CJK text is treated as potentially
// identifying and kept for manual handling rather than sent to the model.
const CJK_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,4}/u;
const NON_ASCII_LETTER_PATTERN = /(?=[^\x00-\x7F])\p{L}/u;
// Keep a small set of clearly operational Chinese notes usable. Every other
// non-English note remains local because a generic detector cannot reliably
// distinguish a name from ordinary prose.
const SAFE_CJK_OPERATIONAL_NOTE_PATTERN =
  /^(?:需要(?:无麸质|无麸|素食)早餐|晚到|深夜到达|携带宠物|宠物同行|周年庆祝|纪念日庆祝|需要加床|加床|安排婴儿床)[。！!，,、\s]*$/u;

export function normalizeObservation(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function redactObservation(value: string): string {
  return normalizeObservation(value)
    .replace(LABELED_NAME_PATTERN, "$1 [name redacted]")
    .replace(EMAIL_PATTERN, "[email redacted]")
    .replace(PHONE_PATTERN, "[phone redacted]")
    .replace(LONG_ID_PATTERN, "[identifier redacted]");
}

export type ModelSafeObservation =
  | { ok: true; value: string }
  | { ok: false; reason: "suspected-pii" };

export function prepareObservationForModel(value: string): ModelSafeObservation {
  const normalized = normalizeObservation(value);
  const redacted = redactObservation(normalized);
  const hasSafeCjkOperationalNote =
    CJK_TEXT_PATTERN.test(normalized) &&
    SAFE_CJK_OPERATIONAL_NOTE_PATTERN.test(normalized);
  // Conservative fail-closed behavior: text that still resembles an
  // unlabelled full name or a sensitive field we cannot safely isolate stays
  // entirely inside the hotel system and is handled by an employee.
  if (
    SENSITIVE_LABEL_PATTERN.test(normalized) ||
    CJK_SENSITIVE_LABEL_PATTERN.test(normalized) ||
    (NON_ASCII_LETTER_PATTERN.test(normalized) && !hasSafeCjkOperationalNote) ||
    UNLABELED_TITLECASE_NAME_PATTERN.test(redacted)
  ) {
    return { ok: false, reason: "suspected-pii" };
  }
  return { ok: true, value: redacted };
}

export function createBookingInsightSourceHash({
  observation,
  model,
  promptVersion,
}: {
  observation: string;
  model: string;
  promptVersion: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        observation: normalizeObservation(observation),
        model,
        promptVersion,
      })
    )
    .digest("hex");
}
