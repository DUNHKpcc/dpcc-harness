/**
 * Resolves the config PccAgent actually applies when starting sessions — the
 * "effective" view shown in Settings → Current Config.
 *
 * Source options mirror the Pi ACP spawn logic (see upstream-resolver):
 *  - default: the DPCC official upstream (origin-api.dpccgaming.xyz) + the DPCC account key
 *  - local: the user's current Pi CLI configuration
 *  - gateway: the in-app custom third-party gateway
 *
 * The "default" tier routes to the DPCC upstream, so it carries a real base URL
 * + (masked) token. Current Config lets the user choose local or gateway instead.
 */

import { resolvePiUpstream } from "./upstream-resolver";
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

function resolvePi(): EffectiveEngineConfig {
  const upstream = resolvePiUpstream();
  const providers = upstream.providers;
  const primary = providers[0];
  return {
    source: upstream.tier,
    providerName: providers.map((provider) => provider.name).join(" + ") || "Local Pi",
    baseUrl: providers.map((provider) => provider.baseUrl).filter(Boolean).join(" | ") || null,
    maskedToken: providers.length === 1 ? maskSecret(primary?.apiKey) : null,
    ...(providers.length > 1
      ? {
          credentials: providers.map((provider) => ({
            label: provider.api === "anthropic-messages" ? "Claude" : "Codex",
            maskedToken: maskSecret(provider.apiKey),
          })),
        }
      : {}),
    model: upstream.model || null,
  };
}

export function resolveEffectiveCliConfig(): EffectiveCliConfig {
  // Keep the legacy-shaped fields in the IPC response for one compatibility
  // cycle, but never resolve or probe their removed runtimes.
  const empty: EffectiveEngineConfig = {
    source: "default",
    providerName: null,
    baseUrl: null,
    maskedToken: null,
    model: null,
  };
  return { claude: { ...empty }, codex: { ...empty }, pi: resolvePi() };
}
