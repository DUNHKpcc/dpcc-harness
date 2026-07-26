import { afterEach, describe, expect, it, vi } from "vitest";
import { accountCacheKey, computeDesktopBalance, fetchDesktopUsage } from "../account";

const account = {
  host: "https://api.example.test",
  claudeToken: "sk-claude-secret",
  codexToken: "sk-codex-secret",
  accessToken: "access-secret",
  userId: "42",
};

describe("account cache identity", () => {
  it("is stable without exposing credentials", () => {
    const key = accountCacheKey(account);

    expect(key).toBe(accountCacheKey({ ...account }));
    expect(key).toMatch(/^[a-f0-9]{24}$/);
    expect(key).not.toContain(account.claudeToken);
    expect(key).not.toContain(account.userId);
  });

  it("changes when account credentials change", () => {
    const key = accountCacheKey(account);

    expect(accountCacheKey({ ...account, claudeToken: "sk-another" })).not.toBe(key);
    expect(accountCacheKey({ ...account, userId: "43" })).not.toBe(key);
  });
});

describe("desktop usage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the v2 server summary without downloading raw logs", async () => {
    const nowDay = Math.floor(Date.now() / 86_400_000) * 86_400;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contract_version: 2,
        totals: {
          request_count: 3,
          prompt_tokens: 7,
          completion_tokens: 10,
          cache_tokens: 11,
          cache_creation_tokens: 13,
        },
        by_day: [
          {
            day_start: nowDay - 86_400,
            request_count: 1,
            prompt_tokens: 2,
            completion_tokens: 3,
            cache_tokens: 5,
            cache_creation_tokens: 7,
          },
          {
            day_start: nowDay,
            request_count: 2,
            prompt_tokens: 5,
            completion_tokens: 7,
            cache_tokens: 6,
            cache_creation_tokens: 6,
          },
        ],
        by_model: [],
        longest_task_seconds: 120,
        truncated: false,
        days_truncated: false,
        models_truncated: false,
        legacy_cache_truncated: false,
        activity_truncated: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDesktopUsage("https://api.example.test", "sk-desktop");

    expect(result).toMatchObject({
      totalTokens: 41,
      peakDayTokens: 24,
      longestTaskSec: 120,
      currentStreak: 2,
      longestStreak: 2,
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/desktop/usage/summary",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-desktop",
        }),
      }),
    );
  });

  it("falls back to paginated usage when origin has no summary endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })
      .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        page: 1,
        page_size: 100,
        total: 3,
        items: [
          {
            created_at: 1_700_000_000,
            type: 2,
            prompt_tokens: 2,
            completion_tokens: 3,
            cache_tokens: 11,
            cache_creation_tokens: 13,
          },
          {
            created_at: 1_700_000_120,
            type: 2,
            prompt_tokens: 5,
            completion_tokens: 7,
            other: JSON.stringify({ cache_write_tokens: 17 }),
          },
          {
            created_at: 1_700_000_240,
            type: 7,
            prompt_tokens: 100,
            completion_tokens: 100,
          },
        ],
      }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDesktopUsage("https://api.example.test", "sk-desktop");

    expect(result).toMatchObject({
      totalTokens: 58,
      peakDayTokens: 58,
      longestTaskSec: 120,
      currentStreak: 0,
      longestStreak: 1,
      truncated: false,
    });
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.days).toHaveLength(1);
      expect(result.days[0]).toMatchObject({ tokens: 58, count: 2 });
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/desktop/usage?page=1&page_size=100",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-desktop",
        }),
      }),
    );
  });

  it("does not hide a rejected desktop token behind the legacy fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }));

    await expect(
      fetchDesktopUsage("https://api.example.test", "sk-desktop"),
    ).resolves.toEqual({ error: "401 Unauthorized" });
  });

  it("does not fan out legacy page requests after a summary server error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDesktopUsage("https://api.example.test", "sk-desktop"),
    ).resolves.toEqual({ error: "500 Internal Server Error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("desktop balance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves both used and remaining quota from the desktop account contract", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quota: 400_000, used_quota: 100_000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { quota_per_unit: 500_000 } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      computeDesktopBalance("https://api.example.test", "sk-desktop"),
    ).resolves.toEqual({
      totalUsd: 1,
      usedUsd: 0.2,
      remainingUsd: 0.8,
      unlimited: false,
    });
  });
});
