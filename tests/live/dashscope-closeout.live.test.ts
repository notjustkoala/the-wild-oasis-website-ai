import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { createConciergeAgent, CONCIERGE_INSTRUCTIONS } from '@/app/_ai/agents/concierge-agent';
import { resolveDashScopeModel } from '@/app/_ai/providers/dashscope-model';
import { createDashScopeTransport } from '@/app/_ai/providers/dashscope-transport';
import { createCabinTools } from '@/app/_ai/tools/cabin-tools';
import { createRunObserver } from '@/app/_ai/observability/run';
import { createEvaluationDataSource } from '../ai/evals/concierge-fixture';
import { assessLiveResult, liveCases as catalogCases } from './assertions';

// Kept separate from historical development-database evals. All business tools
// and persistence are injected; this suite never connects to Supabase.
it('measures current real DashScope streaming with fixed synthetic inventory', async () => {
  expect(process.env.AI_CLOSEOUT_LIVE).toBe('1');
  const selected = (process.env.AI_CLOSEOUT_CASES ?? '').split(',').filter(Boolean);
  if (selected.some(id => !catalogCases.some(row => row.id === id))) throw new Error('Unknown fixed case.');
  const cases = selected.length ? catalogCases.filter(row => selected.includes(row.id)) : catalogCases;
  const liveCases = cases;
  const outputCap = 1024, requestCap = 32, maxReservedCNY = 1;
  const price = { currency: 'CNY', asOf: '2026-10-08', source: 'https://help.aliyun.com/zh/model-studio/model-pricing', region: 'cn-beijing', inputPerMillion: 2, outputPerMillion: 8, embeddingInputPerMillion: 0.5, basis: 'Original list price, <=256K input, non-thinking; ignores promotional/caching/free-tier discounts. Not an invoice.' };
  let reservedCNY = 0, requests = 0;
  const transport = createDashScopeTransport(process.env);
  const boundedFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.hostname.endsWith('.cn-beijing.maas.aliyuncs.com') || !url.pathname.endsWith('/chat/completions')) throw new Error('Evaluation transport destination rejected.');
    const body = JSON.parse(String(init?.body));
    body.max_tokens = outputCap;
    delete body.max_completion_tokens;
    // UTF-8 byte bound with margin deliberately over-reserves tokens, including
    // repeated tool schemas/history. Reserve before POST, including retries.
    const inputBound = Buffer.byteLength(JSON.stringify(body), 'utf8') * 2 + 1024;
    if (inputBound > 256_000) throw new Error('Evaluation context bound exceeded.');
    const reserve = (inputBound * price.inputPerMillion + outputCap * price.outputPerMillion) / 1_000_000;
    if (requests >= requestCap || reservedCNY + reserve > maxReservedCNY) throw new Error('Evaluation allowance exhausted.');
    requests++; reservedCNY += reserve;
    return transport(input, { ...init, body: JSON.stringify(body), signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(80_000)]) });
  };
  const model = resolveDashScopeModel(process.env, { fetch: boundedFetch });
  const results: Array<Record<string, any>> = [];
  const syntheticAnswers: Array<{ id: string; text: string }> = [];
  const folder = 'output/closeout'; mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':','-');
  const save = () => {
    const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null; };
    const completed = results.filter(r => r.finished && !r.streamError);
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), model: 'qwen3.7-plus', mode: 'real-model-streaming-synthetic-tools-no-database', promptHash: createHash('sha256').update(CONCIERGE_INSTRUCTIONS).digest('hex'), outputCap, price, budget: { maxReservedCNY, reservedCNY, requests, requestCap }, expectedCount: liveCases.length, attemptedCount: results.length, complete: results.length === liveCases.length, passed: results.filter(r => r.passed).length, generationCompleted: completed.length, p50DurationMs: percentile(completed.map(r => r.durationMs), .5), p95DurationMs: percentile(completed.map(r => r.durationMs), .95), p50TTFTMs: percentile(completed.filter(r => r.ttftMs !== null).map(r => r.ttftMs), .5), p95TTFTMs: percentile(completed.filter(r => r.ttftMs !== null).map(r => r.ttftMs), .95), listPriceEstimatedCNY: results.every(r => r.listPriceEstimatedCNY !== null) ? results.reduce((n,r) => n+r.listPriceEstimatedCNY,0) : null, results, limitations: ['Synthetic business tools; no production RLS, live inventory, embedding quality or user satisfaction measurement.', 'Deterministic assertions, not semantic accuracy.', 'TTFT includes prior tool steps; separate from first card time.', 'Output capped at 1024 per request for evaluation; production settings are unchanged.', 'Cost uses measured usage and conservative original list price; not an invoice. Unknown usage is null, not zero.', 'No prompts, answers, trace IDs, credentials or private data in report. Historical failures remain separate.'] };
    writeFileSync(`${folder}/dashscope-evaluation.json`, JSON.stringify(report,null,2)+'\n');
    writeFileSync(`${folder}/dashscope-${stamp}.json`, JSON.stringify(report,null,2)+'\n');
    writeFileSync(`${folder}/synthetic-answers-${stamp}.json`, JSON.stringify(syntheticAnswers,null,2)+'\n');
    return report;
  };
  save();
  for (const row of cases) {
    const source = createEvaluationDataSource();
    if (row.inventory === 'empty') source.listCabins = async () => [];
    if (row.inventory === 'conflict') source.getConflictingCabinIds = async () => [1];
    if (row.inventory === 'error') source.listCabins = async () => { throw new Error('Synthetic tool failure'); };
    const observer = createRunObserver({ surface: 'concierge', model: 'qwen3.7-plus', promptVersion: 'closeout-fixture', persist: async () => true });
    const agent = createConciergeAgent({ model, observer, tools: createCabinTools(source), policySearchTool: tool({ description: 'Search synthetic policy evidence', inputSchema: z.object({ question: z.string() }), execute: async () => ({ kind: 'policy-search' as const, status: 'insufficient-evidence' as const, answerContext: '' as const, citations: [], truncated: false as const }) }) as never });
    const start = Date.now(); let firstText: number | null = null, text = '', finished = false, streamError = false;
    const calls: any[] = [], outputs: any[] = []; let toolErrors = 0, checks: Record<string, boolean> = {};
    try {
      const result = await agent.stream({ messages: [...(row.previous ? [{ role: 'user' as const, content: row.previous }, { role: 'assistant' as const, content: 'Please review those dates.' }] : []), { role: 'user' as const, content: row.prompt }], timeout: { totalMs: 85_000 } });
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') { firstText ??= Date.now()-start; observer.firstText(); text += part.text; }
        if (part.type === 'tool-call') calls.push({ toolName: part.toolName, input: part.input });
        if (part.type === 'tool-result') outputs.push({ toolName: part.toolName, output: part.output });
        if (part.type === 'tool-error') toolErrors++;
        if (part.type === 'error' || part.type === 'abort') streamError = true;
        if (part.type === 'finish') finished = part.finishReason === 'stop';
      }
      checks = assessLiveResult(row, { text, calls, outputs, toolErrors });
    } catch { streamError = true; }
    if (streamError || !finished) observer.mark('failed','provider-unavailable');
    const record = await observer.finish();
    const cost = record.input_tokens !== null && record.output_tokens !== null && !streamError ? (record.input_tokens*price.inputPerMillion+record.output_tokens*price.outputPerMillion)/1_000_000 : null;
    const item = { id: row.id, passed: finished && !streamError && Object.values(checks).every(Boolean) && Object.keys(checks).length > 0, finished, streamError, checks, durationMs: Date.now()-start, ttftMs: firstText, inputTokens: record.input_tokens, outputTokens: record.output_tokens, listPriceEstimatedCNY: cost, tools: [...new Set(calls.map(c=>c.toolName))], toolErrors };
    syntheticAnswers.push({ id: row.id, text });
    results.push(item); save(); console.log(JSON.stringify(item));
    if (streamError) break; // Bounded batch; never repeatedly replay a failed provider.
  }
  const report = save();
  console.log(JSON.stringify({ complete: report.complete, passed: report.passed, attempted: report.attemptedCount, listPriceEstimatedCNY: report.listPriceEstimatedCNY, reservedCNY }));
  expect(results).toHaveLength(cases.length); expect(results.every(r => r.passed)).toBe(true);
});
