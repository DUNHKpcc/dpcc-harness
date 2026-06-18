import { describe, expect, it } from "vitest";
import type { AccountConfig } from "@shared/types/account";
import { shouldLoadAccountDetails, shouldLoadAccountModels } from "./useAccount";

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
});
