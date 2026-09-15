// Match a complete, explicit response constraint. Keep it in the model prompt,
// but exclude it from retrieval so it cannot dilute the policy topic.
export const POLICY_EXPLANATION_SUFFIX = /(?:^|[。？！?!.；;]\s*)只解释流程(?:[，,]\s*不创建任何记录)?[。.!！]?\s*$/u;

export function isPolicyExplanationOnlyRequest(value: string) {
  return POLICY_EXPLANATION_SUFFIX.test(value);
}

export function removePolicyExplanationConstraint(value: string) {
  return value.replace(POLICY_EXPLANATION_SUFFIX, (match) =>
    match.slice(0, match.indexOf("只解释流程")).trimEnd()
  ).trim();
}
