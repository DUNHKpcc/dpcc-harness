import { describe, expect, it } from "vitest";
import type { AccountBalance, AccountConfig } from "@shared/types/account";
import {
  ACCOUNT_BALANCE_CACHE_KEY,
  readCachedAccountBalance,
  resolveBalanceResult,
  resolveCachedBalanceForAccount,
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
