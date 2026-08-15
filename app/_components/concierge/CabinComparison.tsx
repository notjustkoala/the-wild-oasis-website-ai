import type {
  CabinComparisonResult,
  CabinRecommendation,
} from "@/app/_ai/schemas/concierge";

type CabinComparisonProps = {
  comparison: CabinComparisonResult;
  onAdopt: (cabin: CabinRecommendation) => void;
};

export default function CabinComparison({
  comparison,
  onAdopt,
}: CabinComparisonProps) {
  if (comparison.cabins.length === 0) {
    return (
      <div className="rounded-md border border-amber-500/50 bg-amber-950/30 p-4 text-sm text-amber-100">
        None of those cabins is currently available for this stay.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-primary-700">
      <table className="min-w-full divide-y divide-primary-700 text-left text-sm">
        <caption className="sr-only">
          Cabin comparison for {comparison.numNights} nights
        </caption>
        <thead className="bg-primary-900 text-primary-300">
          <tr>
            <th className="px-3 py-2 font-medium">Cabin</th>
            <th className="px-3 py-2 font-medium">Capacity</th>
            <th className="px-3 py-2 font-medium">Nightly</th>
            <th className="px-3 py-2 font-medium">Total</th>
            <th className="px-3 py-2"><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-primary-800 bg-primary-950">
          {comparison.cabins.map((cabin) => (
            <tr key={cabin.cabinId}>
              <td className="whitespace-nowrap px-3 py-3 font-semibold text-accent-300">
                {cabin.name}
              </td>
              <td className="px-3 py-3">{cabin.maxCapacity}</td>
              <td className="px-3 py-3">${cabin.nightlyPrice}</td>
              <td className="px-3 py-3 font-semibold">${cabin.totalPrice}</td>
              <td className="px-3 py-3">
                <button
                  type="button"
                  onClick={() => onAdopt(cabin)}
                  className="whitespace-nowrap rounded bg-accent-500 px-3 py-1.5 font-semibold text-primary-950 hover:bg-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-300"
                >
                  Adopt
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {comparison.unavailableCabinIds.length ? (
        <p className="border-t border-primary-700 bg-primary-900 px-3 py-2 text-xs text-primary-400">
          Unavailable cabin IDs: {comparison.unavailableCabinIds.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
