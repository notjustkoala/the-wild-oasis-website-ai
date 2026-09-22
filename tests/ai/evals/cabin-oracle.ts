import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
export const expectedStaySchema = z.object({
  startDate: date, endDate: date, numNights: z.number().int().positive(),
  numGuests: z.number().int().positive(), maxTotalPrice: z.number().positive().nullable(),
}).strict().refine(stay => (Date.parse(stay.endDate) - Date.parse(stay.startDate)) / 86_400_000 === stay.numNights, "Expected nights must match the fixed dates");
export type ExpectedStay = z.infer<typeof expectedStaySchema>;

// Independent oracle: deliberately not imported from the injected data source or
// production pricing functions. Changing the fixture inventory requires review
// of these expected business facts, not deriving them from an actual result.
const fixedCabins = [
  { id: 1, capacity: 8, regularPrice: 300, discount: 50, nightlyPrice: 250 },
  { id: 2, capacity: 4, regularPrice: 180, discount: 20, nightlyPrice: 160 },
] as const;
const maximumGuests = 10;
const conflictingIds = new Set([1]);
const callSchema = z.object({ startDate: date, endDate: date, numGuests: z.number().int().positive(), maxTotalPrice: z.number().positive().optional() });
const recommendationSchema = z.object({
  cabinId: z.number().int().positive(), startDate: date, endDate: date,
  numNights: z.number().int().positive(), numGuests: z.number().int().positive(),
  maxCapacity: z.number().int().positive(), regularPrice: z.number().nonnegative(),
  discount: z.number().nonnegative(), nightlyPrice: z.number().nonnegative(),
  totalPrice: z.number().nonnegative(), withinBudget: z.boolean().nullable(),
});
const searchSchema = z.object({
  kind: z.literal("cabin-search"), startDate: date, endDate: date,
  numNights: z.number().int().positive(), numGuests: z.number().int().positive(),
  maxTotalPrice: z.number().positive().nullable(), currency: z.literal("USD"),
  recommendations: z.array(recommendationSchema),
});
type ObservedCall = { toolName: string; toolCallId: string; input: unknown };
type ObservedResult = { toolName: string; toolCallId: string; output: unknown };
export function assessCabinConstraints(stay: ExpectedStay | undefined, inventory: string | undefined, calls: ObservedCall[], results: ObservedResult[]) {
  const failed = { "trusted-quote": false, "capacity-budget": false, "available-only": false };
  if (!stay) return failed;
  const searches = calls.filter(call => call.toolName === "searchAvailableCabins");
  const outputs = results.filter(result => result.toolName === "searchAvailableCabins");
  if (!searches.length || searches.length !== outputs.length) return failed;
  // Every invocation must have exactly one result of that same named tool.
  if (new Set(searches.map(call => call.toolCallId)).size !== searches.length || searches.some(call => outputs.filter(output => output.toolCallId === call.toolCallId).length !== 1)) return failed;
  const parsedCalls = searches.map(call => callSchema.safeParse(call.input));
  const parsedOutputs = outputs.map(output => searchSchema.safeParse(output.output));
  if (parsedCalls.some(call => !call.success) || parsedOutputs.some(output => !output.success)) return failed;
  const inputs = parsedCalls.map(call => call.data!);
  const data = parsedOutputs.map(output => output.data!);
  const expectedCabins = inventory === "empty" ? [] : fixedCabins.filter(cabin => cabin.capacity >= stay.numGuests && stay.numGuests <= maximumGuests && (inventory !== "conflict" || !conflictingIds.has(cabin.id)));
  // Empty is valid only when inventory is empty or no fixed cabin fits. Budget
  // does not remove alternatives: production labels those with withinBudget=false.
  const countMatches = data.every(output => output.recommendations.length === expectedCabins.length);
  const datesMatch = inputs.every(input => input.startDate === stay.startDate && input.endDate === stay.endDate)
    && data.every(output => output.startDate === stay.startDate && output.endDate === stay.endDate && output.numNights === stay.numNights && output.recommendations.every(cabin => cabin.startDate === stay.startDate && cabin.endDate === stay.endDate && cabin.numNights === stay.numNights));
  const partyBudgetMatch = inputs.every(input => input.numGuests === stay.numGuests && (input.maxTotalPrice ?? null) === stay.maxTotalPrice)
    && data.every(output => output.numGuests === stay.numGuests && output.maxTotalPrice === stay.maxTotalPrice && output.recommendations.every(cabin => cabin.numGuests === stay.numGuests));
  return {
    "trusted-quote": countMatches && datesMatch && data.every(output => output.recommendations.every(cabin => {
      const fixed = fixedCabins.find(row => row.id === cabin.cabinId);
      return fixed !== undefined && cabin.startDate === stay.startDate && cabin.endDate === stay.endDate && cabin.numNights === stay.numNights
        && cabin.regularPrice === fixed.regularPrice && cabin.discount === fixed.discount && cabin.nightlyPrice === fixed.nightlyPrice && cabin.totalPrice === fixed.nightlyPrice * stay.numNights;
    })),
    "capacity-budget": countMatches && partyBudgetMatch && data.every(output => output.recommendations.every(cabin => {
      const fixed = fixedCabins.find(row => row.id === cabin.cabinId);
      return fixed !== undefined && cabin.numGuests === stay.numGuests && cabin.maxCapacity === Math.min(fixed.capacity, maximumGuests) && cabin.maxCapacity >= stay.numGuests
        && cabin.withinBudget === (stay.maxTotalPrice === null ? null : fixed.nightlyPrice * stay.numNights <= stay.maxTotalPrice);
    })),
    "available-only": countMatches && datesMatch && partyBudgetMatch && data.every(output => {
      const ids = output.recommendations.map(cabin => cabin.cabinId).sort((a, b) => a - b);
      return JSON.stringify(ids) === JSON.stringify(expectedCabins.map(cabin => cabin.id).sort((a, b) => a - b));
    }),
  };
}
