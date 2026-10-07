import type { StaySearchInput } from "@/app/_ai/schemas/concierge";

type DateFragment = { year?: number; month: number; day: number };
export type ConciergeDemandMemory = {
  dates: { start?: DateFragment; end?: DateFragment };
  numGuests?: number;
  maxTotalPrice?: number;
  preferences: string[];
  missing: string[];
  conflicts: string[];
  search?: StaySearchInput;
};

const NUMBER = "(?:\\d+|[一二两三四五六七八九十]+|one|two|three|four|five|six|seven|eight|nine|ten)";
const DATE_PATTERN = /(?<!\d)(?:(\d{4}|\d{2})\s*(?:年|[-/.])\s*)?(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})(?:日|号)?(?!\d)/gu;
const SEARCH_INTENT = /推荐|查(?:询|找|房)|搜索|可用|重新(?:查|选)|换(?:一|几)?(?:间|个)|\b(?:recommend|search|find|available|availability)\b/iu;
const POLICY_TOPIC = /取消|退款|收费|费用|几点|政策|规定|早餐|过敏|无障碍|宠物|狗|猫|付款|支付|例外|\b(?:policy|policies|refund|cancel|fee|breakfast|allerg|pets?|payment|what time)\b/iu;

function number(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const english: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (english[value.toLowerCase()]) return english[value.toLowerCase()];
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[value];
}

