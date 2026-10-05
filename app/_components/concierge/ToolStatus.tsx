import { CONCIERGE_INPUT_NOTICE_PREFIX } from "@/app/_ai/tools/input-error";

type ToolStatusProps = {
  label: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  errorText?: string;
  interrupted?: boolean;
};

const statusCopy: Record<ToolStatusProps["state"], string> = {
  "input-streaming": "Preparing request…",
  "input-available": "Checking live data…",
  "approval-requested": "Waiting for approval…",
  "approval-responded": "Approval received…",
  "output-available": "Live data checked",
  "output-error": "Could not load live data",
  "output-denied": "Request was not approved",
};

export default function ToolStatus({ label, state, errorText, interrupted = false }: ToolStatusProps) {
  const needsUpdate = state === "output-error" && errorText?.startsWith(CONCIERGE_INPUT_NOTICE_PREFIX);
  const failed = !needsUpdate && (state === "output-error" || state === "output-denied");
  const stopped = interrupted && state !== "output-available" && state !== "output-error" && !failed;
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        needsUpdate
          ? "border-amber-500/50 bg-amber-950/30 text-amber-100"
          : failed
          ? "border-red-400/50 bg-red-950/40 text-red-100"
          : "border-primary-700 bg-primary-900/70 text-primary-300"
      }`}
      role="status"
    >
      <span className="font-semibold text-primary-100">{label}: </span>
      {stopped ? "Stopped before a result was received" : needsUpdate ? errorText?.slice(CONCIERGE_INPUT_NOTICE_PREFIX.length) : errorText || statusCopy[state]}
    </div>
  );
}
