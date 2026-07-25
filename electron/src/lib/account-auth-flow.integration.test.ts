import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountAuthSnapshot } from "@shared/types/account-auth";
import type { StoredAccountCredential } from "./account-credential-store";

const testState = vi.hoisted(() => ({
  credential: null as StoredAccountCredential | null,
  settings: {
    accountMode: "unset",
    claudeCliConfigSource: "default",
    codexCliConfigSource: "default",
  } as Record<string, unknown>,
}));

vi.mock("./account-credential-store", () => {
  class AccountCredentialStoreError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    ACCOUNT_CLIENT_ID: "pcc-agent-desktop",
    ACCOUNT_ISSUER: "https://resource.example.test",
    AccountCredentialStoreError,
    credentialTokenForEngine: (
      credential: StoredAccountCredential | null,
      engine: "claude" | "codex",
    ) => credential?.accessTokens?.[engine] ?? "",
    deleteAccountCredential: () => {
      const existed = testState.credential !== null;
      testState.credential = null;
      return existed;
    },
    loadOrCreateAccountDeviceId: () => "8656d280-558d-4e62-8607-3f2b2c53d4bd",
    normalizeAccountIssuer: (issuer: string) => new URL(issuer).origin,
    readAccountCredential: () => testState.credential
      ? { kind: "ok", credential: testState.credential }
      : { kind: "missing" },
    saveAccountCredential: (credential: StoredAccountCredential) => {
      testState.credential = credential;
    },
  };
});

vi.mock("./app-settings", () => ({
  getAppSetting: (key: string) => testState.settings[key],
  getAppSettings: () => testState.settings,
  setAppSettings: (patch: Record<string, unknown>) => {
    testState.settings = { ...testState.settings, ...patch };
    return testState.settings;
  },
}));

import { AccountAuthorizationCoordinator } from "./account-auth-flow";

const nativeFetch = globalThis.fetch;

interface AuthorizationRequestPayload {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  device_id: string;
  device_name: string;
  platform: string;
  app_version: string;
}

interface TokenExchangePayload {
  grant_type: string;
  client_id: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
  device_id: string;
}

