/**
 * Shared Claude gateway / upstream resolution.
 *
 * Every code path that spawns Claude — interactive sessions, the WeChat bridge
 * adapter, and one-shot utility queries (chat-title + commit-message generation)
 * — must authenticate against the same upstream. When they don't, requests hit a
 * bare endpoint and the gateway replies "not login" (B4: WeChat sends fail;
 * B5b: built-in title generation returns "not login" as the title).
 *
 * Precedence (see upstream-resolver): custom gateway > DPCC default upstream.
 * Process env wins over ~/.claude/settings.json env, so claudeSpawnEnv purges
 * inherited ANTHROPIC_* before injecting the resolved upstream. This prevents a
 * stale local CLI key or base URL from overriding DPCC unless the user explicitly
 * enables a third-party gateway in app settings.
 */

import { loadLocalClaudeEnv } from "./local-cli-config";
import { clientAppEnv } from "./sdk";
import { resolveClaudeUpstream } from "./upstream-resolver";

const DEFAULT_SETTING_SOURCES = ["user", "project", "local"];
const GATEWAY_SETTING_SOURCES = ["project", "local"];

function hasClaudeUpstreamOverride(): boolean {
  const u = resolveClaudeUpstream();
  return u.tier !== "local" && Boolean(u.baseUrl || u.token);
}

/**
 * Env vars for the effective Claude upstream (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN).
 * Returns the env override for the gateway/default tier.
 */
export function claudeGatewayEnv(): Record<string, string> {
  const u = resolveClaudeUpstream();
  if (u.tier === "local") return {};
  const env: Record<string, string> = {};
  if (u.baseUrl) env.ANTHROPIC_BASE_URL = u.baseUrl;
  if (u.token) env.ANTHROPIC_AUTH_TOKEN = u.token;
  return env;
}

/**
 * Full subprocess env for spawning Claude. When a gateway/default override wins,
 * purge inherited ANTHROPIC_* (from process.env or ~/.claude) before applying the
 * override so the resolved upstream fully controls auth.
 */
export function claudeSpawnEnv(): Record<string, string | undefined> {
  const override = claudeGatewayEnv();
  const base: Record<string, string | undefined> = {
    ...process.env,
    ...loadLocalClaudeEnv(),
    ...clientAppEnv(),
  };
  if (Object.keys(override).length > 0) {
    for (const key of Object.keys(base)) {
      if (key.startsWith("ANTHROPIC_")) delete base[key];
    }
  }
  return { ...base, ...override };
}

/**
 * Claude Code loads ~/.claude/settings.json when the `user` source is enabled.
 * Gateway/default upstream requests must not inherit that file because it may
 * contain local auth/model overrides that route requests away from the app's
 * selected upstream.
 */
export function claudeSettingSources(): string[] {
  return hasClaudeUpstreamOverride() ? [...GATEWAY_SETTING_SOURCES] : [...DEFAULT_SETTING_SOURCES];
}

/**
 * Resolved model for the effective upstream. Gateway and DPCC can serve their
 * own model namespace, so once an upstream override is active, stale in-app
 * picker values must not leak into SDK requests. An empty upstream model means
 * "let that upstream choose its default", not "reuse the local picker".
 */
export function claudeGatewayModel(): string | undefined {
  const u = resolveClaudeUpstream();
  return u.model || undefined;
}

export function claudeResolvedModel(requestedModel?: string | null): string | undefined {
  if (hasClaudeUpstreamOverride()) {
    return resolveClaudeUpstream().model || undefined;
  }
  return requestedModel?.trim() || undefined;
}
