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
      },
    });

    expect(exchanged.account?.maskedEmail).toBe("d***@example.test");
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

  it("binds a one-shot random loopback path and validates state", async () => {
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

    expect((await fetch(callbackUrl)).status).toBe(400);
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
