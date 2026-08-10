import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PriceSummary from "../app/_components/PriceSummary";
import { getStayQuote } from "../app/_lib/booking-domain";

describe("PriceSummary", () => {
  it("renders the shared discounted quote", () => {
    const quote = getStayQuote({
      startDate: "2026-08-10",
      endDate: "2026-08-13",
      regularPrice: 500,
      discount: 50,
    });

    render(
      <PriceSummary regularPrice={500} discount={50} quote={quote} />
    );

    expect(screen.getByText("$450")).toBeInTheDocument();
    expect(screen.getByText("$500")).toHaveClass("line-through");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("$1350")).toBeInTheDocument();
  });
});
