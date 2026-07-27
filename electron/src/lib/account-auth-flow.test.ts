import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AccountAuthorizationError,
  constantTimeStringEqual,
  createLoopbackReceiver,
  createPkceMaterial,
  parseTokenExchange,
  validateAuthorizationUrl,
} from "./account-auth-flow";
import { renderAccountAuthorizationPage } from "./account-auth-loopback-page";
import { ACCOUNT_ISSUER } from "./account-credential-store";
import { isAccountCredentialRejection } from "./account-auth-rejection";
import { DEFAULT_NEWAPI_AUTHORIZATION_ORIGIN } from "@shared/types/account";
import {
  DESKTOP_CONTRACT_ERROR_CODES,
  DESKTOP_CONTRACT_VERSION,
} from "@shared/types/account-auth";

describe("desktop account authorization primitives", () => {
  it("keeps the consumer error enum synchronized with the checked-in schema", () => {
    const schema = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), "shared/contracts/desktop-auth-v2.schema.json"),
      "utf8",
    )) as {
      contract_version: number;
      error_codes: string[];
    };

    expect(schema.contract_version).toBe(DESKTOP_CONTRACT_VERSION);
    expect(new Set(schema.error_codes)).toEqual(new Set(DESKTOP_CONTRACT_ERROR_CODES));
    expect(schema.error_codes).toHaveLength(DESKTOP_CONTRACT_ERROR_CODES.length);
  });

  it("generates independent high-entropy PKCE and callback material", () => {
    const first = createPkceMaterial();
    const second = createPkceMaterial();

    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier.length).toBeGreaterThanOrEqual(43);
    expect(first.verifier.length).toBeLessThanOrEqual(128);
    expect(first.callbackNonce.length).toBeGreaterThanOrEqual(43);
    expect(first.challenge).toBe(
      createHash("sha256").update(first.verifier).digest("base64url"),
    );
    expect(second.state).not.toBe(first.state);
    expect(second.verifier).not.toBe(first.verifier);
  });

  it("compares callback state exactly", () => {
    expect(constantTimeStringEqual("same-state", "same-state")).toBe(true);
    expect(constantTimeStringEqual("same-state", "same-State")).toBe(false);
    expect(constantTimeStringEqual("short", "longer")).toBe(false);
  });

  it("only accepts authorization URLs on the configured HTTPS origin", () => {
    expect(
      validateAuthorizationUrl(
        "https://api.example.test",
        "https://api.example.test/desktop/authorize?request=opaque",
        "opaque",
      ).pathname,
    ).toBe("/desktop/authorize");

    for (const candidate of [
      "https://evil.example/desktop/authorize",
      "http://api.example.test/desktop/authorize",
      "https://user:password@api.example.test/desktop/authorize",
      "https://api.example.test/desktop/authorize#secret",
      "https://api.example.test/not-the-authorization-page",
    ]) {
      expect(() => validateAuthorizationUrl("https://api.example.test", candidate, "opaque"))
        .toThrow(AccountAuthorizationError);
    }
    expect(() => validateAuthorizationUrl(
      "https://api.example.test",
      "https://api.example.test/desktop/authorize?request=wrong",
      "opaque",
    )).toThrow(AccountAuthorizationError);
    expect(() => validateAuthorizationUrl(
      "https://api.example.test",
      "https://api.example.test/desktop/authorize?request=opaque&next=evil",
      "opaque",
    )).toThrow(AccountAuthorizationError);
  });

  it("pins the official browser flow to the DPCC authorization origin", () => {
    expect(ACCOUNT_ISSUER).toBe("https://origin-api.dpccgaming.xyz");
    expect(
      validateAuthorizationUrl(
        DEFAULT_NEWAPI_AUTHORIZATION_ORIGIN,
        "https://api.dpccgaming.xyz/desktop/authorize?request=opaque",
        "opaque",
      ).origin,
    ).toBe("https://api.dpccgaming.xyz");
    expect(() => validateAuthorizationUrl(
      DEFAULT_NEWAPI_AUTHORIZATION_ORIGIN,
      "https://origin-api.dpccgaming.xyz/desktop/authorize?request=opaque",
      "opaque",
    )).toThrow(AccountAuthorizationError);
  });

  it("localizes the loopback page from the browser language preference", () => {
    const chinesePage = renderAccountAuthorizationPage({
      kind: "success",
      acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
    });
    const traditionalChinesePage = renderAccountAuthorizationPage({
      kind: "success",
      acceptLanguage: "zh-Hant-HK,zh-Hant;q=0.9,en;q=0.8",
    });
    const englishPage = renderAccountAuthorizationPage({
      kind: "success",
      acceptLanguage: "en-US,en;q=0.9,zh;q=0.8",
    });

    expect(chinesePage).toContain("<html lang=\"zh-CN\"");
    expect(chinesePage).toContain("<title>授权已接收 | PccAgent</title>");
    expect(chinesePage).toContain("本地授权交接完成");
    expect(chinesePage).toContain("现在可以安全关闭此页面。");
    expect(chinesePage).not.toContain("此授权回调已通过");
    expect(traditionalChinesePage).toContain("<html lang=\"zh-TW\"");
    expect(traditionalChinesePage).toContain("<title>已收到授權 | PccAgent</title>");
    expect(traditionalChinesePage).toContain("本機授權交接完成");
    expect(traditionalChinesePage).toContain("現在可以安全關閉此頁面。");
    expect(traditionalChinesePage).not.toContain("此授權回呼已透過");
    expect(englishPage).toContain("<html lang=\"en\"");
    expect(englishPage).toContain("<title>Authorization received | PccAgent</title>");
    expect(englishPage).not.toContain("This callback was delivered directly");
  });

  it.each([
    {
      kind: "cancelled" as const,
      expectedCaption: "Authorization cancelled",
      expectedNote: "No authorization credentials were delivered to PccAgent.",
    },
    {
      kind: "invalid-host" as const,
      expectedCaption: "Callback rejected",
      expectedNote: "PccAgent rejected this callback before completing account setup.",
    },
    {
      kind: "state-mismatch" as const,
      expectedCaption: "Security check failed",
      expectedNote: "PccAgent rejected this callback before completing account setup.",
    },
    {
      kind: "invalid-response" as const,
      expectedCaption: "Invalid callback response",
      expectedNote: "PccAgent rejected this callback before completing account setup.",
    },
  ])("keeps the $kind handoff copy consistent with its result", ({
    kind,
    expectedCaption,
    expectedNote,
  }) => {
    const page = renderAccountAuthorizationPage({ kind });

    expect(page).toContain(expectedCaption);
    expect(page).toContain(expectedNote);
    expect(page).toContain("Return to PccAgent");
    expect(page).not.toContain("Authorization response received");
    expect(page).not.toContain("Continue in PccAgent");
  });

  it("uses the Anthropic clay color for successful authorization", () => {
    const page = renderAccountAuthorizationPage({ kind: "success" });

    expect(page).toContain("<meta name=\"theme-color\" content=\"#d97757\">");
    expect(page).toContain("--accent: #d97757;");
  });

  it("embeds the project logo and honors the resolved app theme", () => {
    const logoData = fs.readFileSync(
      path.resolve(process.cwd(), "public/icon.png"),
    ).toString("base64");
    const page = renderAccountAuthorizationPage({
      kind: "success",
      theme: "dark",
    });

    expect(page).toContain("<html lang=\"en\" class=\"is-success theme-dark\">");
    expect(page.match(/data-project-logo/g)).toHaveLength(2);
    expect(page).toContain(`data:image/png;base64,${logoData}`);
    expect(page).toContain(":root.theme-dark");
    expect(page).toContain(":root:not(.theme-light)");
  });

  it("parses independent Claude and Codex keys from the token exchange", () => {
    const exchanged = parseTokenExchange({
      token_type: "Bearer",
      expires_in: 7_776_000,
      scope: "relay account.read usage.read",
      tokens: {
        claude: { access_token: "sk-claude" },
        codex: { access_token: "sk-codex" },
      },
    });

    expect(exchanged.accessTokens).toEqual({
      claude: "sk-claude",
      codex: "sk-codex",
    });
    expect(exchanged.scopes).toEqual(["relay", "account.read", "usage.read"]);
  });

  it("requires the v2 confirmation fields when activation is deferred", () => {
    const exchanged = parseTokenExchange({
      contract_version: 2,
      token_type: "Bearer",
      expires_in: 7_776_000,
      scope: "relay account.read usage.read",
      confirmation_required: true,
      confirmation_token: "one-time-confirmation",
      confirmation_expires_in: 120,
      tokens: {
        claude: { access_token: "sk-claude" },
        codex: { access_token: "sk-codex" },
      },
      account: { grant_public_id: "public-grant" },
    });

    expect(exchanged).toMatchObject({
      contractVersion: 2,
      confirmationRequired: true,
      confirmationToken: "one-time-confirmation",
      confirmationExpiresIn: 120,
      grantPublicId: "public-grant",
    });
    expect(() => parseTokenExchange({
      contract_version: 2,
      token_type: "Bearer",
      expires_in: 7_776_000,
      scope: "relay",
      confirmation_required: true,
      tokens: {
        claude: { access_token: "sk-claude" },
        codex: { access_token: "sk-codex" },
      },
    })).toThrow(AccountAuthorizationError);
  });

  it("accepts the backend email field as the masked account email", () => {
    const exchanged = parseTokenExchange({
      token_type: "Bearer",
      expires_in: 7_776_000,
      scope: "relay account.read",
      tokens: {
        claude: { access_token: "sk-claude" },
        codex: { access_token: "sk-codex" },
      },
      account: {
        display_name: "DPCC User",
        email: "d***@example.test",
        subscription: {
          state: "active",
          expires_at: 1_800_000_000,
        },
        subscription_state: "active",
      },
    });

    expect(exchanged.account?.maskedEmail).toBe("d***@example.test");
    expect(exchanged.account?.subscription).toEqual({
      state: "active",
      expiresAt: 1_800_000_000_000,
      items: [],
    });
  });

  it("keeps legacy single-key exchange responses compatible", () => {
    const exchanged = parseTokenExchange({
      token_type: "Bearer",
      access_token: "sk-legacy",
      expires_in: 7_776_000,
      scope: "relay",
    });

    expect(exchanged.accessTokens).toEqual({
      claude: "sk-legacy",
      codex: "sk-legacy",
    });
  });

  it("confirms a successful local handoff and directs the user back to PccAgent", async () => {
    const controller = new AbortController();
    const receiver = await createLoopbackReceiver(
      "callback-nonce",
      "expected-state",
      controller.signal,
    );

    const wrongPath = await fetch(new URL("/not-the-callback", receiver.redirectUri));
    expect(wrongPath.status).toBe(404);

    const callbackUrl = new URL(receiver.redirectUri);
    callbackUrl.searchParams.set("state", "expected-state");
    callbackUrl.searchParams.set("code", "one-time-code");
    const response = await fetch(callbackUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const page = await response.text();
    expect(page).toContain("<title>Authorization received | PccAgent</title>");
    expect(page).toContain("Local handoff complete");
    expect(page).toContain("PccAgent is securely completing setup.");
    expect(page).toContain("Continue in PccAgent");
    expect(page).toContain("You can safely close this tab.");
    expect(page).not.toContain("This callback was delivered directly");
    expect(page.match(/data-project-logo/g)).toHaveLength(2);
    expect(page).toContain("@media (prefers-reduced-motion: reduce)");
    await expect(receiver.callback).resolves.toEqual({ code: "one-time-code" });
    receiver.close();
  });

  it("rejects a loopback callback with a mismatched state", async () => {
    const controller = new AbortController();
    const receiver = await createLoopbackReceiver(
      "another-callback-nonce",
      "expected-state",
      controller.signal,
    );
    const callbackUrl = new URL(receiver.redirectUri);
    callbackUrl.searchParams.set("state", "attacker-state");
    callbackUrl.searchParams.set("code", "stolen-code");

    const response = await fetch(callbackUrl);
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain("Security check failed");
    expect(page).toContain("PccAgent rejected this callback before completing account setup.");
    expect(page).not.toContain("Authorization response received");
    await expect(receiver.callback).rejects.toMatchObject({
      code: "callback_state_mismatch",
    });
    receiver.close();
  });

  it("closes a loopback receiver when cancellation already happened", async () => {
    const controller = new AbortController();
    controller.abort();
    const receiver = await createLoopbackReceiver(
      "cancelled-callback-nonce",
      "expected-state",
      controller.signal,
    );

    await expect(receiver.callback).rejects.toMatchObject({
      code: "authorization_cancelled",
    });
    receiver.close();
  });

  it.each([
    "HTTP 401 Unauthorized",
    "authentication_error: invalid x-api-key",
    { message: "access token revoked" },
    new Error("invalid bearer token"),
  ])("recognizes account credential rejection errors", (value) => {
    expect(isAccountCredentialRejection(value)).toBe(true);
  });

  it.each([
    "403 model is not available for this account",
    "429 Too Many Requests",
    "request timed out",
  ])("does not revoke credentials for unrelated provider failures", (value) => {
    expect(isAccountCredentialRejection(value)).toBe(false);
  });
});
