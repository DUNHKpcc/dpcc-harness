import { useState, useCallback, useEffect } from "react";
import type {
  AccountConfig,
  AccountBalance,
  AccountBalanceResult,
  AccountModelsResult,
  AccountStatus,
  AccountSubscription,
  AccountSubscriptionResult,
} from "@shared/types/account";

export interface UseAccountResult {
  config: AccountConfig | null;
  status: AccountStatus | null;
  balance: AccountBalance | null;
  subscription: AccountSubscription | null;
  claudeModels: string[];
  codexModels: string[];
  loading: boolean;
  /** Non-null when the balance lookup failed (e.g. endpoint disabled). */
  error: string | null;
  /** Non-null when the upstream subscription lookup failed. */
  subscriptionError: string | null;
  refresh: () => Promise<void>;
}

export interface UseAccountOptions {
  /** Fetch /v1/models as part of account loading. Settings needs this; the sidebar popover does not. */
  loadModels?: boolean;
}

export const ACCOUNT_BALANCE_CACHE_KEY = "pcc-agent-account-balance-v1";

type AccountBalanceCacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface CachedAccountBalance {
  accountKey: string;
  balance: AccountBalance;
}

export function shouldLoadAccountDetails(config: AccountConfig): boolean {
  return config.hasToken || config.hasAccessToken;
}

export function shouldLoadAccountModels(config: AccountConfig): boolean {
  return config.hasToken;
}

export function shouldShowAccountDetails(
  config: AccountConfig | null,
  balance: AccountBalance | null,
): boolean {
  return config ? shouldLoadAccountDetails(config) : balance !== null;
}

function isAccountBalance(value: unknown): value is AccountBalance {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AccountBalance>;
  return typeof candidate.unlimited === "boolean"
    && [candidate.totalUsd, candidate.usedUsd, candidate.remainingUsd].every(
      (amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0,
    );
}

export function readCachedAccountBalance(
  storage: AccountBalanceCacheStorage | null,
): CachedAccountBalance | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACCOUNT_BALANCE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<CachedAccountBalance>;
    return typeof candidate.accountKey === "string"
      && candidate.accountKey.length > 0
      && isAccountBalance(candidate.balance)
      ? { accountKey: candidate.accountKey, balance: candidate.balance }
      : null;
  } catch {
    return null;
  }
}

export function writeCachedAccountBalance(
  storage: AccountBalanceCacheStorage | null,
  cached: CachedAccountBalance | null,
): void {
  if (!storage) return;
  try {
    if (cached) {
      storage.setItem(ACCOUNT_BALANCE_CACHE_KEY, JSON.stringify(cached));
    } else {
      storage.removeItem(ACCOUNT_BALANCE_CACHE_KEY);
    }
  } catch {
    // Cache persistence is best-effort and must not affect account refreshes.
  }
}

export function resolveCachedBalanceForAccount(
  cached: CachedAccountBalance | null,
  accountKey: string,
): AccountBalance | null {
  return cached?.accountKey === accountKey ? cached.balance : null;
}

function getAccountBalanceStorage(): AccountBalanceCacheStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

let cachedConfig: AccountConfig | null = null;
let cachedStatus: AccountStatus | null = null;
let cachedSubscription: AccountSubscription | null = null;
let cachedSubscriptionAccountKey = "";
const accountBalanceStorage = getAccountBalanceStorage();
let cachedBalanceSnapshot = readCachedAccountBalance(accountBalanceStorage);
let cachedBalance: AccountBalance | null = cachedBalanceSnapshot?.balance ?? null;

export function resolveBalanceResult(
  previous: AccountBalance | null,
  result: AccountBalanceResult,
): { balance: AccountBalance | null; error: string | null } {
  if ("error" in result) {
    return { balance: previous, error: result.error };
  }
  return { balance: result, error: null };
}

export function resolveSubscriptionResult(
  previous: AccountSubscription | null,
  result: AccountSubscriptionResult,
): { subscription: AccountSubscription | null; error: string | null } {
  if ("error" in result) {
    return { subscription: previous, error: result.error };
  }
  return { subscription: result, error: null };
}

