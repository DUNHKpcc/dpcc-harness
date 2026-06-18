/**
 * Resolves the config PccAgent actually applies when starting sessions — the
 * "effective" view shown read-only in Settings → Current Config.
 *
 * Precedence mirrors the session spawn logic:
 *  - Claude: local ~/.claude env wins (localClaudeGatewayTakesPriority) → in-app
 *    gateway when enabled → otherwise the engine default (login / cloud).
 *    A local ANTHROPIC_MODEL overrides the gateway model.
 *  - Codex: local ~/.codex provider wins (localCodexGatewayTakesPriority) →
 *    in-app gateway when enabled with a base URL → otherwise the engine default.
 */

import { getAppSetting } from "./app-settings";
import {
  loadLocalClaudeEnv,
  loadLocalCodexProvider,
  localClaudeGatewayTakesPriority,
  localCodexGatewayTakesPriority,
} from "./local-cli-config";
import type {
  EffectiveCliConfig,
  EffectiveEngineConfig,
} from "@shared/types/cc-config";

/** Mask a secret, keeping a short head/tail for recognizability. */
function maskSecret(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(Math.min(8, v.length - 8))}${v.slice(-4)}`;
}

function resolveClaude(): EffectiveEngineConfig {
  const env = loadLocalClaudeEnv();
  const localBase = (env.ANTHROPIC_BASE_URL ?? "").trim();
  const localToken = (env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? "").trim();
  const localModel = (env.ANTHROPIC_MODEL ?? "").trim();
  const g = getAppSetting("claudeGateway");

  if (localClaudeGatewayTakesPriority()) {
    return {
      source: "local",
      providerName: null,
      baseUrl: localBase || null,
      maskedToken: maskSecret(localToken),
      model: localModel || null,
    };
  }

  if (g?.enabled && (g.baseUrl.trim() || g.authToken.trim())) {
    return {
      source: "gateway",
      providerName: null,
      baseUrl: g.baseUrl.trim() || null,
      maskedToken: maskSecret(g.authToken),
      // A local ANTHROPIC_MODEL still wins over the gateway model (see claudeGatewayModel).
      model: localModel || g.model.trim() || null,
    };
  }

  return {
    source: "default",
    providerName: null,
    baseUrl: null,
    maskedToken: null,
    model: localModel || null,
  };
}

function resolveCodex(): EffectiveEngineConfig {
  const c = getAppSetting("codexGateway");

  if (localCodexGatewayTakesPriority()) {
    const local = loadLocalCodexProvider();
    return {
      source: "local",
      providerName: local.provider,
      baseUrl: local.baseUrl,
      maskedToken: null,
      model: local.model,
    };
  }

  if (c?.enabled && c.baseUrl.trim()) {
    return {
      source: "gateway",
      providerName: c.name.trim() || "Custom",
      baseUrl: c.baseUrl.trim(),
      maskedToken: maskSecret(c.apiKey),
      model: c.model.trim() || null,
    };
  }

  return {
    source: "default",
    providerName: null,
    baseUrl: null,
    maskedToken: null,
    model: null,
  };
}

export function resolveEffectiveCliConfig(): EffectiveCliConfig {
  return { claude: resolveClaude(), codex: resolveCodex() };
}
