/**
 * "Current Config" — the effective gateway/provider config PccAgent actually
 * applies when starting sessions. Resolved read-only by
 * electron/src/lib/effective-cli-config.ts; consumed by the CurrentConfigSettings panel.
 */

// ── Effective ("what PccAgent is actually using") config ──

/**
 * Where the config PccAgent applies to a session comes from:
 *  - "gateway": the in-app custom gateway (Settings → Engines) is enabled and winning
 *  - "local":   the user's local CLI config (~/.claude, ~/.codex) is set and takes priority
 *  - "default": no custom endpoint — the engine's own login / cloud default is used
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
