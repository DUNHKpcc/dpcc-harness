import { describe, expect, it } from "vitest";
import { accountCacheKey } from "../account";

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
