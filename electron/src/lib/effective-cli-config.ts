/**
 * Resolves the config PccAgent actually applies when starting sessions — the
 * "effective" view shown read-only in Settings → Current Config.
 *
 * Precedence mirrors the session spawn logic (see upstream-resolver):
 *  - gateway: the in-app custom third-party gateway, when enabled (highest)
 *  - local:   the user's local ~/.claude env / ~/.codex provider
 *  - default: the DPCC official upstream (api.dpccgaming.xyz) + the DPCC account key
 *
 * The "default" tier is no longer the engine's own login — it routes to the DPCC
 * upstream, so it carries a real base URL + (masked) token.
 */

import {
  resolveClaudeUpstream,
  resolveCodexUpstream,
} from "./upstream-resolver";
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
  const u = resolveClaudeUpstream();
  return {
    source: u.tier,
    providerName: null,
    baseUrl: u.baseUrl || null,
    maskedToken: maskSecret(u.token),
    model: u.model || null,
  };
}

function resolveCodex(): EffectiveEngineConfig {
  const u = resolveCodexUpstream();
  return {
    source: u.tier,
    providerName: u.providerName || null,
    baseUrl: u.baseUrl || null,
    maskedToken: maskSecret(u.apiKey),
    model: u.model || null,
  };
}

export function resolveEffectiveCliConfig(): EffectiveCliConfig {
  return { claude: resolveClaude(), codex: resolveCodex() };
}
