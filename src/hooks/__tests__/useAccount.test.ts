import { describe, expect, it } from "vitest";
import type { AccountBalance, AccountConfig, AccountSubscription } from "@shared/types/account";
import type { AccountAuthStatus } from "@shared/types/account-auth";
import {
  ACCOUNT_BALANCE_CACHE_KEY,
  readCachedAccountBalance,
  resolveBalanceResult,
  resolveCachedBalanceForAccount,
  resolveSubscriptionResult,
  shouldClearAccountDetails,
  shouldLoadAccountDetails,
  shouldLoadAccountModels,
  shouldShowAccountDetails,
  writeCachedAccountBalance,
} from "../useAccount";

const baseConfig: AccountConfig = {
  baseUrl: "https://api.example.test",
  cacheKey: "account-a",
  hasToken: false,
  hasClaudeToken: false,
  hasCodexToken: false,
  hasAccessToken: false,
  source: "none",
};

describe("useAccount helpers", () => {
  it.each<AccountAuthStatus>(["signed_out", "revoked", "expired", "guest"])(
    "clears account details when authorization becomes %s",
    (status) => {
      expect(shouldClearAccountDetails(status)).toBe(true);
    },
  );

  it.each<AccountAuthStatus>(["authorizing", "connected", "expiring", "storage_error"])(
    "keeps account details while authorization is %s",
    (status) => {
      expect(shouldClearAccountDetails(status)).toBe(false);
    },
  );

  it("allows balance loading with only access-token credentials", () => {
    expect(
      shouldLoadAccountDetails({
        ...baseConfig,
        hasAccessToken: true,
      }),
    ).toBe(true);
  });

  it("loads model lists only when a gateway token is configured", () => {
    expect(shouldLoadAccountModels({ ...baseConfig, hasAccessToken: true })).toBe(false);
    expect(shouldLoadAccountModels({ ...baseConfig, hasToken: true })).toBe(true);
  });

  it("keeps the previous balance when a refresh cannot load a new one", () => {
    const previous: AccountBalance = {
      unlimited: false,
      usedUsd: 4,
      totalUsd: 10,
      remainingUsd: 6,
    };

    expect(resolveBalanceResult(previous, { error: "temporary failure" })).toEqual({
      balance: previous,
      error: "temporary failure",
    });
  });

  it("keeps the previous subscription when an upstream refresh fails", () => {
    const previous: AccountSubscription = {
      state: "active",
      expiresAt: 1_800_000_000_000,
      items: [],
    };

    expect(resolveSubscriptionResult(previous, { error: "temporary failure" })).toEqual({
      subscription: previous,
      error: "temporary failure",
    });
    expect(resolveSubscriptionResult(previous, {
      state: "none",
      expiresAt: null,
      items: [],
    })).toEqual({
      subscription: {
        state: "none",
        expiresAt: null,
        items: [],
      },
      error: null,
    });
  });

  it("restores the last valid balance before account config finishes loading", () => {
    const previous: AccountBalance = {
      unlimited: false,
      usedUsd: 4,
      totalUsd: 10,
      remainingUsd: 6,
    };
    const values = new Map<string, string>([
      [ACCOUNT_BALANCE_CACHE_KEY, JSON.stringify({ accountKey: "account-a", balance: previous })],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    const restored = readCachedAccountBalance(storage);

    expect(restored).toEqual({ accountKey: "account-a", balance: previous });
    expect(shouldShowAccountDetails(null, restored?.balance ?? null)).toBe(true);
    expect(resolveCachedBalanceForAccount(restored, "account-a")).toEqual(previous);
    expect(resolveCachedBalanceForAccount(restored, "account-b")).toBeNull();
  });

  it("persists successful balances and clears stale cache when credentials are removed", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const balance: AccountBalance = {
      unlimited: true,
      usedUsd: 2,
      totalUsd: 0,
      remainingUsd: 0,
    };

    writeCachedAccountBalance(storage, { accountKey: "account-a", balance });
    expect(readCachedAccountBalance(storage)).toEqual({ accountKey: "account-a", balance });

    writeCachedAccountBalance(storage, null);
    expect(values.has(ACCOUNT_BALANCE_CACHE_KEY)).toBe(false);
  });

  it("ignores malformed or unsafe persisted balances", () => {
    const storage = {
      getItem: () => JSON.stringify({
        accountKey: "account-a",
        balance: { unlimited: false, usedUsd: -1, totalUsd: 10, remainingUsd: 11 },
      }),
      setItem: () => {},
      removeItem: () => {},
    };

    expect(readCachedAccountBalance(storage)).toBeNull();
    expect(readCachedAccountBalance({
      ...storage,
      getItem: () => "{broken",
    })).toBeNull();
    expect(readCachedAccountBalance({
      ...storage,
      getItem: () => {
        throw new Error("storage disabled");
      },
    })).toBeNull();
  });
});
