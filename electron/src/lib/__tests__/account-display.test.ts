import { describe, expect, it } from "vitest";
import {
  formatAccountUsd,
  resolveAccountSubscription,
} from "@shared/lib/account-display";

describe("account display helpers", () => {
  it("keeps currency formatting consistent across renderer and native menus", () => {
    expect(formatAccountUsd(37)).toBe("$37.00");
    expect(formatAccountUsd(735)).toBe("$735");
  });

  it("prefers fetched subscription data and falls back to authorization summary state", () => {
    const fetched = { state: "active", expiresAt: 123, items: [] };
    const account = { displayName: "User", subscriptionState: "expired" };

    expect(resolveAccountSubscription(fetched, account)).toBe(fetched);
    expect(resolveAccountSubscription(null, account)).toEqual({
      state: "expired",
      expiresAt: null,
      items: [],
    });
  });
});
