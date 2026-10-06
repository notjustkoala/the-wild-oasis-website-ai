import "server-only";
import { resolveConciergeModel, resolveConciergeProviderConfiguration, ConciergeProviderConfigurationError } from "./concierge-model";

function operationsEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, AI_CONCIERGE_MODEL: env.AI_OPERATIONS_MODEL?.trim() || env.AI_CONCIERGE_MODEL };
}
export function resolveOperationsProviderConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return resolveConciergeProviderConfiguration(operationsEnvironment(env));
}
export function resolveOperationsModel(env: NodeJS.ProcessEnv = process.env) {
  return resolveConciergeModel(operationsEnvironment(env));
}
export function getOperationsProviderConfigurationError(env: NodeJS.ProcessEnv = process.env) {
  try { resolveOperationsProviderConfiguration(env); return null; }
  catch (error) { if (error instanceof ConciergeProviderConfigurationError) return error; throw error; }
}
