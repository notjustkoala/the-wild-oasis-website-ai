// A waiver question needs both the underlying rule and the staff approval
// process. This fixed second query carries no user text or policy assertions.
export const STAFF_WAIVER_QUERY = "policy waiver fee reduction administrator approval SOP";

export function needsStaffWaiverEvidence(sanitizedQuestion: string) {
  return /(?:\b(?:waiv(?:e[ds]?|ers?|ing)|fee reductions?)\b|免除|减免|豁免)/iu.test(sanitizedQuestion)
    && /(?:\b(?:fees?|charges?|cancellation|refunds?|polic(?:y|ies)|sop)\b|费|取消|退款|政策)/iu.test(sanitizedQuestion);
}
