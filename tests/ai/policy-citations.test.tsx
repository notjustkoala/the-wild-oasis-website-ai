import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PolicySearchResult } from "@/app/_ai/policies/policy-types";
import PolicyCitations from "@/app/_components/concierge/PolicyCitations";

function grounded(scope: "public" | "staff" = "public"): PolicySearchResult {
  return {
    kind: "policy-search",
    status: "grounded",
    answerContext: "Trusted context",
    truncated: false,
    citations: [{
      documentId: scope === "public" ? "pet-policy" : "exception-handling-sop",
      title: scope === "public" ? "Pet policy" : "Exception handling SOP",
      section: "Eligible pets and limits",
      version: 1,
      effectiveDate: "2026-08-30",
      excerpt: "Each booking may bring one cat or dog up to 20 kg.",
      scope,
    }],
  };
}

describe("guest policy citations", () => {
  it("shows traceable public metadata and expands the excerpt with the native disclosure", async () => {
    const user = userEvent.setup();
    render(<PolicyCitations result={grounded()} />);
    expect(screen.getByText(/Pet policy · Eligible pets and limits/)).toBeVisible();
    expect(screen.getByText(/Version 1 · Effective 2026-08-30/)).toBeVisible();
    const summary = screen.getByText(/Pet policy · Eligible pets and limits/);
    summary.focus();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(screen.getByText(/one cat or dog up to 20 kg/i)).toBeVisible();
    expect(screen.queryByText(/scope|source path|public policy/i)).not.toBeInTheDocument();
  });

  it("drops the entire result when any staff citation reaches the guest UI", () => {
    render(<PolicyCitations result={grounded("staff")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be displayed safely/i);
    expect(screen.queryByText("Exception handling SOP")).not.toBeInTheDocument();
    expect(screen.queryByText(/one cat or dog/i)).not.toBeInTheDocument();
  });

  it("renders explicit uncertainty with no citations", () => {
    render(<PolicyCitations result={{ kind: "policy-search", status: "insufficient-evidence", answerContext: "", citations: [], truncated: false }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/No reliable public policy source/i);
  });
});
