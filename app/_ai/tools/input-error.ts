// Only application validation creates this error; provider error messages are
// never promoted to guest-visible business guidance.
export const CONCIERGE_INPUT_NOTICE_PREFIX = "Request needs updating: ";

export class ConciergeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConciergeInputError";
  }
}
