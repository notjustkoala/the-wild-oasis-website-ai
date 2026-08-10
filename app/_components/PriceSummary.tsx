type PriceSummaryProps = {
  regularPrice: number;
  discount: number;
  quote: {
    nightlyPrice: number;
    numNights: number;
    cabinPrice: number;
  };
};

export default function PriceSummary({
  regularPrice,
  discount,
  quote,
}: PriceSummaryProps) {
  return (
    <div className="flex items-baseline gap-6">
      <p className="flex gap-2 items-baseline">
        <span className="text-2xl">${quote.nightlyPrice}</span>
        {discount > 0 ? (
          <span className="line-through font-semibold text-primary-700">
            ${regularPrice}
          </span>
        ) : null}
        <span>/night</span>
      </p>

      {quote.numNights > 0 ? (
        <>
          <p className="bg-accent-600 px-3 py-2 text-2xl">
            <span aria-hidden="true">&times;</span>{" "}
            <span>{quote.numNights}</span>
          </p>
          <p>
            <span className="text-lg font-bold uppercase">Total</span>{" "}
            <span className="text-2xl font-semibold">${quote.cabinPrice}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}
