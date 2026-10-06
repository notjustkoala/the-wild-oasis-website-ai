// Fixed English retrieval facets improve cross-language recall without sending
// identities or inventing policy rules. Every fact still comes from an RLS-scoped
// vector/keyword query; document IDs only restrict the relevant evidence topic.
export function policyEvidencePlan(question: string, allowStaffScope: boolean) {
  const plans: Array<{ query: string; documentIds: string[] }> = [];
  const add = (query: string, documentIds: string[]) => plans.push({ query, documentIds });
  const cancellation = /cancel|refund|取消|退款/iu.test(question);
  if (/\b(?:pets?|dogs?|cats?|service animals?)\b|宠物|猫|狗|服务性动物/iu.test(question)) add("pet policy eligible pets weight count limits cleaning fee service animals", ["pet-policy"]);
  if (/accessib|service animals?|无障碍|服务性动物/iu.test(question)) add("accessibility support request advance notice confirmation service animals", ["accessibility"]);
  if (cancellation) add("cancellation charges refund review processing policy", ["cancellation-refund"]);
  if (/payment|paid|card|charged|付款|支付|扣款/iu.test(question) && (!cancellation || /payment|paid|付款|支付|扣款/iu.test(question))) add("payment policy when payment is due booking submission refunds original payment method", ["payment-policy"]);
  if (/breakfast|早餐/iu.test(question)) add("optional breakfast daily price per guest per day breakfast charge", ["breakfast-dietary"]);
  if (/dietary|allerg|饮食|过敏/iu.test(question)) add("breakfast dietary requests severe food allergy confirmation kitchen safety", ["breakfast-dietary"]);
  if (/check[ -]?(?:in|out)|late checkout|early arrival|入住时间|退房时间|延迟退房|几点.*入住/iu.test(question)) add("check in check out standard times early arrival late departure confirmation", ["check-in-check-out"]);
  if (allowStaffScope && /\bsop\b|exception|waiv|escalat|例外|异常|升级|流程|审批|豁免|减免|免除/iu.test(question)) add("hotel exception handling SOP administrator approval high priority severe food allergy fee waiver", ["exception-handling-sop"]);
  return plans;
}
