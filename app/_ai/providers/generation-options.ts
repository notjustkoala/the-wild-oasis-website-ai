import "server-only";
import { DEFAULT_AI_PROVIDER } from "./concierge-model";
import { createHash } from "node:crypto";

export type GenerationSurface = "concierge" | "operations" | "booking-insight";
export function generationOptions(surface: GenerationSurface, env: NodeJS.ProcessEnv = process.env) {
  if ((env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_AI_PROVIDER) !== "openai") return {};
  const key = surface === "concierge" ? "AI_CONCIERGE_REASONING_EFFORT" : surface === "operations" ? "AI_OPERATIONS_REASONING_EFFORT" : "AI_BOOKING_INSIGHT_REASONING_EFFORT";
  const effort = env[key]?.trim() || "low";
  if (!["none", "low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("Invalid generation reasoning effort.");
  return {
    maxOutputTokens: surface === "booking-insight" ? 4096 : 6144,
    providerOptions: { openai: { reasoningEffort: effort, store: false, serviceTier: "default" as const, textVerbosity: "low" as const } },
  };
}

export function generationConfigVersion(surface: GenerationSurface, promptVersion: string, env: NodeJS.ProcessEnv = process.env) {
  const settings = generationOptions(surface, env);
  if (!settings.providerOptions) return promptVersion;
  return `${promptVersion}-${createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 10)}`;
}
