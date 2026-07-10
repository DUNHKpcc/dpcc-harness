import { resolveCodexUpstream } from "./upstream-resolver";

export const CODEX_GATEWAY_PROVIDER_ID = "pcc-agent-gateway";
export const CODEX_GATEWAY_ENV_KEY = "PCCAGENT_GATEWAY_API_KEY";

/**
 * Extra spawn env for the effective Codex upstream — injects the API key under the
 * provider's env_key. Empty when the resolved upstream has no key.
 */
export function codexUpstreamEnv(): Record<string, string> {
  const u = resolveCodexUpstream();
  if (u.tier === "local") return {};
  if (!u.apiKey) return {};
  return { [CODEX_GATEWAY_ENV_KEY]: u.apiKey };
}

/**
 * thread/start params for the effective Codex upstream: a `model_providers.<id>`
 * override table (base_url / env_key / wire_api) plus provider + model selection.
 * Covers both the explicit custom gateway and the DPCC official default upstream.
 */
export function codexUpstreamThreadParams(selectedModel?: string): Record<string, unknown> {
  const u = resolveCodexUpstream();
  if (u.tier === "local") return {};
  if (!u.baseUrl) return {};
  const model = selectedModel?.trim() || u.model.trim() || "";
  const name = u.providerName || (u.tier === "default" ? "DPCC API" : "PccAgent Gateway");
  const params: Record<string, unknown> = {
    modelProvider: CODEX_GATEWAY_PROVIDER_ID,
    config: {
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.name`]: name,
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.base_url`]: u.baseUrl,
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.env_key`]: CODEX_GATEWAY_ENV_KEY,
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.wire_api`]: "responses",
      [`model_providers.${CODEX_GATEWAY_PROVIDER_ID}.requires_openai_auth`]: false,
      model_provider: CODEX_GATEWAY_PROVIDER_ID,
    },
  };
  if (model) {
    params.model = model;
    (params.config as Record<string, unknown>).model = model;
  }
  return params;
}
