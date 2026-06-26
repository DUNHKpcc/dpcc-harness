/**
 * Single source of truth for which upstream PccAgent routes each engine through.
 *
 * Precedence (highest → lowest):
 *   1. gateway — the in-app custom third-party gateway (Settings → Engines), when enabled
 *   2. default — the DPCC official upstream (api.dpccgaming.xyz) + the DPCC account key
 *
 * The DPCC default replaces the engine's own login / cloud auth entirely: when no
 * explicit third-party gateway applies, sessions are routed to api.dpccgaming.xyz,
 * even if the user's local ~/.claude or ~/.codex config contains another provider.
 *
 * Consumers: session spawn env (claude-gateway-env, codex-sessions), the read-only
 * "Current Config" panel (effective-cli-config), and upstream model listing
 * (cc-config:models).
 */

import { getAppSetting } from "./app-settings";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";

export type UpstreamTier = "gateway" | "local" | "default";

export interface ClaudeUpstream {
  tier: UpstreamTier;
  /** Effective base URL. */
  baseUrl: string;
  /** Effective bearer token (may be "" when unset). */
  token: string;
  /** Effective default model id (may be ""). */
  model: string;
}

export interface CodexUpstream {
  tier: UpstreamTier;
  /** Provider display name (gateway/default). */
  providerName: string;
  /** Effective base URL, including the /v1 suffix where relevant. */
  baseUrl: string;
  /** Effective api key (gateway/default). */
  apiKey: string;
  /** Effective default model id (may be ""). */
  model: string;
}

/** DPCC host root with no trailing slash or /v1 (falls back to the platform default). */
function dpccHost(): string {
  const raw = (getAppSetting("dpccUpstream").baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  return raw || DEFAULT_NEWAPI_BASE_URL.replace(/\/+$/, "");
}

/** Resolve the effective Claude upstream by the gateway → DPCC-default ladder. */
export function resolveClaudeUpstream(): ClaudeUpstream {
  const g = getAppSetting("claudeGateway");
  if (g?.enabled && (g.baseUrl.trim() || g.authToken.trim())) {
    return {
      tier: "gateway",
      baseUrl: g.baseUrl.trim(),
      token: g.authToken.trim(),
      model: g.model.trim(),
    };
  }
  const dpcc = getAppSetting("dpccUpstream");
  return {
    tier: "default",
    baseUrl: dpccHost(),
    token: dpcc.claudeToken.trim(),
    model: dpcc.claudeModel.trim(),
  };
}

/** Resolve the effective Codex upstream by the gateway → DPCC-default ladder. */
export function resolveCodexUpstream(): CodexUpstream {
  const c = getAppSetting("codexGateway");
  if (c?.enabled && c.baseUrl.trim()) {
    return {
      // Leave the name empty when unset so each consumer applies its own fallback
      // (codex-sessions → "PccAgent Gateway"; the Current Config view → "—").
      tier: "gateway",
      providerName: c.name.trim(),
      baseUrl: c.baseUrl.trim(),
      apiKey: c.apiKey.trim(),
      model: c.model.trim(),
    };
  }
  const dpcc = getAppSetting("dpccUpstream");
  return {
    tier: "default",
    providerName: "DPCC API",
    baseUrl: `${dpccHost()}/v1`,
    apiKey: dpcc.codexToken.trim(),
    model: dpcc.codexModel.trim(),
  };
}
