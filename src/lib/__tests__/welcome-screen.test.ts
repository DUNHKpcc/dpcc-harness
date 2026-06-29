import { describe, expect, it } from "vitest";
import {
  getNextContinueMessageDelay,
  shouldRefreshContinueMessage,
} from "../welcome-screen";

describe("welcome screen message refresh", () => {
  it("does not refresh when the app becomes visible again within the same hour", () => {
    const lastRefresh = new Date(2026, 2, 23, 9, 12, 0, 0);
    const resumedAt = new Date(2026, 2, 23, 9, 58, 0, 0);

    expect(shouldRefreshContinueMessage(lastRefresh, resumedAt)).toBe(false);
  });

  it("refreshes after the clock crosses into a new hour", () => {
    const lastRefresh = new Date(2026, 2, 23, 9, 59, 59, 0);
    const resumedAt = new Date(2026, 2, 23, 10, 0, 0, 0);

    expect(shouldRefreshContinueMessage(lastRefresh, resumedAt)).toBe(true);
  });

  it("schedules the next refresh for the next top of the hour", () => {
    const now = new Date(2026, 2, 23, 9, 15, 30, 250);

    expect(getNextContinueMessageDelay(now)).toBe(2_669_750);
  });
});
