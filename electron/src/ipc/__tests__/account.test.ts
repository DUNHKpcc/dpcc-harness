import { afterEach, describe, expect, it, vi } from "vitest";
import { accountCacheKey, fetchDesktopUsage } from "../account";

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

  it("aggregates the paginated desktop usage contract and ignores non-consume logs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
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
          },
          {
            created_at: 1_700_000_120,
            type: 2,
            prompt_tokens: 5,
            completion_tokens: 7,
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
      totalTokens: 17,
      peakDayTokens: 17,
      longestTaskSec: 120,
      currentStreak: 0,
      longestStreak: 1,
      truncated: false,
    });
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.days).toHaveLength(1);
      expect(result.days[0]).toMatchObject({ tokens: 17, count: 2 });
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/desktop/usage?page=1&page_size=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-desktop",
        }),
      }),
    );
  });
});
