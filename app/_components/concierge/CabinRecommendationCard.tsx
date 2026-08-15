import Image from "next/image";

import type { CabinRecommendation } from "@/app/_ai/schemas/concierge";

type CabinRecommendationCardProps = {
  cabin: CabinRecommendation;
  onAdopt: (cabin: CabinRecommendation) => void;
  compact?: boolean;
  allowAdopt?: boolean;
};

export default function CabinRecommendationCard({
  cabin,
  onAdopt,
  compact = false,
  allowAdopt = true,
}: CabinRecommendationCardProps) {
  return (
    <article className="overflow-hidden rounded-lg border border-primary-700 bg-primary-900 shadow-lg">
      {cabin.image ? (
        <div className={`relative w-full ${compact ? "h-28" : "h-40"}`}>
          <Image
            src={cabin.image}
            alt={`${cabin.name} cabin`}
            fill
            sizes="(max-width: 768px) 92vw, 400px"
            className="object-cover"
          />
        </div>
      ) : null}
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-accent-300">{cabin.name}</h3>
            <p className="text-xs text-primary-400">
              {cabin.numNights > 0
                ? `${cabin.numNights} nights · ${cabin.numGuests} guests · sleeps ${cabin.maxCapacity}`
                : `Sleeps ${cabin.maxCapacity} · add dates for a live total`}
            </p>
          </div>
          <div className="text-right">
            {cabin.numNights > 0 ? (
              <p className="text-xl font-semibold text-primary-50">
                ${cabin.totalPrice}
              </p>
            ) : null}
            <p className="text-xs text-primary-400">${cabin.nightlyPrice}/night</p>
          </div>
        </div>

        {cabin.withinBudget === false ? (
          <p className="text-sm text-amber-200">Above the stated budget</p>
        ) : null}

        <ul className="space-y-1 text-sm text-primary-200">
          {cabin.facts.slice(0, compact ? 2 : 3).map((fact) => (
            <li key={fact}>• {fact}</li>
          ))}
        </ul>

        <p className="break-all text-[11px] text-primary-500">
          Sources: {cabin.sourceIds.join(" · ")}
        </p>

        {allowAdopt && cabin.numNights > 0 && cabin.startDate && cabin.endDate ? (
          <button
            type="button"
            onClick={() => onAdopt(cabin)}
            className="w-full rounded-md bg-accent-500 px-4 py-2 font-semibold text-primary-950 transition hover:bg-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-300 focus:ring-offset-2 focus:ring-offset-primary-900"
            aria-label={`Adopt plan for ${cabin.name}`}
          >
            Adopt plan
          </button>
        ) : null}
      </div>
    </article>
  );
}