describe("desktop account authorization workflow", () => {
  beforeEach(() => {
    testState.credential = null;
    testState.settings = {
      accountMode: "unset",
      claudeCliConfigSource: "default",
      codexCliConfigSource: "default",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes browser PKCE login, persists both engine keys, and revokes the device", async () => {
    let authorizationRequest: AuthorizationRequestPayload | null = null;
    let tokenExchange: TokenExchangePayload | null = null;
    let revokeAuthorization = "";
    const openedUrls: string[] = [];
    const snapshots: AccountAuthSnapshot[] = [];

    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestUrl = input instanceof Request
        ? input.url
        : input.toString();
      if (requestUrl.startsWith("http://127.0.0.1:")) {
        return nativeFetch(input, init);
      }

      if (requestUrl === "https://resource.example.test/api/desktop/oauth/authorization-requests") {
        authorizationRequest = JSON.parse(String(init?.body)) as AuthorizationRequestPayload;
        return Response.json({
          request_token: "opaque-authorization-request",
          authorization_url: "https://authorize.example.test/desktop/authorize?request=opaque-authorization-request",
          expires_in: 600,
        }, { status: 201 });
      }

      if (requestUrl === "https://resource.example.test/api/desktop/oauth/token") {
        tokenExchange = JSON.parse(String(init?.body)) as TokenExchangePayload;
        return Response.json({
          token_type: "Bearer",
          expires_in: 7_776_000,
          scope: "relay account.read usage.read",
          tokens: {
            claude: {
              access_token: "sk-regression-claude",
              group: "claude-group",
              allowed_models: ["claude-regression"],
            },
            codex: {
              access_token: "sk-regression-codex",
              group: "codex-group",
              allowed_models: ["gpt-regression"],
            },
          },
          account: {
            display_name: "Regression User",
            masked_email: "r***@example.test",
            quota: 123456,
            subscription_state: "none",
            allowed_models: ["claude-regression", "gpt-regression"],
          },
        });
      }

      if (requestUrl === "https://resource.example.test/api/desktop/oauth/revoke") {
        revokeAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const coordinator = new AccountAuthorizationCoordinator(
      {
        deviceName: "Regression MacBook",
        platform: "darwin-arm64",
        appVersion: "2.1.6",
      },
      async (authorizationUrl) => {
        openedUrls.push(authorizationUrl);
        expect(authorizationRequest).not.toBeNull();
        const callbackUrl = new URL(String(authorizationRequest?.redirect_uri));
        callbackUrl.searchParams.set("state", String(authorizationRequest?.state));
        callbackUrl.searchParams.set("code", "one-time-authorization-code");
        const callbackResponse = await nativeFetch(callbackUrl);
        expect(callbackResponse.status).toBe(200);
      },
      (snapshot) => snapshots.push(snapshot),
      "https://resource.example.test",
      "https://authorize.example.test",
    );

    expect(coordinator.continueAsGuest()).toEqual({ ok: true });
    expect(testState.settings).toMatchObject({
      accountMode: "guest",
      claudeCliConfigSource: "local",
      codexCliConfigSource: "local",
    });

    const startedAt = Date.now();
    expect(coordinator.beginAuthorization()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(coordinator.getSnapshot().status).toBe("connected");
    });

    expect(openedUrls).toEqual([
      "https://authorize.example.test/desktop/authorize?request=opaque-authorization-request",
    ]);
    expect(openedUrls[0]).not.toContain("sk-regression");
    expect(authorizationRequest).toMatchObject({
      client_id: "pcc-agent-desktop",
      code_challenge_method: "S256",
      device_id: "8656d280-558d-4e62-8607-3f2b2c53d4bd",
      device_name: "Regression MacBook",
      platform: "darwin-arm64",
      app_version: "2.1.6",
    });
    expect(String(authorizationRequest?.redirect_uri)).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback\/[A-Za-z0-9_-]+$/,
    );
    expect(String(authorizationRequest?.state)).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(tokenExchange).toMatchObject({
      grant_type: "authorization_code",
      client_id: "pcc-agent-desktop",
      code: "one-time-authorization-code",
      redirect_uri: authorizationRequest?.redirect_uri,
      device_id: "8656d280-558d-4e62-8607-3f2b2c53d4bd",
    });
    expect(
      createHash("sha256")
        .update(String(tokenExchange?.code_verifier))
        .digest("base64url"),
    ).toBe(authorizationRequest?.code_challenge);

    expect(testState.credential).toMatchObject({
      version: 2,
      issuer: "https://resource.example.test",
      clientId: "pcc-agent-desktop",
      deviceName: "Regression MacBook",
      accessTokens: {
        claude: "sk-regression-claude",
        codex: "sk-regression-codex",
      },
      tokenType: "Bearer",
      scopes: ["relay", "account.read", "usage.read"],
      source: "desktop",
      account: {
        displayName: "Regression User",
        maskedEmail: "r***@example.test",
        allowedModels: ["claude-regression", "gpt-regression"],
      },
    });
    expect(Number(testState.credential?.expiresAt)).toBeGreaterThanOrEqual(
      startedAt + 7_776_000_000,
    );
    expect(Number(testState.credential?.expiresAt)).toBeLessThanOrEqual(
      Date.now() + 7_776_000_000,
    );
    expect(testState.settings).toMatchObject({
      accountMode: "unset",
      claudeCliConfigSource: "default",
      codexCliConfigSource: "default",
    });
    expect(snapshots.some((snapshot) => snapshot.status === "authorizing")).toBe(true);
    expect(coordinator.getSnapshot()).toMatchObject({
      status: "connected",
      issuer: "https://resource.example.test",
      deviceName: "Regression MacBook",
      legacyManual: false,
    });
    expect(JSON.stringify(coordinator.getSnapshot())).not.toContain("sk-regression");

    await expect(coordinator.logoutAndRevoke()).resolves.toEqual({ ok: true });
    expect(revokeAuthorization).toBe("Bearer sk-regression-claude");
    expect(testState.credential).toBeNull();
    expect(coordinator.getSnapshot().status).toBe("signed_out");
    coordinator.dispose();
  });
});
