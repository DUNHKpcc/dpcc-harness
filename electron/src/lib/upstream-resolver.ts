/**
 * Single source of truth for which upstream PccAgent routes each engine through.
 *
 * Each source is selected in Settings → Current Config:
 *   - default — the DPCC official upstream (origin-api.dpccgaming.xyz) + the DPCC account key
 *   - local — the user's current CLI configuration (Pi for live sessions;
 *             legacy Claude/Codex readers remain for stored settings only)
 *   - gateway — the in-app custom third-party gateway (Settings → Engines)
 *
 * The DPCC default replaces the engine's own login / cloud auth entirely. New
 * installs default to DPCC; local CLI and third-party gateway are opt-in
 * selections so the UI source and the session spawn behavior stay aligned.
 *
 * Consumers: ACP session spawn env and the
 * "Current Config" panel (effective-cli-config), and upstream model listing
 * (cc-config:models).
 */

import { getAppSetting } from "./app-settings";
import {
  credentialTokenForEngine,
  loadAccountCredential,
} from "./account-credential-store";
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

export type PiProviderApi = "anthropic-messages" | "openai-completions";

export interface PiProviderUpstream {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  api: PiProviderApi;
  /** Pi adds Authorization: Bearer for Anthropic-compatible DPCC traffic. */
  authHeader?: boolean;
  /** Static gateway candidates. DPCC candidates are fetched authoritatively at launch. */
  models: string[];
}

export interface PiUpstream {
  tier: UpstreamTier;
  providers: PiProviderUpstream[];
  /** Fully-qualified provider/model when known, otherwise an unqualified gateway model id. */
  model: string;
}

export const PI_DPCC_CLAUDE_PROVIDER_ID = "pcc-agent-dpcc-claude";
export const PI_DPCC_CODEX_PROVIDER_ID = "pcc-agent-dpcc-codex";
export const PI_GATEWAY_PROVIDER_ID = "pcc-agent-gateway";

function activeAccountCredential() {
  return getAppSetting("accountMode") === "guest"
    ? null
    : loadAccountCredential();
}

/**
 * DPCC resource host with no trailing slash or /v1.
 *
 * Browser-authorized credentials are issued by the separate account issuer,
 * but model and account-resource traffic stays pinned to the trusted resource
 * origin. Legacy manual credentials retain their explicitly configured host.
 */
function dpccHost(): string {
  const credential = activeAccountCredential();
  const configured = credential?.source === "desktop"
    ? DEFAULT_NEWAPI_BASE_URL
    : getAppSetting("dpccUpstream").baseUrl;
  const raw = (configured || "")
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

function selectedPiSource(): UpstreamTier {
  return normalizeSource(getAppSetting("piCliConfigSource")) ?? "default";
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
  const credential = activeAccountCredential();
  return {
    tier: "default",
    baseUrl: dpccHost(),
    token: credentialTokenForEngine(credential, "claude"),
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
    // (the ACP session path → "PccAgent Gateway"; the Current Config view → "—").
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
  const credential = activeAccountCredential();
  return {
    tier: "default",
    providerName: "DPCC API",
    baseUrl: `${dpccHost()}/v1`,
    apiKey: credentialTokenForEngine(credential, "codex"),
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

/** Resolve the official Pi ACP agent's independent upstream configuration. */
export function resolvePiUpstream(): PiUpstream {
  const source = selectedPiSource();
  if (source === "local") {
    return { tier: "local", providers: [], model: "" };
  }

  if (source === "gateway") {
    const gateway = getAppSetting("piGateway");
    const models = Array.from(new Set([
      gateway.model.trim(),
      ...(gateway.modelMappings ?? []).map((mapping) => mapping.modelId.trim()),
    ].filter(Boolean)));
    return {
      tier: "gateway",
      providers: [{
        id: PI_GATEWAY_PROVIDER_ID,
        name: gateway.name.trim() || "PccAgent Pi Gateway",
        baseUrl: gateway.baseUrl.trim(),
        apiKey: gateway.apiKey.trim(),
        api: "openai-completions",
        models,
      }],
      model: gateway.model.trim()
        ? (gateway.model.includes("/") ? gateway.model.trim() : `${PI_GATEWAY_PROVIDER_ID}/${gateway.model.trim()}`)
        : "",
    };
  }

  const dpcc = getAppSetting("dpccUpstream");
  const credential = activeAccountCredential();
  const host = dpccHost();
  return {
    tier: "default",
    providers: [
      {
        id: PI_DPCC_CLAUDE_PROVIDER_ID,
        name: "DPCC API (Claude)",
        baseUrl: host,
        apiKey: credentialTokenForEngine(credential, "claude"),
        api: "anthropic-messages",
        authHeader: true,
        models: [],
      },
      {
        id: PI_DPCC_CODEX_PROVIDER_ID,
        name: "DPCC API (Codex)",
        baseUrl: `${host}/v1`,
        apiKey: credentialTokenForEngine(credential, "codex"),
        api: "openai-completions",
        models: [],
      },
    ],
    model: dpcc.piModel?.trim() ?? "",
  };
}
