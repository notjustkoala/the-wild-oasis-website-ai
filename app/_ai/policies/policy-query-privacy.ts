import policyConfig from "@/policy-rag.config.json";
import { removePolicyExplanationConstraint } from "@/app/_ai/policies/policy-query-controls";

const POLICY_INTENT = /(?:\b(?:accessib(?:ility|le)|allerg(?:y|ies|ic)|arrival|breakfast|cancel(?:lation|led)?|cat|charg(?:e|ed|es)|check[ -]?(?:in|out)|departure|dietary|dog|exceptions?|fees?|late checkout|no[ -]?show|payments?|pets?|polic(?:y|ies)|refunds?|rules?|service animal|sop|waivers?)\b|入住|退房|取消|退款|早餐|饮食|过敏|无障碍|服务性动物|宠物|动物|猫|狗|付款|支付|扣款|政策|规定|例外|豁免|减免|未到店|操作流程)/iu;

// This deliberately conservative vocabulary keeps policy meaning while discarding
// unknown Latin tokens before a query leaves the server. It is not general NER.
const SAFE_ENGLISH_WORDS = new Set(`
  a about accessibility accessible accommodation advance after allergies allergy allowed
  am an and animal any apply approval are arrival at automatic automatically before
  breakfast bring by can cancel cancellation cancelled card cat charge charged check checkout
  cleaning collect confirmation contact could current day days declare departure dietary do does
  dog during early exception exceptions extra extras fee fees for from full get guest guests have
  hotel how i if in is it late may method my need needs night nights no no-show not of on one only
  or original paid party payment payments pet pets policy policies price request requests
  reservation refund refunds religious return rule rules safety service severe should stay
  back booking old version says weigh seven submit reviews
  submitting support the them there this time to total two up upon waiver waivers weighing what
  when where whether who why will with without would yes kg usd sop
`.trim().split(/\s+/));

// Chinese has no word boundaries. Keep only known policy phrases and question
// grammar, and fail closed if an unrecognized span remains after explicit PII
// redaction. This prevents a missed name from being sent as ordinary query text.
const SAFE_CHINESE_TERMS = `
  入住 退房 取消 退款 早餐 饮食 过敏 无障碍 服务性动物 宠物 动物 猫 狗
  付款 支付 扣款 费用 收费 收取 政策 规定 规则 例外 异常 豁免 减免
  未到店 操作流程 流程 严重 升级 处理 审批 申请 延迟 提前 临时 清洁 免除 应
  宗教 安排 保证 支持 联系 确认 酒店 客人 住客 客户 客房 提交 预订 预约
  原路 原支付方式 自动 全额 价格 金额 免费 额外 重量 限制 数量 允许 所有 订单 对
  请问 关于 我们 我 你们 你 他们 他 她 的 是 什么 哪些 哪个 如何 怎么
  可以 能否 能不能 想要 想问 想 知道 需要 要求 应该 是否 能 会
  带 问 咨询 有 没有 不 也 都 和 或 与 在 前 后 内 每天 多少 钱
  费 收 到 时 时间 几点 吗 呢 了 就 只 最多 最少 超过 以内 以上 以下
  公斤 千克 小时 分钟 美元 天 晚 人 点
`.trim().split(/\s+/).sort((left, right) => right.length - left.length);
const SAFE_CHINESE_SPAN = new RegExp(
  `[零一二两三四五六七八九十百]+(?:公斤|千克|小时|分钟|美元|只|天|晚|人|点)|${SAFE_CHINESE_TERMS.join("|")}`,
  "gu",
);

