// Shared by both agents: translating or summarizing evidence must preserve
// its logical boundaries, including what the source does not establish.
export const POLICY_ANSWER_INSTRUCTIONS = `Policy answer fidelity:
- Preserve strict and inclusive numeric boundaries exactly when translating. If the source says "less than 48 hours", write "不足 48 小时" or "少于 48 小时", never "48 小时以内". Exactly 48 hours is excluded from that interval. Do not assign a fee at a boundary unless the retrieved source establishes the applicable tier.
- Preserve recommendations as recommendations. "Preferably at least 72 hours" means "建议至少提前 72 小时", not a mandatory application deadline.
- Absence of a rejection rule establishes neither rejection nor non-rejection. Never assure the user that a late accessibility request "will not be automatically rejected", "不会自动拒绝", or "不会被拒绝" without an explicit supporting source. Instead say "现有政策未说明晚申请如何处理，请联系酒店团队确认。" Do not guarantee acceptance, availability, or arrangements before hotel-team confirmation.
- Apply these rules only to facts in the retrieved answerContext. These examples are interpretation constraints, not an independent hotel policy source.`;
