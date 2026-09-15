import type { PolicySearchResult } from "@/app/_ai/policies/policy-types";

export default function PolicyCitations({ result }: { result: PolicySearchResult }) {
  if (result.status === "insufficient-evidence") {
    return (
      <p
        role="status"
        className="rounded-md border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100"
      >
        No reliable public policy source was found. Please contact the hotel team for confirmation.
      </p>
    );
  }

  if (result.citations.some((citation) => citation.scope !== "public")) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-400/50 bg-red-950/40 p-3 text-sm text-red-100"
      >
        Policy sources could not be displayed safely.
      </p>
    );
  }

  return (
    <section aria-label="Hotel policy sources" className="space-y-2">
      <h3 className="text-sm font-semibold text-accent-300">
        Policy sources
      </h3>
      {result.citations.map((citation) => (
        <details
          key={`${citation.documentId}-${citation.version}-${citation.section}`}
          className="rounded-md border border-primary-700 bg-primary-900 px-3 py-2 text-sm text-primary-200"
        >
          <summary tabIndex={0} className="cursor-pointer rounded-sm font-medium text-primary-100 focus:outline-none focus:ring-2 focus:ring-accent-400">
            {citation.title} · {citation.section}
            <span className="mt-1 block text-xs font-normal text-primary-400">
              Version {citation.version} · Effective {citation.effectiveDate}
            </span>
          </summary>
          <p className="mt-2 border-t border-primary-700 pt-2 leading-6">
            {citation.excerpt}
          </p>
        </details>
      ))}
    </section>
  );
}
