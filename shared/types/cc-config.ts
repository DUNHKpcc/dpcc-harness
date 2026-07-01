/**
 * "Current Config" — the effective gateway/provider config PccAgent actually
 * applies when starting sessions. Resolved by
 * electron/src/lib/effective-cli-config.ts; consumed by the CurrentConfigSettings panel.
 */

// ── Effective ("what PccAgent is actually using") config ──

/**
 * Where the config PccAgent applies to a session comes from (highest → lowest):
 *  - "gateway": the in-app custom third-party gateway (Settings → Engines) is enabled and winning
 *  - "default": the DPCC official upstream (api.dpccgaming.xyz) + the DPCC account key
 *
 * "local" is retained for older diagnostics/model-list responses, but current
 * session routing does not let local CLI config override the DPCC upstream.
 */
export type EffectiveConfigSource = "gateway" | "local" | "default";

/** The resolved, in-effect config for a single engine — read-only, secrets masked. */
export interface EffectiveEngineConfig {
  source: EffectiveConfigSource;
  /** Provider/gateway display name (Codex). null for Claude. */
  providerName: string | null;
  /** Effective endpoint. null when the engine's default cloud is used. */
  baseUrl: string | null;
  /** Masked auth token / API key. null when none is in effect. */
  maskedToken: string | null;
  /** Effective default model id. null = use the in-app model picker / engine default. */
  model: string | null;
}

/** The config PccAgent currently applies when starting sessions, per engine. */
export interface EffectiveCliConfig {
  claude: EffectiveEngineConfig;
  codex: EffectiveEngineConfig;
}

// ── Upstream model lists (pulled live from /v1/models) ──

/** All models available on a single engine's effective upstream. */
export interface EffectiveModelList {
  /** Which tier the models were pulled from (mirrors EffectiveConfigSource). */
  source: EffectiveConfigSource;
  /** Model ids available on the effective upstream (empty when none / unreachable). */
  models: string[];
  /** Non-null when the listing failed (e.g. unreachable, unauthorized, no token). */
  error: string | null;
}

/** Live upstream model lists for both engines, used by the Current Config panel. */
export interface EffectiveCliModels {
  claude: EffectiveModelList;
  codex: EffectiveModelList;
}
