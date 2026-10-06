const POLICY_LABELS = [
  ["Exception handling SOP", "员工异常处理流程"],
  ["Cancellation and refund policy", "取消与退款政策"],
  ["Breakfast and dietary requests", "早餐与饮食需求"],
  ["Accessibility requests", "无障碍服务申请"],
  ["Check-in and check-out", "入住与退房"],
  ["Payment policy", "支付政策"],
  ["Pet policy", "宠物政策"],
  ["High priority", "高优先级"],
] as const;
const bilingualLabel = new RegExp(
  `([\\p{Script=Han}》”])\\s*[（(]\\s*(?:${POLICY_LABELS.map(([label]) => label).join("|")})\\s*[）)]`,
  "giu",
);
const localizedLabels = POLICY_LABELS.map(([label, localized]) => ({
  pattern: new RegExp(`\\b${label}\\b`, "gi"), localized,
}));

export function cleanAiAnswer(text: string) {
  let result = text;
  for (let pass = 0; pass < 2; pass++) {
    result = result.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|nbsp|quot|apos|lt|gt);/gi, (entity, number: string | undefined) => {
      if (number) {
        const point = number[0].toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number);
        return Number.isInteger(point) && point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
      }
      return ({ "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
    });
  }
  result = result.split("\n").filter(line => !/^\s*\[\^[^\]]+\]:/.test(line)).join("\n").replace(/\[\^[\w-]+\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (/\p{Script=Han}/u.test(result)) {
    result = result.replace(bilingualLabel, "$1");
    for (const { pattern, localized } of localizedLabels) result = result.replace(pattern, localized);
  }
  return result;
}
