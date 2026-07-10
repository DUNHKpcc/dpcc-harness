/**
 * Account IPC — queries the user's upstream (new-api) gateway for balance and
 * available models.
 *
 * Credentials are resolved from the DPCC default upstream settings (`dpccUpstream`
 * — host + per-engine sk tokens), the same account the welcome wizard and
 * Settings → Account configure. Balance uses the OpenAI-compatible billing
 * endpoints that new-api exposes:
 *   GET {root}/v1/dashboard/billing/subscription  → hard_limit_usd (total)
 *   GET {root}/v1/dashboard/billing/usage         → total_usage   (cents)
 *   GET {root}/v1/models                          → { data: [{ id }] }
 */

import { ipcMain } from "electron";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getAppSetting } from "../lib/app-settings";
import { getDataDir } from "../lib/data-dir";
import { extractErrorMessage } from "../lib/error-utils";
import { fetchUpstreamModels } from "../lib/upstream-models";
import type {
  AccountConfig,
  AccountBalance,
  AccountBalanceResult,
  AccountModelsResult,
  AccountStatus,
  UsageStats,
  UsageStatsResult,
  UsageDayBucket,
} from "@shared/types/account";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";

const REQUEST_TIMEOUT_MS = 8_000;

/** new-api internal quota units per $1 USD (default deployment value). */
const QUOTA_PER_UNIT = 500_000;

/** Balances at/above this (USD) are treated as "unlimited" rather than a real figure. */
const UNLIMITED_USD = 1_000_000;

interface ResolvedUpstream {
  /** Shared host root (no trailing slash or /v1). */
  host: string;
  /** Claude-group sk token (ANTHROPIC_AUTH_TOKEN). */
  claudeToken: string;
  /** Codex-group sk token (model_providers api key). */
  codexToken: string;
  /** Token used for the account-level billing fallback (claude first, else codex). */
  primaryToken: string;
  accessToken: string;
  userId: string;
  source: AccountConfig["source"];
}

/** Normalize to a host root without a trailing slash or `/v1` suffix. */
function normalizeRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** First candidate that normalizes to a non-empty host root, else the DPCC default. */
function pickHost(...candidates: string[]): string {
  for (const cand of candidates) {
    const n = normalizeRoot(cand || "");
    if (n) return n;
  }
  return normalizeRoot(DEFAULT_NEWAPI_BASE_URL);
}

/**
 * Resolve the DPCC account: the host + per-engine sk tokens from the DPCC default
 * upstream settings (`dpccUpstream`), plus the balance credentials. The account
 * panel always reflects the DPCC account itself — independent of any custom
 * third-party gateway, which is a separate, session-only override.
 */
function resolveUpstream(): ResolvedUpstream {
  const dpcc = getAppSetting("dpccUpstream");
  const claudeToken = dpcc.claudeToken.trim();
  const codexToken = dpcc.codexToken.trim();
  const host = pickHost(dpcc.baseUrl ?? "");

  const source: AccountConfig["source"] = claudeToken || codexToken ? "dpcc" : "none";

  return {
    host,
    claudeToken,
    codexToken,
    primaryToken: claudeToken || codexToken,
    accessToken: (getAppSetting("accountAccessToken") ?? "").trim(),
    userId: (getAppSetting("accountUserId") ?? "").trim(),
    source,
  };
}

export function accountCacheKey(
  upstream: Pick<ResolvedUpstream, "host" | "claudeToken" | "codexToken" | "accessToken" | "userId">,
): string {
  return createHash("sha256")
    .update([
      upstream.host,
      upstream.claudeToken,
      upstream.codexToken,
      upstream.accessToken,
      upstream.userId,
    ].join("\0"))
    .digest("hex")
    .slice(0, 24);
}

async function upstreamGet<T>(
  root: string,
  token: string,
  urlPath: string,
  extraHeaders?: Record<string, string>,
): Promise<T | { error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${root}${urlPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...extraHeaders,
      },
      signal: controller.signal,
    });
    if (!res.ok) return { error: `${res.status} ${res.statusText}` };
    return (await res.json()) as T;
  } catch (e) {
    return { error: extractErrorMessage(e) };
  } finally {
    clearTimeout(timeout);
  }
}

