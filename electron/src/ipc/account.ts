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
import {
  credentialTokenForEngine,
  loadAccountCredential,
} from "../lib/account-credential-store";
import { getDataDir } from "../lib/data-dir";
import { extractErrorMessage } from "../lib/error-utils";
import { fetchUpstreamModels } from "../lib/upstream-models";
import type {
  AccountConfig,
  AccountBalance,
  AccountBalanceResult,
  AccountModelsResult,
  AccountOverview,
  AccountStatus,
  AccountSubscriptionResult,
  UsageStats,
  UsageStatsResult,
  UsageDayBucket,
} from "@shared/types/account";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";
import { markTokenRejected } from "./account-auth";

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
  desktopToken: string;
  credentialSource: "desktop" | "legacy_manual" | "none";
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
  const credential = getAppSetting("accountMode") === "guest"
    ? null
    : loadAccountCredential();
  const claudeToken = credentialTokenForEngine(credential, "claude");
  const codexToken = credentialTokenForEngine(credential, "codex");
  const host = credential?.source === "desktop"
    ? pickHost(DEFAULT_NEWAPI_BASE_URL)
    : pickHost(dpcc.baseUrl ?? "");
  const legacy = credential?.source === "legacy_manual" ? credential.legacy : undefined;

  const source: AccountConfig["source"] = claudeToken || codexToken ? "dpcc" : "none";

  return {
    host,
    claudeToken,
    codexToken,
    primaryToken: claudeToken || codexToken,
    accessToken: legacy?.accountAccessToken ?? "",
    userId: legacy?.accountUserId ?? "",
    desktopToken: credential?.source === "desktop" ? claudeToken || codexToken : "",
    credentialSource: credential?.source ?? "none",
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
      redirect: "error",
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

function accountRecordFromResponse(response: Record<string, unknown>): Record<string, unknown> {
  return response.data && typeof response.data === "object"
    ? response.data as Record<string, unknown>
    : response;
}

function parseDesktopSubscription(
  data: Record<string, unknown>,
): AccountSubscriptionResult {
  const rawSubscription = data.subscription;
  const subscription = rawSubscription && typeof rawSubscription === "object"
    ? rawSubscription as Record<string, unknown>
    : null;
  const stateValue = subscription?.state ?? data.subscription_state;
  const state = typeof stateValue === "string" ? stateValue.trim() : "";
  if (!state) return { error: "invalid_subscription_response" };
  const expiresAtValue = subscription?.expires_at;
  const expiresAtSeconds =
    typeof expiresAtValue === "number" && Number.isFinite(expiresAtValue) && expiresAtValue > 0
      ? expiresAtValue
      : null;
  return {
    state,
    expiresAt: expiresAtSeconds === null ? null : expiresAtSeconds * 1_000,
    items: [],
  };
}

interface RawSubscription {
  id?: number;
  plan_id?: number;
  status?: string;
  end_time?: number;
  amount_total?: number;
  amount_used?: number;
}

interface RawSubscriptionPlan {
  id?: number;
  title?: string;
}

interface RawDesktopSubscription extends RawSubscription {
  plan_title?: string;
}

export function buildAccountSubscription(
  records: Array<{ subscription?: RawSubscription }>,
  planRecords: Array<{ plan?: RawSubscriptionPlan }>,
  quotaPerUnit: number,
  now = Date.now(),
): AccountSubscriptionResult {
  if (!Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
    return { error: "invalid_quota_unit" };
  }
  const planNames = new Map<number, string>();
  for (const record of planRecords) {
    const id = record.plan?.id;
    const title = record.plan?.title?.trim();
    if (typeof id === "number" && Number.isFinite(id) && title) {
      planNames.set(id, title);
    }
  }

  const items = records.flatMap(({ subscription }) => {
    if (!subscription || subscription.status !== "active") return [];
    const id = subscription.id;
    const planId = subscription.plan_id;
    const endTime = subscription.end_time;
    const totalQuota = subscription.amount_total;
    const usedQuota = subscription.amount_used;
    if (
      typeof id !== "number"
      || !Number.isFinite(id)
      || typeof planId !== "number"
      || !Number.isFinite(planId)
      || typeof totalQuota !== "number"
      || !Number.isFinite(totalQuota)
      || typeof usedQuota !== "number"
      || !Number.isFinite(usedQuota)
    ) {
      return [];
    }
    const expiresAt =
      typeof endTime === "number" && Number.isFinite(endTime) && endTime > 0
        ? endTime * 1_000
        : null;
    if (expiresAt !== null && expiresAt <= now) return [];

    const safeTotal = Math.max(0, totalQuota);
    const safeUsed = Math.max(0, usedQuota);
    const unlimited = safeTotal === 0;
    return [{
      id,
      planId,
      name: planNames.get(planId) ?? "",
      totalUsd: safeTotal / quotaPerUnit,
      usedUsd: safeUsed / quotaPerUnit,
      remainingUsd: unlimited ? 0 : Math.max(0, safeTotal - safeUsed) / quotaPerUnit,
      unlimited,
      expiresAt,
    }];
  }).sort((left, right) => {
    if (left.expiresAt === null) return 1;
    if (right.expiresAt === null) return -1;
    return left.expiresAt - right.expiresAt;
  });

  return {
    state: items.length > 0 ? "active" : "none",
    expiresAt: items[0]?.expiresAt ?? null,
    items,
  };
}

function buildDesktopAccountSubscription(
  subscriptions: RawDesktopSubscription[],
  quotaPerUnit: number,
): AccountSubscriptionResult {
  return buildAccountSubscription(
    subscriptions.map((subscription) => ({ subscription })),
    subscriptions.map((subscription) => ({
      plan: {
        id: subscription.plan_id,
        title: subscription.plan_title,
      },
    })),
    quotaPerUnit,
  );
}

async function fetchAccountSubscription(
  root: string,
  token: string,
  extraHeaders?: Record<string, string>,
): Promise<{
  subscription: AccountSubscriptionResult;
  quotaPerUnit: number;
}> {
  const [status, subscriptions, plans] = await Promise.all([
    fetchStatus(root),
    upstreamGet<{
      data?: { subscriptions?: Array<{ subscription?: RawSubscription }> };
    }>(root, token, "/api/subscription/self", extraHeaders),
    upstreamGet<{
      data?: Array<{ plan?: RawSubscriptionPlan }>;
    }>(root, token, "/api/subscription/plans", extraHeaders),
  ]);
  if ("error" in subscriptions) {
    return {
      subscription: { error: subscriptions.error },
      quotaPerUnit: status.quotaPerUnit,
    };
  }
  if (!Array.isArray(subscriptions.data?.subscriptions)) {
    return {
      subscription: { error: "invalid_subscription_response" },
      quotaPerUnit: status.quotaPerUnit,
    };
  }
  const planRecords = !("error" in plans) && Array.isArray(plans.data)
    ? plans.data
    : [];
  return {
    subscription: buildAccountSubscription(
      subscriptions.data.subscriptions,
      planRecords,
      status.quotaPerUnit,
    ),
    quotaPerUnit: status.quotaPerUnit,
  };
}

/** Account projection exposed specifically to an active DesktopGrant token. */
export async function computeDesktopAccountOverview(
  root: string,
  token: string,
  loadSubscriptionDetails = true,
): Promise<AccountOverview> {
  const account = await upstreamGet<Record<string, unknown>>(
    root,
    token,
    "/api/desktop/account",
  );
  if ("error" in account && typeof account.error === "string") {
    const error = { error: account.error };
    return { balance: error, subscription: error };
  }
  const data = accountRecordFromResponse(account as Record<string, unknown>);
  const fallbackSubscription = parseDesktopSubscription(data);
  const [status, detailed] = await Promise.all([
    fetchStatus(root),
    loadSubscriptionDetails
      ? upstreamGet<{ subscriptions?: RawDesktopSubscription[] }>(
          root,
          token,
          "/api/desktop/subscriptions",
        )
      : Promise.resolve(null),
  ]);
  const subscription =
    detailed
    && !("error" in detailed)
    && Array.isArray(detailed.subscriptions)
      ? buildDesktopAccountSubscription(
          detailed.subscriptions,
          status.quotaPerUnit,
        )
      : fallbackSubscription;
  const remainingQuota = [
    data.available_quota,
    data.remaining_quota,
    data.quota,
  ].find((value): value is number => typeof value === "number" && Number.isFinite(value));
  const usedQuota = typeof data.used_quota === "number" && Number.isFinite(data.used_quota)
    ? data.used_quota
    : 0;
  if (remainingQuota === undefined) {
    return {
      balance: { error: "invalid_account_response" },
      subscription,
    };
  }

  const unit = status.quotaPerUnit;
  const remainingUsd = Math.max(0, remainingQuota / unit);
  const usedUsd = Math.max(0, usedQuota / unit);
  return {
    balance: {
      totalUsd: remainingUsd + usedUsd,
      usedUsd,
      remainingUsd,
      unlimited: false,
    },
    subscription,
  };
}

export async function computeDesktopBalance(
  root: string,
  token: string,
): Promise<AccountBalanceResult> {
  return (await computeDesktopAccountOverview(root, token, false)).balance;
}

/** List model ids available to a given token group via /v1/models. */
async function fetchModels(root: string, token: string) {
  return fetchUpstreamModels(root, token);
}

// ── Usage statistics (Token activity) ──

const LOG_PAGE_SIZE = 100; // new-api caps page_size at 100 server-side
const LOG_MAX_PAGES = 300; // ≤ ~30k entries (safety cap for very large accounts)
/** Requests ≤ this many seconds apart are merged into one "task". */
const TASK_GAP_SEC = 30 * 60;

interface RawLogItem {
  created_at?: number;
  type?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_tokens?: number;
  cache_creation_tokens?: number;
  /** JSON string carrying cache_tokens / cache_creation_tokens (Claude). */
  other?: string;
}

interface RawUsageAggregate {
  request_count?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_tokens?: number;
  cache_creation_tokens?: number;
}

interface RawUsageDay extends RawUsageAggregate {
  day_start?: number;
}

/** Total tokens for one log entry: input + output + cache read + cache creation. */
function tokensOf(item: RawLogItem): number {
  const prompt = typeof item.prompt_tokens === "number" ? item.prompt_tokens : 0;
  const completion = typeof item.completion_tokens === "number" ? item.completion_tokens : 0;
  let cacheRead = typeof item.cache_tokens === "number" ? item.cache_tokens : 0;
  let cacheWrite =
    typeof item.cache_creation_tokens === "number" ? item.cache_creation_tokens : 0;
  if (typeof item.other === "string" && item.other) {
    try {
      const o = JSON.parse(item.other) as Record<string, unknown>;
      if (cacheRead === 0 && typeof o.cache_tokens === "number") {
        cacheRead = o.cache_tokens;
      }
      if (cacheWrite === 0 && typeof o.cache_creation_tokens === "number") {
        cacheWrite = o.cache_creation_tokens;
      }
      if (cacheWrite === 0 && typeof o.cache_write_tokens === "number") {
        cacheWrite = o.cache_write_tokens;
      }
    } catch {
      /* malformed `other` — count only prompt + completion */
    }
  }
  return prompt + completion + cacheRead + cacheWrite;
}

function aggregateTokensOf(item: RawUsageAggregate): number {
  let total = 0;
  for (const value of [
    item.prompt_tokens,
    item.completion_tokens,
    item.cache_tokens,
    item.cache_creation_tokens,
  ]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      total += value;
    }
  }
  return total;
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

function usageFromDesktopSummary(response: Record<string, unknown>): UsageStats | null {
  const data = response.data && typeof response.data === "object"
    ? response.data as Record<string, unknown>
    : response;
  if (
    data.contract_version !== 2
    || !data.totals
    || typeof data.totals !== "object"
    || !Array.isArray(data.by_day)
  ) {
    return null;
  }

  const longestTaskSec = data.longest_task_seconds;
  if (
    typeof longestTaskSec !== "number"
    || !Number.isFinite(longestTaskSec)
    || longestTaskSec < 0
  ) {
    return null;
  }

  const daysByNumber = new Map<number, UsageDayBucket>();
  for (const raw of data.by_day) {
    if (!raw || typeof raw !== "object") return null;
    const day = raw as RawUsageDay;
    if (
      typeof day.day_start !== "number"
      || !Number.isFinite(day.day_start)
      || day.day_start < 0
    ) {
      return null;
    }
    const dayNumber = Math.floor(day.day_start / 86_400);
    daysByNumber.set(dayNumber, {
      date: dayKeyFromNumber(dayNumber),
      tokens: aggregateTokensOf(day),
      count: typeof day.request_count === "number" && Number.isFinite(day.request_count)
        ? Math.max(0, day.request_count)
        : 0,
    });
  }

  const dayNumbers = [...daysByNumber.keys()].sort((a, b) => a - b);
  const days = dayNumbers.map((dayNumber) => daysByNumber.get(dayNumber)!);
  let longestStreak = dayNumbers.length > 0 ? 1 : 0;
  let run = longestStreak;
  for (let i = 1; i < dayNumbers.length; i++) {
    run = dayNumbers[i] === dayNumbers[i - 1] + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  const daySet = new Set(dayNumbers);
  const todayNumber = Math.floor(Date.now() / 86_400_000);
  let cursor = daySet.has(todayNumber) ? todayNumber : todayNumber - 1;
  let currentStreak = 0;
  while (daySet.has(cursor)) {
    currentStreak++;
    cursor--;
  }

  return {
    totalTokens: aggregateTokensOf(data.totals as RawUsageAggregate),
    peakDayTokens: days.length > 0 ? Math.max(...days.map((day) => day.tokens)) : 0,
    longestTaskSec,
    currentStreak,
    longestStreak,
    days,
    truncated: data.truncated === true
      || data.days_truncated === true
      || data.models_truncated === true
      || data.legacy_cache_truncated === true
      || data.activity_truncated === true,
  };
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
  return accountCacheKey(resolveUpstream());
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

function isRejectedDesktopToken(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("error" in result)) return false;
  const error = (result as { error?: unknown }).error;
  return typeof error === "string" && /^(401|403)\b/.test(error);
}

export async function fetchDesktopUsage(root: string, token: string): Promise<UsageStatsResult> {
  const summaryResponse = await upstreamGet<Record<string, unknown>>(
    root,
    token,
    "/api/desktop/usage/summary",
  );
  const summaryError = "error" in summaryResponse && typeof summaryResponse.error === "string"
    ? summaryResponse.error
    : null;
  if (summaryError === null) {
    const summary = usageFromDesktopSummary(summaryResponse);
    if (summary) return summary;
  } else if (/^(401|403)\b/.test(summaryError)) {
    return { error: summaryError };
  } else if (!/^(404|405)\b/.test(summaryError)) {
    return { error: summaryError };
  }

  // Compatibility with origin deployments that predate the v2 summary contract.
  const entries: { createdAt: number; tokens: number }[] = [];
  let truncated = false;

  for (let page = 1; page <= LOG_MAX_PAGES; page++) {
    const response = await upstreamGet<Record<string, unknown>>(
      root,
      token,
      `/api/desktop/usage?page=${page}&page_size=${LOG_PAGE_SIZE}`,
    );
    if ("error" in response && typeof response.error === "string") {
      if (entries.length === 0) return { error: response.error };
      truncated = true;
      break;
    }

    const responseRecord = response as Record<string, unknown>;
    const data = responseRecord.data && typeof responseRecord.data === "object"
      ? responseRecord.data as Record<string, unknown>
      : responseRecord;
    if (!Array.isArray(data.items)) {
      if (entries.length === 0) return { error: "invalid_usage_response" };
      truncated = true;
      break;
    }

    for (const rawItem of data.items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as RawLogItem;
      if (
        typeof item.created_at === "number"
        && Number.isFinite(item.created_at)
        && (item.type === undefined || item.type === 2)
      ) {
        entries.push({ createdAt: item.created_at, tokens: tokensOf(item) });
      }
    }

    const total = typeof data.total === "number" && Number.isFinite(data.total)
      ? Math.max(0, data.total)
      : null;
    if (
      data.items.length === 0
      || (total !== null && page * LOG_PAGE_SIZE >= total)
    ) {
      break;
    }
    if (page === LOG_MAX_PAGES) truncated = true;
  }

  return aggregateUsage(entries, truncated);
}

async function computeBalanceForUpstream(
  upstream: ResolvedUpstream,
): Promise<AccountBalanceResult> {
  const { host, primaryToken, accessToken, userId, desktopToken, source } = upstream;
  if (!host) return { error: "not_configured" };
  if (desktopToken) return computeDesktopBalance(host, desktopToken);

  // Preferred: the billing endpoint — only needs an sk gateway token.
  if (source !== "none" && primaryToken) {
    const billing = await computeBillingBalance(host, primaryToken);
    if (!("error" in billing) && !billing.unlimited) return billing;
    // Billing disabled or token-scoped/unlimited → try /api/user/self if configured.
    if (accessToken && userId) {
      const self = await computeSelfBalance(host, accessToken, userId);
      if (self) return self;
    }
    return billing;
  }

  if (accessToken && userId) {
    const self = await computeSelfBalance(host, accessToken, userId);
    if (self) return self;
  }
  return { error: "not_configured" };
}

async function computeAccountOverview(upstream: ResolvedUpstream): Promise<AccountOverview> {
  const { host, accessToken, userId, desktopToken } = upstream;
  if (!host) {
    const error = { error: "not_configured" };
    return { balance: error, subscription: error };
  }
  if (desktopToken) return computeDesktopAccountOverview(host, desktopToken);

  const [balance, subscription] = await Promise.all([
    computeBalanceForUpstream(upstream),
    accessToken && userId
      ? fetchAccountSubscription(
          host,
          accessToken,
          { "New-API-User": userId },
        ).then((result) => result.subscription)
      : Promise.resolve<AccountSubscriptionResult>({ error: "not_configured" }),
  ]);
  return { balance, subscription };
}

export async function getOverview(): Promise<AccountOverview> {
  const upstream = resolveUpstream();
  const overview = await computeAccountOverview(upstream);
  if (
    upstream.desktopToken
    && (
      isRejectedDesktopToken(overview.balance)
      || isRejectedDesktopToken(overview.subscription)
    )
  ) {
    markTokenRejected();
  }
  return overview;
}

export function register(): void {
  ipcMain.handle("account:config", async (): Promise<AccountConfig> => {
    const upstream = resolveUpstream();
    const { host, claudeToken, codexToken, accessToken, userId, desktopToken, source } = upstream;
    return {
      baseUrl: host,
      cacheKey: accountCacheKey(upstream),
      hasToken: claudeToken.length > 0 || codexToken.length > 0,
      hasClaudeToken: claudeToken.length > 0,
      hasCodexToken: codexToken.length > 0,
      hasAccessToken: desktopToken.length > 0 || (accessToken.length > 0 && userId.length > 0),
      source,
    };
  });

  ipcMain.handle("account:status", async (): Promise<AccountStatus> => {
    const { host } = resolveUpstream();
    if (!host) return { name: "", logoUrl: "", quotaPerUnit: QUOTA_PER_UNIT };
    return fetchStatus(host);
  });

  ipcMain.handle("account:balance", async (): Promise<AccountBalanceResult> => {
    const upstream = resolveUpstream();
    const result = await computeBalanceForUpstream(upstream);
    if (upstream.desktopToken && isRejectedDesktopToken(result)) markTokenRejected();
    return result;
  });

  ipcMain.handle("account:overview", async (): Promise<AccountOverview> => {
    return getOverview();
  });

  ipcMain.handle("account:models", async (): Promise<AccountModelsResult> => {
    const { host, claudeToken, codexToken, credentialSource } = resolveUpstream();
    if (!host || (!claudeToken && !codexToken)) return { error: "not_configured" };
    const [claude, codex] = await Promise.all([
      fetchModels(host, claudeToken),
      fetchModels(host, codexToken),
    ]);
    if (
      credentialSource === "desktop"
      && [claude.error, codex.error].some(
        (error) => typeof error === "string" && /^(401|403)\b/.test(error),
      )
    ) {
      markTokenRejected();
    }
    return { claude: claude.models, codex: codex.models };
  });

  ipcMain.handle("account:usageStatsCached", async (): Promise<UsageStats | null> => {
    const { host, accessToken, userId, desktopToken } = resolveUpstream();
    if (!host || (!desktopToken && (!accessToken || !userId))) return null;
    return readUsageCache();
  });

  ipcMain.handle("account:usageStats", async (_e, force?: boolean): Promise<UsageStatsResult> => {
    const { host, accessToken, userId, desktopToken } = resolveUpstream();
    if (!host || (!desktopToken && (!accessToken || !userId))) return { error: "not_configured" };
    if (!force) {
      const cached = readUsageCache();
      if (cached) return cached;
    }
    if (desktopToken) {
      const data = await fetchDesktopUsage(host, desktopToken);
      if (isRejectedDesktopToken(data)) markTokenRejected();
      if (!("error" in data)) writeUsageCache(data);
      return data;
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
