import { describe, expect, it } from "vitest";
import type { AccountBalance, AccountConfig } from "@shared/types/account";
import { resolveBalanceResult, shouldLoadAccountDetails, shouldLoadAccountModels } from "../useAccount";

const baseConfig: AccountConfig = {
  baseUrl: "https://api.example.test",
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
});
