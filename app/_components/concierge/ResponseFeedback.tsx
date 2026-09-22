"use client";
import { useState } from "react";
export type ResponseReceipt = { traceId: string; token: string | null };
export default function ResponseFeedback({ receipt, busy }: { receipt: ResponseReceipt; busy: boolean }) {
  const [state, setState] = useState(""), [saving, setSaving] = useState(false);
  async function rate(rating: "helpful" | "not-helpful") {
    setSaving(true); setState("");
    try {
      const response = await fetch("/api/ai/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ traceId: receipt.traceId, token: receipt.token, rating }) });
      if (!response.ok) throw new Error();
      setState("Feedback saved.");
    } catch { setState("Feedback could not be saved. Please try again."); }
    finally { setSaving(false); }
  }
  return <div className="space-y-2 text-xs text-primary-300">
    <p>Reference: <code>{receipt.traceId}</code></p>
    {receipt.token ? <div className="flex gap-3"><button type="button" disabled={busy || saving} onClick={() => void rate("helpful")}>Helpful</button><button type="button" disabled={busy || saving} onClick={() => void rate("not-helpful")}>Not helpful</button></div> : null}
    {state ? <p role="status">{state}</p> : null}
  </div>;
}
