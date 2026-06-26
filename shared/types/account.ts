/**
 * Account / upstream (new-api) types shared between electron and renderer.
 *
 * The "account" is the user's configured upstream gateway (new-api). It reuses
 * the Claude gateway credentials (baseUrl + authToken) — the same connection
 * that drives Claude sessions also powers balance and available-model queries.
 */

/**
 * Where the account panel's credentials came from. The account panel always
 * reflects the DPCC account (dpccUpstream), independent of any custom gateway.
 * Session routing uses DPCC by default and switches only when a third-party
 * gateway is explicitly enabled. So this is binary: configured or not.
 */
export type AccountSource = "dpcc" | "none";

/** Default upstream platform — DPCC API. Used when nothing else is configured. */
export const DEFAULT_NEWAPI_BASE_URL = "https://api.dpccgaming.xyz";

/** Effective upstream connection used for account queries (no secret values). */
export interface AccountConfig {
  /** Shared host root, e.g. https://my-newapi.com (may be empty when unconfigured) */
  baseUrl: string;
  /** Whether any gateway token is available (claude or codex) */
  hasToken: boolean;
  /** Whether the Claude-group sk token is configured */
  hasClaudeToken: boolean;
  /** Whether the Codex-group sk token is configured */
  hasCodexToken: boolean;
  /** Whether a system access token (+ user id) for /api/user/self balance is configured */
  hasAccessToken: boolean;
  /** "dpcc" = DPCC account configured (a token is set), "none" = not set up */
  source: AccountSource;
}

/** Per-engine model lists (each token group exposes its own models). */
export interface AccountModels {
  claude: string[];
  codex: string[];
}

/** Balance figures (USD) parsed from new-api. */
export interface AccountBalance {
  /** Total granted quota in USD (0 when unknown or unlimited) */
  totalUsd: number;
  /** Amount already used in USD */
  usedUsd: number;
  /** Remaining = total − used, clamped at 0 (0 when unlimited) */
  remainingUsd: number;
  /** The token/account has no finite cap — show "unlimited" rather than a number */
  unlimited: boolean;
}

export type AccountBalanceResult = AccountBalance | { error: string };
export type AccountModelsResult = AccountModels | { error: string };

/** Public branding/config from new-api's /api/status (no auth required). */
export interface AccountStatus {
  /** system_name, e.g. "DPCC API" (empty when unavailable) */
  name: string;
  /** Absolute logo URL (empty when unavailable) */
  logoUrl: string;
  /** Internal quota units per $1 USD (quota_per_unit, default 500000) */
  quotaPerUnit: number;
}

// ── Usage statistics (Token activity) ──

/** Per-day aggregated usage. `date` is a local-time YYYY-MM-DD key. */
export interface UsageDayBucket {
  date: string;
  /** Total tokens that day (prompt + completion + cache read + cache creation). */
  tokens: number;
  /** Number of consumption log entries (requests) that day. */
  count: number;
}

/** Aggregated Token-activity stats derived from /api/log/self consumption logs. */
export interface UsageStats {
  /** Σ all tokens across history (input + output + cache read + cache creation). */
  totalTokens: number;
  /** Highest single-day token total. */
  peakDayTokens: number;
  /** Longest "task" span in seconds — consecutive requests ≤ 30 min apart, merged. */
  longestTaskSec: number;
  /** Consecutive active days counting back from today. */
  currentStreak: number;
  /** Longest run of consecutive active days in history. */
  longestStreak: number;
  /** Per-day buckets, ascending by date, only days with activity. */
  days: UsageDayBucket[];
  /** True when the page cap was hit and older logs were not fetched. */
  truncated: boolean;
}

export type UsageStatsResult = UsageStats | { error: string };
