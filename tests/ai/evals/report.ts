export type Metric = { passed: number; applicable: number; skipped: number; rate: number | null };
export type EvalResult = { id: string; mode: string; checks: Record<string, boolean | null>; failures: string[]; durationMs: number; tools: string[]; status: string };
export function summarize(results: EvalResult[]) {
  const metrics: Record<string, Metric> = {};
  for (const name of ["toolSelection", "hardConstraints", "citations", "authorization"]) {
    const applicable = results.filter(row => typeof row.checks[name] === "boolean");
    const passed = applicable.filter(row => row.checks[name]).length;
    metrics[name] = { passed, applicable: applicable.length, skipped: results.length - applicable.length, rate: applicable.length ? passed / applicable.length : null };
  }
  return { schemaVersion: 1, mode: "offline-mock-and-synthetic", seed: 5, referenceDate: "2026-09-17", generatedAt: new Date().toISOString(), model: "MockLanguageModelV4 / synthetic feature vectors", promptVersion: "feature05-eval-v1", count: results.length, metrics, failures: results.filter(row => row.failures.length), results };
}
export function markdown(report: ReturnType<typeof summarize>) {
  return `# Feature05 offline evaluation\n\nMode: ${report.mode}. No remote model or database calls. Mock routing is not model accuracy.\n\nGenerated: ${report.generatedAt}; seed: ${report.seed}; reference date: ${report.referenceDate}.\n\n| Metric | Passed | Applicable | Skipped | Rate |\n| --- | ---: | ---: | ---: | ---: |\n${Object.entries(report.metrics).map(([name,m]) => `| ${name} | ${m.passed} | ${m.applicable} | ${m.skipped} | ${m.rate === null ? "N/A" : (m.rate*100).toFixed(2)+"%"} |`).join("\n")}\n\n## Failures\n\n${report.failures.length ? report.failures.map(row => `- ${row.id}: ${row.failures.join(", ")}`).join("\n") : "None."}\n\nToken usage, TTFT and cost: not applicable to this offline harness.\n`;
}