const REDACTION_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /\b(?:api[ _-]?key|access[ _-]?token|auth(?:orization)?|bearer|credential|password|secret)\s*[:=]?\s*[^\s,;]+/giu,
  /\b(?:booking|confirmation|order|reservation)\s*(?:(?:id|number|no\.?|reference|ref\.?)\s*[:=#]?\s*[A-Z0-9-]{3,}|#\s*[A-Z0-9-]{3,}|(?=[A-Z0-9-]*\d)[A-Z0-9-]{3,})\b/giu,
  /(?:订单|预订|预约)(?:(?:编号|号码|号|ID)\s*[:：#]?\s*[A-Z0-9-]{3,}|\s*[:：#]\s*[A-Z0-9-]{3,}|\s+(?=[A-Z0-9-]*\d)[A-Z0-9-]{3,})/giu,
  /\b(?:observations?|notes?)\s*[:=]\s*[^\n;]*/giu,
  /(?:备注|观察记录)\s*[:：]\s*[^\n；;]*/gu,
  /\b(?:guest\s+name|name)\s*[:=]\s*[^\n,;]*/giu,
  /(?:客人姓名|姓名)\s*[:：]\s*[^\n，,；;]*/gu,
  /\b(?:phone|tel(?:ephone)?|mobile)\s*[:=]?\s*\+?[\d(). -]{7,}\d/giu,
  /(?:电话|手机号|手机)\s*[:：]?\s*\+?[\d（）(). -]{7,}\d/gu,
  /(?<!\d)\+?\d(?:[\d(). -]{8,}\d)(?!\d)/gu,
  /\b\d{7,}\b/gu,
];

// Shared with the staff request boundary so recognized policy-name contexts are
// removed before the generation model as well as before the embedding provider.
export function redactChinesePolicyIdentities(value: string) {
  const placeholder = "[redacted]";
  return value.replace(
    /(?:我是|我叫|客人叫|客人是)\s*[\p{Script=Han}]{2,4}(?=[，,。\s]|$)/gu,
    placeholder,
  ).replace(
    /((?:请问|关于|客人)\s*)([\p{Script=Han}]{2,4})(?=的)/gu,
    (match, prefix: string, candidate: string) =>
      hasPolicyIntent(candidate) ? match : `${prefix}${placeholder}`,
  ).replace(
    /((?:客人|住客|客户)\s*)([\p{Script=Han}]{2,4})(?=(?:想|需要|可以|能否|预订|预约|要求))/gu,
    (match, prefix: string, candidate: string) =>
      hasPolicyIntent(candidate) ? match : `${prefix}${placeholder}`,
  ).replace(
    /(^|[\s,，;；。])([\p{Script=Han}]{2,4})(?=的|(?:预订|预约)的)/gu,
    (match, prefix: string, candidate: string) =>
      hasPolicyIntent(candidate) ? match : `${prefix}${placeholder}`,
  );

}

function stripLikelyIdentities(value: string) {
  const placeholder = "\uE000";
  let result = redactChinesePolicyIdentities(value).replace(/\[redacted\]/giu, placeholder);

  result = result.replace(/\p{Script=Latin}[\p{Script=Latin}'’-]*/gu, (word) =>
    SAFE_ENGLISH_WORDS.has(word.toLocaleLowerCase()) ||
      word.toLocaleLowerCase().split("-").every((part) => SAFE_ENGLISH_WORDS.has(part))
      ? word : placeholder,
  );

  result = result.replace(
    /(^|[\s,，;；。])([\p{Script=Han}]{2,4})(?=(?:可以|能否|能不能|想要|想问|想|需要)(?:带|问|咨询)?)/gu,
    (match, prefix: string, candidate: string) =>
      hasPolicyIntent(candidate) ? match : `${prefix}${placeholder}`,
  );

  let hasUnknownChineseContent = false;
  result = result.replace(/\p{Script=Han}+/gu, (span) => {
    let end = 0;
    const safeParts: string[] = [];
    for (const match of span.matchAll(SAFE_CHINESE_SPAN)) {
      if (match.index !== end) {
        hasUnknownChineseContent = true;
        safeParts.push(placeholder);
      }
      safeParts.push(match[0]);
      end = match.index + match[0].length;
    }
    if (end !== span.length) {
      hasUnknownChineseContent = true;
      safeParts.push(placeholder);
    }
    return safeParts.join("");
  });
  return { value: result.replaceAll(placeholder, "[redacted]"), hasUnknownChineseContent };
}

function compact(value: string) {
  return value
    .replace(/\[redacted\](?:\s*\[redacted\])+/giu, "[redacted]")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;!?，。；！？])/g, "$1")
    .trim()
    .slice(0, policyConfig.retrieval.maximumQuestionCharacters);
}

function normalizeAuthorizedStaffPolicyRequest(value: string) {
  const overridePrefix =
    /^\s*(?:ignore\s+(?:all\s+)?(?:previous\s+)?(?:rules?|instructions?)|忽略(?:所有|全部)?(?:规则|指令))\s*[,，;；:]?\s*(?:(?:and\s+)?then\s+|and\s+|然后|并且|再)?/iu;
  const hasOverridePrefix = overridePrefix.test(value);
  const normalized = hasOverridePrefix
    ? value
        .replace(overridePrefix, "")
        .replace(
          /^\s*(?:show|display|reveal|provide|print|展示|显示|提供|查看|读取)\s*(?:the\s+)?/iu,
          "",
        )
        .replace(/\s*(?:全文|完整内容)\s*$/u, "")
        .replace(/\s*\b(?:(?:in\s+)?full|entire|complete)(?:\s+(?:text|document|content))?\s*$/iu, "")
    : value;

  return normalized
    .replace(
      /\b(?:internal|staff|employee)(?=\s+(?:internal|staff|employee|exception|policy|procedure|process|sop))/giu,
      "",
    )
    .replace(/(?:员工|内部)(?=(?:异常|例外|政策|规定|操作流程|流程|SOP))/giu, "")
    .trim();
}

function redactPolicyQuery(value: string) {
  let result = value.replace(/\r\n?/g, "\n");
  for (const pattern of REDACTION_PATTERNS) result = result.replace(pattern, "[redacted]");
  const identities = stripLikelyIdentities(result);
  return { sanitized: compact(identities.value), hasUnknownChineseContent: identities.hasUnknownChineseContent };
}

export function sanitizePolicyQuery(value: string) {
  return redactPolicyQuery(value).sanitized;
}

export function hasPolicyIntent(value: string) {
  return POLICY_INTENT.test(value.replace(/\[redacted\]/giu, " "));
}

export function preparePolicyQuery(
  value: string,
  { allowStaffScope = false }: { allowStaffScope?: boolean } = {},
) {
  const policyQuestion = removePolicyExplanationConstraint(value);
  const scopedValue = allowStaffScope
    ? normalizeAuthorizedStaffPolicyRequest(policyQuestion)
    : policyQuestion;
  const { sanitized, hasUnknownChineseContent } = redactPolicyQuery(scopedValue);
  // Unknown subjects must not become a generic "policy" query after redaction.
  const specificIntent = hasPolicyIntent(sanitized.replace(/\b(?:polic(?:y|ies)|rules?|sop)\b|政策|规定|操作流程/giu, " "));
  return {
    sanitized,
    searchable: !hasUnknownChineseContent && sanitized.length > 0 && hasPolicyIntent(sanitized) &&
      (!sanitized.includes("[redacted]") || specificIntent),
  };
}