/** GET an unauthenticated endpoint (e.g. /api/status). */
async function upstreamGetPublic<T>(root: string, urlPath: string): Promise<T | { error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${root}${urlPath}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return { error: `${res.status} ${res.statusText}` };
    return (await res.json()) as T;
  } catch (e) {
    return { error: extractErrorMessage(e) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Read public branding/config from new-api's /api/status. Always resolves (defaults on failure). */
async function fetchStatus(root: string): Promise<AccountStatus> {
  const out: AccountStatus = { name: "", logoUrl: "", quotaPerUnit: QUOTA_PER_UNIT };
  const res = await upstreamGetPublic<{
    data?: { system_name?: string; logo?: string; quota_per_unit?: number };
  }>(root, "/api/status");
  if ("error" in res || !res.data) return out;
  if (typeof res.data.system_name === "string") out.name = res.data.system_name.trim();
  if (typeof res.data.quota_per_unit === "number" && res.data.quota_per_unit > 0) {
    out.quotaPerUnit = res.data.quota_per_unit;
  }
  const logo = typeof res.data.logo === "string" ? res.data.logo.trim() : "";
  if (logo) out.logoUrl = /^https?:\/\//i.test(logo) ? logo : `${root}${logo.startsWith("/") ? "" : "/"}${logo}`;
  return out;
}

/** Balance via the OpenAI-compatible billing endpoints (only needs the sk gateway token). */
async function computeBillingBalance(root: string, token: string): Promise<AccountBalanceResult> {
  const sub = await upstreamGet<{ hard_limit_usd?: number }>(
    root,
    token,
    "/v1/dashboard/billing/subscription",
  );
  if ("error" in sub) return { error: sub.error };
  const usage = await upstreamGet<{ total_usage?: number }>(root, token, "/v1/dashboard/billing/usage");
  const totalUsd = typeof sub.hard_limit_usd === "number" ? sub.hard_limit_usd : 0;
  const usedUsd =
    !("error" in usage) && typeof usage.total_usage === "number" ? usage.total_usage / 100 : 0;
  const unlimited = totalUsd >= UNLIMITED_USD;
  return {
    totalUsd: unlimited ? 0 : totalUsd,
    usedUsd,
    remainingUsd: unlimited ? 0 : Math.max(0, totalUsd - usedUsd),
    unlimited,
  };
}

/** Balance via /api/user/self (needs access token + `New-API-User` id). Null on failure. */
async function computeSelfBalance(
  root: string,
  accessToken: string,
  userId: string,
): Promise<AccountBalance | null> {
  const self = await upstreamGet<{ data?: { quota?: number; used_quota?: number } }>(
    root,
    accessToken,
    "/api/user/self",
    { "New-API-User": userId },
  );
  if ("error" in self || !self.data) return null;
  const unit = (await fetchStatus(root)).quotaPerUnit;
  const remainingUsd = (self.data.quota ?? 0) / unit;
  const usedUsd = (self.data.used_quota ?? 0) / unit;
  const unlimited = remainingUsd >= UNLIMITED_USD;
  return {
    totalUsd: unlimited ? 0 : remainingUsd + usedUsd,
    usedUsd,
    remainingUsd: unlimited ? 0 : Math.max(0, remainingUsd),
    unlimited,
  };
}

/** List model ids available to a given token group via /v1/models. Empty on failure. */
async function fetchModels(root: string, token: string): Promise<string[]> {
  return (await fetchUpstreamModels(root, token)).models;
}

// ── Usage statistics (Token activity) ──

const LOG_PAGE_SIZE = 100; // new-api caps page_size at 100 server-side
const LOG_MAX_PAGES = 300; // ≤ ~30k entries (safety cap for very large accounts)
/** Requests ≤ this many seconds apart are merged into one "task". */
const TASK_GAP_SEC = 30 * 60;

interface RawLogItem {
  created_at?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  /** JSON string carrying cache_tokens / cache_creation_tokens (Claude). */
  other?: string;
}

/** Total tokens for one log entry: input + output + cache read + cache creation. */
function tokensOf(item: RawLogItem): number {
  const prompt = typeof item.prompt_tokens === "number" ? item.prompt_tokens : 0;
  const completion = typeof item.completion_tokens === "number" ? item.completion_tokens : 0;
  let cache = 0;
  if (typeof item.other === "string" && item.other) {
    try {
      const o = JSON.parse(item.other) as Record<string, unknown>;
      const read = typeof o.cache_tokens === "number" ? o.cache_tokens : 0;
      const write = typeof o.cache_creation_tokens === "number" ? o.cache_creation_tokens : 0;
      cache = read + write;
    } catch {
      /* malformed `other` — count only prompt + completion */
    }
  }
  return prompt + completion + cache;
}

/** Local-calendar day index (days since epoch) — used for streak adjacency + day keys. */
function localDayNumber(unixSec: number): number {
  const d = new Date(unixSec * 1000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

function dayKeyFromNumber(n: number): string {
  const d = new Date(n * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aggregate raw consumption entries into the UsageStats summary. Pure. */
function aggregateUsage(
  entries: { createdAt: number; tokens: number }[],
  truncated: boolean,
): UsageStats {
  if (entries.length === 0) {
    return {
      totalTokens: 0,
      peakDayTokens: 0,
      longestTaskSec: 0,
      currentStreak: 0,
      longestStreak: 0,
      days: [],
      truncated,
    };
  }

  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const byDay = new Map<number, { tokens: number; count: number }>();
  let totalTokens = 0;
  let longestTaskSec = 0;
  let sessionStart = sorted[0].createdAt;
  let prev = sorted[0].createdAt;

  for (const e of sorted) {
    totalTokens += e.tokens;
    const dn = localDayNumber(e.createdAt);
    const bucket = byDay.get(dn) ?? { tokens: 0, count: 0 };
    bucket.tokens += e.tokens;
    bucket.count += 1;
    byDay.set(dn, bucket);

    if (e.createdAt - prev > TASK_GAP_SEC) sessionStart = e.createdAt;
    longestTaskSec = Math.max(longestTaskSec, e.createdAt - sessionStart);
    prev = e.createdAt;
  }

  const dayNums = [...byDay.keys()].sort((a, b) => a - b);
  const days: UsageDayBucket[] = dayNums.map((dn) => {
    const b = byDay.get(dn)!;
    return { date: dayKeyFromNumber(dn), tokens: b.tokens, count: b.count };
  });
  const peakDayTokens = Math.max(...dayNums.map((dn) => byDay.get(dn)!.tokens));

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < dayNums.length; i++) {
    run = dayNums[i] === dayNums[i - 1] + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  const daySet = new Set(dayNums);
  const todayNum = localDayNumber(Math.floor(Date.now() / 1000));
  let cursor = daySet.has(todayNum) ? todayNum : todayNum - 1;
  let currentStreak = 0;
  while (daySet.has(cursor)) {
    currentStreak++;
    cursor--;
  }

  return { totalTokens, peakDayTokens, longestTaskSec, currentStreak, longestStreak, days, truncated };
}

/** Disk-persisted usage cache so stats survive restarts and only refetch on refresh. */
interface UsageCacheFile {
  /** host|userId — invalidates the cache when the account credentials change. */
  key: string;
  at: number;
  data: UsageStats;
}

function usageCachePath(): string {
  return path.join(getDataDir(), "usage-stats-cache.json");
}

function usageCacheKey(): string {
  const { host, userId } = resolveUpstream();
  return `${host}|${userId}`;
}

function readUsageCache(): UsageStats | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageCachePath(), "utf-8")) as UsageCacheFile;
    if (parsed.key === usageCacheKey() && parsed.data) return parsed.data;
  } catch {
    /* no cache yet or unreadable — treat as miss */
  }
  return null;
}

function writeUsageCache(data: UsageStats): void {
  try {
    const payload: UsageCacheFile = { key: usageCacheKey(), at: Date.now(), data };
    fs.writeFileSync(usageCachePath(), JSON.stringify(payload), "utf-8");
  } catch {
    /* cache write is best-effort */
  }
}

export function register(): void {
  ipcMain.handle("account:config", async (): Promise<AccountConfig> => {
    const upstream = resolveUpstream();
    const { host, claudeToken, codexToken, accessToken, userId, source } = upstream;
    return {
      baseUrl: host,
      cacheKey: accountCacheKey(upstream),
      hasToken: claudeToken.length > 0 || codexToken.length > 0,
      hasClaudeToken: claudeToken.length > 0,
      hasCodexToken: codexToken.length > 0,
      hasAccessToken: accessToken.length > 0 && userId.length > 0,
      source,
    };
  });

  ipcMain.handle("account:status", async (): Promise<AccountStatus> => {
    const { host } = resolveUpstream();
    if (!host) return { name: "", logoUrl: "", quotaPerUnit: QUOTA_PER_UNIT };
    return fetchStatus(host);
  });

  ipcMain.handle("account:balance", async (): Promise<AccountBalanceResult> => {
    const { host, primaryToken, accessToken, userId, source } = resolveUpstream();
    if (!host) return { error: "not_configured" };

    // Preferred: the billing endpoint — only needs an sk gateway token.
    if (source !== "none" && primaryToken) {
      const billing = await computeBillingBalance(host, primaryToken);
      if (!("error" in billing) && !billing.unlimited) return billing;
      // Billing disabled or token-scoped/unlimited → try /api/user/self if configured.
      if (accessToken && userId) {
        const self = await computeSelfBalance(host, accessToken, userId);
        if (self) return self;
      }
      return billing; // best effort (may be unlimited or an error)
    }

    // No gateway token → fall back to /api/user/self.
    if (accessToken && userId) {
      const self = await computeSelfBalance(host, accessToken, userId);
      if (self) return self;
    }
    return { error: "not_configured" };
  });

  ipcMain.handle("account:models", async (): Promise<AccountModelsResult> => {
    const { host, claudeToken, codexToken } = resolveUpstream();
    if (!host || (!claudeToken && !codexToken)) return { error: "not_configured" };
    const [claude, codex] = await Promise.all([
      fetchModels(host, claudeToken),
      fetchModels(host, codexToken),
    ]);
    return { claude, codex };
  });

  ipcMain.handle("account:usageStatsCached", async (): Promise<UsageStats | null> => {
    const { host, accessToken, userId } = resolveUpstream();
    if (!host || !accessToken || !userId) return null;
    return readUsageCache();
  });

  ipcMain.handle("account:usageStats", async (_e, force?: boolean): Promise<UsageStatsResult> => {
    const { host, accessToken, userId } = resolveUpstream();
    if (!host || !accessToken || !userId) return { error: "not_configured" };
    if (!force) {
      const cached = readUsageCache();
      if (cached) return cached;
    }

    const entries: { createdAt: number; tokens: number }[] = [];
    let truncated = false;
    let total = Infinity;
    for (let p = 1; p <= LOG_MAX_PAGES; p++) {
      const res = await upstreamGet<{ data?: { items?: RawLogItem[]; total?: number } }>(
        host,
        accessToken,
        `/api/log/self?type=2&p=${p}&page_size=${LOG_PAGE_SIZE}`,
        { "New-API-User": userId },
      );
      if ("error" in res) {
        if (entries.length === 0) return { error: res.error };
        break; // partial fetch failed — aggregate what we already have
      }
      const items = res.data?.items ?? [];
      if (typeof res.data?.total === "number") total = res.data.total;
      for (const it of items) {
        if (typeof it.created_at === "number") {
          entries.push({ createdAt: it.created_at, tokens: tokensOf(it) });
        }
      }
      if (items.length === 0 || entries.length >= total) break;
      if (p === LOG_MAX_PAGES && entries.length < total) truncated = true;
    }

    const data = aggregateUsage(entries, truncated);
    writeUsageCache(data);
    return data;
  });
}
