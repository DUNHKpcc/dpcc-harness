/**
 * Shared Claude gateway resolution.
 *
 * Every code path that spawns Claude — interactive sessions, the WeChat bridge
 * adapter, and one-shot utility queries (chat-title + commit-message generation)
 * — must authenticate against the same gateway. When they don't, requests hit a
 * bare endpoint and the gateway replies "not login" (B4: WeChat sends fail;
 * B5b: built-in title generation returns "not login" as the title).
 *
 * If the user already configured the gateway in their own ~/.claude/settings.json,
 * the local config wins and PccAgent injects nothing — letting
 * `settingSources: ["user", ...]` apply the local values.
 */

import { log } from "./logger";
import { getAppSetting } from "./app-settings";
import { localClaudeGatewayTakesPriority, probeLocalClaudeGateway } from "./local-cli-config";

/**
 * Env vars for the custom Claude gateway (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN).
 * Returns `{}` when the gateway is disabled or the local config already sets these.
 */
export function claudeGatewayEnv(): Record<string, string> {
  if (localClaudeGatewayTakesPriority()) {
    log("CLAUDE_GATEWAY_DEFER", "local ~/.claude/settings.json env overrides PccAgent gateway");
    return {};
  }
  const g = getAppSetting("claudeGateway");
  if (!g?.enabled) return {};
  const env: Record<string, string> = {};
  if (g.baseUrl.trim()) env.ANTHROPIC_BASE_URL = g.baseUrl.trim();
  if (g.authToken.trim()) env.ANTHROPIC_AUTH_TOKEN = g.authToken.trim();
  return env;
}

/**
 * Custom model id from the Claude gateway, used as the session default when enabled.
 * Returns undefined when the gateway is off or the user's local settings.json sets
 * ANTHROPIC_MODEL (which then wins).
 */
export function claudeGatewayModel(): string | undefined {
  if (probeLocalClaudeGateway().hasModel) return undefined;
  const g = getAppSetting("claudeGateway");
  return g?.enabled && g.model.trim() ? g.model.trim() : undefined;
}
