/**
 * Shared Claude gateway / upstream resolution.
 *
 * Every code path that spawns Claude — interactive sessions, the WeChat bridge
 * adapter, and one-shot utility queries (chat-title + commit-message generation)
 * — must authenticate against the same upstream. When they don't, requests hit a
 * bare endpoint and the gateway replies "not login" (B4: WeChat sends fail;
 * B5b: built-in title generation returns "not login" as the title).
 *
 * Source selection is resolved in upstream-resolver from Settings → Current Config.
 * Process env wins over ~/.claude/settings.json env, so buildClaudeSpawnEnv purges
 * inherited ANTHROPIC_* before injecting the resolved upstream. This prevents a
 * stale local CLI key or base URL from overriding DPCC or gateway selections.
 */

import { loadLocalClaudeEnv } from "./local-cli-config";
import { clientAppEnv } from "./sdk";
import { resolveClaudeUpstream } from "./upstream-resolver";
import { prepareClaudeCodeGitBashEnv } from "./claude-git-bash";

const DEFAULT_SETTING_SOURCES = ["user", "project", "local"];
const GATEWAY_SETTING_SOURCES = ["project", "local"];
const MAC_APP_IDENTITY_ENV_KEYS = [
  "__CFBundleIdentifier",
  "XPC_FLAGS",
  "XPC_SERVICE_NAME",
];

function hasClaudeUpstreamOverride(): boolean {
  const u = resolveClaudeUpstream();
  return u.tier !== "local";
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

export function stripMacAppIdentityEnv<T extends Record<string, string | undefined>>(env: T): T {
  const next = { ...env };
  for (const key of MAC_APP_IDENTITY_ENV_KEYS) {
    delete next[key];
  }
  return next;
}

export async function prepareClaudeSpawnEnv(paths?: {
  userDataPath?: string;
  resourcesPath?: string;
}): Promise<Record<string, string | undefined>> {
  return prepareClaudeCodeGitBashEnv(buildClaudeSpawnEnv(), paths);
}

function buildClaudeSpawnEnv(): Record<string, string | undefined> {
  const override = claudeGatewayEnv();
  const base: Record<string, string | undefined> = {
    ...process.env,
    ...loadLocalClaudeEnv(),
    ...clientAppEnv(),
  };
  if (hasClaudeUpstreamOverride()) {
    for (const key of Object.keys(base)) {
      if (key.startsWith("ANTHROPIC_")) delete base[key];
    }
  }
  return stripMacAppIdentityEnv({ ...base, ...override });
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