function normalizedYear(value: string): number {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

function dateOnly(date: DateFragment | undefined): string | undefined {
  if (!date?.year) return undefined;
  const parsed = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (parsed.getUTCFullYear() !== date.year || parsed.getUTCMonth() + 1 !== date.month || parsed.getUTCDate() !== date.day) return undefined;
  return parsed.toISOString().slice(0, 10);
}

/** Dates in a reservation request must not be mistaken for a check-in policy question. */
export function isConciergeStayPlanning(question: string): boolean {
  const hasDate = [...question.matchAll(DATE_PATTERN)].length > 0;
  return hasDate && (SEARCH_INTENT.test(question) || !POLICY_TOPIC.test(question));
}

/** Rebuild request facts from validated USER text only. This is not an inventory or profile. */
export function collectConciergeDemand(texts: string[], referenceDate: string): ConciergeDemandMemory {
  const memory: ConciergeDemandMemory = { dates: {}, preferences: [], missing: [], conflicts: [] };
  let year: number | undefined;
  let statedNights: number | undefined;
  let conflicts: string[] = [];
  for (const text of texts) {
    // A standalone policy topic cannot overwrite the reservation request.
    if (POLICY_TOPIC.test(text) && !isConciergeStayPlanning(text)) continue;
    if (/重新开始|新(?:的)?(?:行程|旅行|预订需求)|忘掉(?:之前|前面)|\b(?:new trip|start over|forget previous)\b/iu.test(text)) {
      memory.dates = {}; memory.numGuests = undefined; memory.maxTotalPrice = undefined;
      memory.preferences = []; year = undefined; statedNights = undefined; conflicts = [];
    }
    const matches = [...text.matchAll(DATE_PATTERN)];
    const years = [...text.matchAll(/(?<!\d)(\d{4}|\d{2})\s*年/gu)].map(match => normalizedYear(match[1]));
    const bareYear = /^(?:是|就是)?\s*(20\d{2}|\d{2})(?=$|[，,。\s])/u.exec(text.trim());
    if (bareYear && (bareYear[1].length === 4 || Boolean(memory.dates.start && !memory.dates.start.year))) years.push(normalizedYear(bareYear[1]));
    if (/今年/u.test(text)) years.push(Number(referenceDate.slice(0, 4)));
    if (/明年/u.test(text)) years.push(Number(referenceDate.slice(0, 4)) + 1);
    if (matches[0]?.[1]) years.unshift(normalizedYear(matches[0][1]));
    if (years.length) {
      year = years[0];
      if (matches.length === 0 && new Set(years).size > 1) {
        year = undefined;
        if (memory.dates.start) memory.dates.start.year = undefined;
        if (memory.dates.end) memory.dates.end.year = undefined;
      }
      if (matches.length === 0) {
        if (memory.dates.start) memory.dates.start.year = year;
        if (memory.dates.end) memory.dates.end.year = year;
      }
    }
    const fragments = matches.map(match => ({
      year: match[1] ? normalizedYear(match[1]) : year,
      month: Number(match[2]), day: Number(match[3]),
    }));
    // Chinese day-only checkout: 2026年11月10日至13日.
    if (fragments.length === 1) {
      const tail = text.slice((matches[0].index ?? 0) + matches[0][0].length);
      const endDay = /^\s*(?:到|至|[-–])\s*(\d{1,2})\s*日/u.exec(tail);
      if (endDay) fragments.push({ ...fragments[0], day: Number(endDay[1]) });
    }
    if (fragments.length >= 2) {
      conflicts = [];
      statedNights = undefined;
      if (fragments.length > 2) {
        memory.dates = {};
        conflicts.push("multiple date ranges: ask which stay is intended");
      } else {
        memory.dates = { start: fragments[0], end: fragments[1] };
      }
    } else if (fragments.length === 1) {
      conflicts = []; statedNights = undefined;
      if (/退房|离店|check[ -]?out/iu.test(text) && !/入住|check[ -]?in/iu.test(text)) memory.dates.end = fragments[0];
      else if (/入住|到店|check[ -]?in/iu.test(text) && !/退房|check[ -]?out/iu.test(text)) memory.dates.start = fragments[0];
      else { memory.dates = { start: fragments[0] }; }
    }
    const guestMatches = [...text.matchAll(new RegExp(`(${NUMBER})\\s*(?:位(?:客人|住客|成人)?|(?:个)?人(?:入住)?|口|guests?|people|adults?)`, "giu"))];
    const guestValues = [...new Set(guestMatches.map(match => number(match[1])).filter((value): value is number => value !== undefined))];
    const components = [...text.matchAll(new RegExp(`(${NUMBER})\\s*(?:位|个)?\\s*(?:成人|儿童|孩子|大人|adults?|children|kids?)`, "giu"))];
    if (components.length >= 2 && !/或者|还是|或|\bor\b/iu.test(text)) memory.numGuests = components.reduce((sum, match) => sum + (number(match[1]) ?? 0), 0);
    else if (guestValues.length === 1) memory.numGuests = guestValues[0];
    else if (guestValues.length > 1) memory.numGuests = undefined;
    else if (/改(?:为|成).*?(?:位|人|guests?|people)|人数/iu.test(text)) memory.numGuests = undefined;
    else if (memory.dates.start?.year && memory.numGuests === undefined && new RegExp(`^${NUMBER}[。.!！\\s]*$`, "iu").test(text.trim())) memory.numGuests = number(text.trim().replace(/[。.!！\s]/gu, ""));
    if (/人数(?:不确定|待定)|\b(?:guest count|party size) (?:unknown|undecided)\b/iu.test(text)) memory.numGuests = undefined;

    const budget = /(?:预算|budget|总价(?:不超过|上限)|不超过|under)\s*(?:为|是|改为|提高到|降低到|[:：]|USD|\$)?\s*([\d,]+(?:\.\d+)?)/iu.exec(text)
      ?? /\$\s*([\d,]+(?:\.\d+)?)/u.exec(text);
    if (budget) {
      const amount = Number(budget[1].replaceAll(",", ""));
      memory.maxTotalPrice = amount > 0 && !/每晚|每夜|per night|nightly/iu.test(text) ? amount : undefined;
    }
    if (/不限预算|预算不限|没有预算限制|\bno budget (?:limit|cap)\b/iu.test(text)) memory.maxTotalPrice = undefined;
    const nights = new RegExp(`(${NUMBER})\\s*(?:晚|nights?)`, "iu").exec(text);
    if (nights) statedNights = number(nights[1]);
    if (/(?:偏好|喜好)(?:改为|改成|换成)|\b(?:change|replace) (?:my )?preferences?\b/iu.test(text)) memory.preferences = [];
    for (const clause of text.split(/[，,。；;\n]/u)) {
      if (/(?:希望|偏好|喜欢|prefer|quiet|secluded)/iu.test(clause) && !/推荐|查找|预算|\d\s*(?:年|月|晚)|(?:不再|不要|不喜欢|取消).*?(?:安静|quiet)/iu.test(clause)) {
        const preference = clause.trim().slice(0, 80);
        if (preference && !memory.preferences.includes(preference)) memory.preferences.push(preference);
      }
    }
    if (/不再.*安静|不要安静|取消.*安静|\b(?:no longer|not).*quiet/iu.test(text)) memory.preferences = memory.preferences.filter(p => !/安静|quiet/iu.test(p));
    memory.preferences = memory.preferences.slice(-8);
  }
  const startDate = dateOnly(memory.dates.start), endDate = dateOnly(memory.dates.end);
  if (!memory.dates.start) memory.missing.push("check-in date");
  if (!memory.dates.end) memory.missing.push("checkout date");
  if ((memory.dates.start && !memory.dates.start.year) || (memory.dates.end && !memory.dates.end.year)) memory.missing.push("year");
  if (memory.numGuests === undefined) memory.missing.push("guest count");
  if ((memory.dates.start?.year && !startDate) || (memory.dates.end?.year && !endDate)) conflicts.push("invalid calendar date");
  if (startDate && endDate) {
    const nights = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
    if (nights <= 0) conflicts.push("checkout must be after check-in; do not assume a new year");
    if (statedNights !== undefined && nights !== statedNights) conflicts.push("dates disagree with the stated number of nights");
  }
  if (memory.numGuests !== undefined && memory.numGuests < 1) conflicts.push("guest count must be positive");
  memory.conflicts = conflicts;
  if (startDate && endDate && memory.numGuests && !memory.missing.length && !conflicts.length) {
    memory.search = { startDate, endDate, numGuests: memory.numGuests, ...(memory.maxTotalPrice ? { maxTotalPrice: memory.maxTotalPrice } : {}), preferences: memory.preferences };
  }
  return memory;
}

/** A short clarification continues the pending stay; unrelated questions do not trigger inventory. */
export function shouldSearchConciergeDemand(texts: string[], memory: ConciergeDemandMemory): boolean {
  if (!memory.search) return false;
  const current = texts.at(-1) ?? "";
  if (/不要|不用|别(?:查|推荐)|\b(?:do not|don't|no need to)\b/iu.test(current)) return false;
  if (SEARCH_INTENT.test(current)) return true;
  const previous = texts.at(-2) ?? "";
  if (POLICY_TOPIC.test(previous) && !isConciergeStayPlanning(previous)) return false;
  const previousSearch = texts.slice(0, -1).some(text => SEARCH_INTENT.test(text));
  return previousSearch && (
    /^(?:确认|确定|是的?|对的?|好的?|没错|就这样|yes|confirmed?|correct|ok)[，,\s。.!！]*$/iu.test(current.trim()) ||
    /^(?:\d{2,4}\s*年|今年|明年)/u.test(current.trim()) ||
    /^\d{1,4}[。.!！\s]*$/u.test(current.trim()) ||
    isConciergeStayPlanning(current) ||
    /^(?:改为|改成|人数|预算|希望|偏好|喜欢|(?:two|three|four|\d+) guests)/iu.test(current.trim())
  );
}

/** A known missing year is a form clarification, never a model guess from today's date. */
export function conciergeYearClarification(memory: ConciergeDemandMemory | undefined, userText: string): string | undefined {
  if (!memory?.missing.includes("year") || memory.conflicts.length) return undefined;
  if (!SEARCH_INTENT.test(userText) && !isConciergeStayPlanning(userText) && !/确认|确定|\d{2,4}\s*年|^(?:yes|confirmed?|correct|ok)[.!\s]*$/iu.test(userText.trim())) return undefined;
  return /\p{Script=Han}/u.test(userText)
    ? "请补充入住年份（例如2026年）。您已提供的日期、人数、预算和偏好会保留，无需再次确认。"
    : "Which year is your stay? I will keep the dates, guest count, budget and preferences you already provided.";
}
