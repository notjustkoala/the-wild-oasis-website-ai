import { assessLiveResult, liveCases } from "../live/assertions";
import { safeErrorDiagnostic } from "../live/error-diagnostic";

it("keeps only controlled error classifications and HTTP codes from nested errors", () => {
  const error = { name: "AI_RetryError", message: "private prompt", lastError: { name: "AI_APICallError", statusCode: 429, responseBody: "private token", cause: { name: "private@example.invalid" } } };
  const result = safeErrorDiagnostic(error);
  expect(result).toMatchObject({ category: "provider-rate-limit", chain: [{ name: "AI_RetryError", statusCode: null }, { name: "AI_APICallError", statusCode: 429 }, { name: "UnknownError", statusCode: null }] });
  expect(JSON.stringify(result)).not.toContain("private");
});

it("rejects stale dates and budget even when the revision guest count is correct", () => {
  const row = liveCases[9];
  const result = assessLiveResult(row, { text: "Here are cabins.", calls: [{ toolName: "searchAvailableCabins", input: { startDate: "2027-07-10", endDate: "2027-07-12", numGuests: 6, maxTotalPrice: 400 } }], outputs: [], toolErrors: 0 });
  expect(result["all-search-arguments"]).toBe(false);
  expect(result["search-output-contract"]).toBe(false);
});
it("classifies nested network errors without retaining address or arbitrary codes", () => {
  const result = safeErrorDiagnostic({ name: "AI_APICallError", cause: { name: "Error", code: "ECONNRESET", address: "private address", cause: { code: "secret token" } } });
  expect(result.category).toBe("network-error");
  expect(result.chain[1].code).toBe("ECONNRESET");
  expect(JSON.stringify(result)).not.toMatch(/private|secret/);
});
it("does not pass a policy call with a fabricated confident answer", () => {
  const result = assessLiveResult(liveCases[7], { text: "Helipad use is allowed.", calls: [{ toolName: "searchHotelPolicies", input: {} }], outputs: [], toolErrors: 0 });
  expect(result["tool-choice"]).toBe(true);
  expect(result["states-evidence-gap"]).toBe(false);
});
it("requires actual tool errors and an explained failure for the error case", () => {
  const row = liveCases[8];
  expect(assessLiveResult(row, { text: "Done.", calls: [{ toolName: row.tool!, input: row.stay }], outputs: [], toolErrors: 0 })["tool-error-observed"]).toBe(false);
});