/**
 * Reads the upstream (new-api) account: effective config, balance, and per-engine
 * model lists when requested. Loads lazily — only fetches while `active` is true
 * and on manual refresh. Branding (name + logo) loads on mount regardless so the
 * sidebar trigger can show the logo.
 */
export function useAccount(active: boolean, options: UseAccountOptions = {}): UseAccountResult {
  const loadModels = options.loadModels ?? true;
  const [config, setConfig] = useState<AccountConfig | null>(() => cachedConfig);
  const [status, setStatus] = useState<AccountStatus | null>(() => cachedStatus);
  const [balance, setBalance] = useState<AccountBalance | null>(() => cachedBalance);
  const [subscription, setSubscription] = useState<AccountSubscription | null>(
    () => cachedSubscription,
  );
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [codexModels, setCodexModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await window.claude.account.getStatus();
      cachedStatus = nextStatus;
      setStatus(nextStatus);
    } catch {
      // branding is best-effort; ignore failures
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSubscriptionError(null);
    void loadStatus();
    try {
      const cfg = await window.claude.account.getConfig();
      cachedConfig = cfg;
      setConfig(cfg);
      if (
        cachedSubscriptionAccountKey
        && cachedSubscriptionAccountKey !== cfg.cacheKey
      ) {
        cachedSubscription = null;
        cachedSubscriptionAccountKey = "";
        setSubscription(null);
      }
      if (cachedBalanceSnapshot && !resolveCachedBalanceForAccount(cachedBalanceSnapshot, cfg.cacheKey)) {
        cachedBalanceSnapshot = null;
        cachedBalance = null;
        writeCachedAccountBalance(accountBalanceStorage, null);
        setBalance(null);
      }
      if (!shouldLoadAccountDetails(cfg)) {
        cachedBalanceSnapshot = null;
        cachedBalance = null;
        writeCachedAccountBalance(accountBalanceStorage, null);
        setBalance(null);
        cachedSubscription = null;
        cachedSubscriptionAccountKey = "";
        setSubscription(null);
        setClaudeModels([]);
        setCodexModels([]);
        return;
      }
      const modelsPromise: Promise<AccountModelsResult | null> = loadModels && shouldLoadAccountModels(cfg)
        ? window.claude.account.getModels()
        : Promise.resolve(null);
      const [overview, mdl] = await Promise.all([
        window.claude.account.getOverview(),
        modelsPromise,
      ]);
      const resolvedBalance = resolveBalanceResult(cachedBalance, overview.balance);
      cachedBalance = resolvedBalance.balance;
      if (!resolvedBalance.error) {
        cachedBalanceSnapshot = resolvedBalance.balance
          ? { accountKey: cfg.cacheKey, balance: resolvedBalance.balance }
          : null;
        writeCachedAccountBalance(accountBalanceStorage, cachedBalanceSnapshot);
      }
      setBalance(resolvedBalance.balance);
      setError(resolvedBalance.error);
      const resolvedSubscription = resolveSubscriptionResult(
        cachedSubscription,
        overview.subscription,
      );
      cachedSubscription = resolvedSubscription.subscription;
      if (!resolvedSubscription.error) {
        cachedSubscriptionAccountKey = resolvedSubscription.subscription ? cfg.cacheKey : "";
      }
      setSubscription(resolvedSubscription.subscription);
      setSubscriptionError(resolvedSubscription.error);
      if (mdl === null) {
        setClaudeModels([]);
        setCodexModels([]);
      } else if ("error" in mdl) {
        setClaudeModels([]);
        setCodexModels([]);
      } else {
        setClaudeModels(mdl.claude);
        setCodexModels(mdl.codex);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadModels, loadStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  return {
    config,
    status,
    balance,
    subscription,
    claudeModels,
    codexModels,
    loading,
    error,
    subscriptionError,
    refresh: load,
  };
}
