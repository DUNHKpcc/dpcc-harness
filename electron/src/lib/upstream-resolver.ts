/**
 * Single source of truth for which upstream PccAgent routes each engine through.
 *
 * Each source is selected in Settings → Current Config:
 *   - default — the DPCC official upstream (api.dpccgaming.xyz) + the DPCC account key
 *   - local — the user's current Claude Code / Codex CLI configuration
 *   - gateway — the in-app custom third-party gateway (Settings → Engines)
 *
 * The DPCC default replaces the engine's own login / cloud auth entirely. New
 * installs default to DPCC; local CLI and third-party gateway are opt-in
 * selections so the UI source and the session spawn behavior stay aligned.
 *
 * Consumers: session spawn env (claude-gateway-env, codex-sessions), the
 * "Current Config" panel (effective-cli-config), and upstream model listing
 * (cc-config:models).
 */

import { getAppSetting } from "./app-settings";
import { loadLocalClaudeEnv, loadLocalCodexProvider } from "./local-cli-config";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";
import { isActiveThirdPartyGateway } from "@shared/lib/upstream-routing";

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

function normalizeSource(source: unknown): UpstreamTier | null {
  return source === "local" || source === "gateway" || source === "default" ? source : null;
}

function selectedClaudeSource(): UpstreamTier {
  return normalizeSource(getAppSetting("claudeCliConfigSource"))
    ?? normalizeSource(getAppSetting("cliConfigSource"))
    ?? "default";
}

function selectedCodexSource(): UpstreamTier {
  return normalizeSource(getAppSetting("codexCliConfigSource"))
    ?? normalizeSource(getAppSetting("cliConfigSource"))
    ?? "default";
}

function resolveLocalClaudeUpstream(): ClaudeUpstream {
  const env = loadLocalClaudeEnv();
  return {
    tier: "local",
    baseUrl: env.ANTHROPIC_BASE_URL?.trim() ?? "",
    token: (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || "").trim(),
    model: env.ANTHROPIC_MODEL?.trim() ?? "",
  };
}

function resolveGatewayClaudeUpstream(): ClaudeUpstream {
  const g = getAppSetting("claudeGateway");
  return {
    tier: "gateway",
    baseUrl: g.baseUrl.trim(),
    token: g.authToken.trim(),
    model: g.model.trim(),
  };
}

function hasConfiguredClaudeGateway(): boolean {
  const g = getAppSetting("claudeGateway");
  return isActiveThirdPartyGateway({
    enabled: g.enabled,
    baseUrl: g.baseUrl,
    credential: g.authToken,
  });
}

function resolveDefaultClaudeUpstream(): ClaudeUpstream {
  const dpcc = getAppSetting("dpccUpstream");
  return {
    tier: "default",
    baseUrl: dpccHost(),
    token: dpcc.claudeToken.trim(),
    model: dpcc.claudeModel.trim(),
  };
}

function resolveLocalCodexUpstream(): CodexUpstream {
  const local = loadLocalCodexProvider();
  return {
    tier: "local",
    providerName: local.provider ?? "",
    baseUrl: local.baseUrl ?? "",
    apiKey: "",
    model: local.model ?? "",
  };
}

function resolveGatewayCodexUpstream(): CodexUpstream {
  const c = getAppSetting("codexGateway");
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

function hasConfiguredCodexGateway(): boolean {
  const c = getAppSetting("codexGateway");
  return isActiveThirdPartyGateway({
    enabled: c.enabled,
    baseUrl: c.baseUrl,
    credential: c.apiKey,
  });
}

function resolveDefaultCodexUpstream(): CodexUpstream {
  const dpcc = getAppSetting("dpccUpstream");
  return {
    tier: "default",
    providerName: "DPCC API",
    baseUrl: `${dpccHost()}/v1`,
    apiKey: dpcc.codexToken.trim(),
    model: dpcc.codexModel.trim(),
  };
}

/** Resolve the effective Claude upstream from the user-selected Current Config source. */
export function resolveClaudeUpstream(): ClaudeUpstream {
  switch (selectedClaudeSource()) {
    case "local":
      return resolveLocalClaudeUpstream();
    case "gateway":
      return hasConfiguredClaudeGateway() ? resolveGatewayClaudeUpstream() : resolveDefaultClaudeUpstream();
    case "default":
    default:
      return resolveDefaultClaudeUpstream();
  }
}

/** Resolve the effective Codex upstream from the user-selected Current Config source. */
export function resolveCodexUpstream(): CodexUpstream {
  switch (selectedCodexSource()) {
    case "local":
      return resolveLocalCodexUpstream();
    case "gateway":
      return hasConfiguredCodexGateway() ? resolveGatewayCodexUpstream() : resolveDefaultCodexUpstream();
    case "default":
    default:
      return resolveDefaultCodexUpstream();
  }
}
