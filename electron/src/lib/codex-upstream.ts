import { log } from "./logger";
import { resolveCodexUpstream } from "./upstream-resolver";

export const CODEX_GATEWAY_PROVIDER_ID = "pcc-agent-gateway";
export const CODEX_GATEWAY_ENV_KEY = "PCCAGENT_GATEWAY_API_KEY";

/**
 * Extra spawn env for the effective Codex upstream — injects the API key under the
 * provider's env_key. Empty for the local tier (the user's ~/.codex provider owns
 * its own credentials) or when the resolved upstream has no key.
 */
export function codexUpstreamEnv(): Record<string, string> {
  const u = resolveCodexUpstream();
  if (u.tier === "local" || !u.apiKey) return {};
  return { [CODEX_GATEWAY_ENV_KEY]: u.apiKey };
}

/**
 * thread/start params for the effective Codex upstream: a `model_providers.<id>`
 * override table (base_url / env_key / wire_api) plus provider + model selection.
 * Covers both the custom gateway (highest) and the DPCC default upstream (lowest).
 * Returns {} for the local tier — the user's ~/.codex/config.toml already defines
 * the provider, so PccAgent defers to it.
 */
export function codexUpstreamThreadParams(): Record<string, unknown> {
  const u = resolveCodexUpstream();
  if (u.tier === "local") {
    log("CODEX_GATEWAY_DEFER", "local ~/.codex/config.toml overrides PccAgent upstream");
    return {};
  }
  if (!u.baseUrl) return {};
  const model = u.model;
  const name = u.providerName || (u.tier === "default" ? "DPCC API" : "PccAgent Gateway");
  return {
    modelProvider: CODEX_GATEWAY_PROVIDER_ID,
    ...(model ? { model } : {}),
    config: {
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.name`]: name,
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.base_url`]: u.baseUrl,
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.env_key`]: CODEX_GATEWAY_ENV_KEY,
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.wire_api`]: "responses",
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.requires_openai_auth`]: false,
      model_provider: CODEX_GATEWAY_PROVIDER_ID,
      ...(model ? { model } : {}),
    },
  };
}
