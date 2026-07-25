import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AccountAuthActionResult,
  AccountAuthErrorCode,
  AccountAuthSnapshot,
  DesktopAccountSummary,
} from "@shared/types/account-auth";
import { DEFAULT_NEWAPI_AUTHORIZATION_ORIGIN } from "@shared/types/account";
import {
  ACCOUNT_CLIENT_ID,
  ACCOUNT_ISSUER,
  AccountCredentialStoreError,
  credentialTokenForEngine,
  deleteAccountCredential,
  loadOrCreateAccountDeviceId,
  normalizeAccountIssuer,
  readAccountCredential,
  saveAccountCredential,
  type StoredAccountCredential,
} from "./account-credential-store";
import { getAppSetting, getAppSettings, setAppSettings } from "./app-settings";

const AUTHORIZATION_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 15_000;
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

interface AuthorizationMetadata {
  deviceName: string;
  platform: string;
  appVersion: string;
}

interface ActiveAuthorization {
  controller: AbortController;
  closeLoopback: () => void;
}

interface LoopbackCallback {
  code?: string;
  error?: string;
}

export interface LoopbackReceiver {
  redirectUri: string;
  callback: Promise<LoopbackCallback>;
  close: () => void;
}

interface AuthorizationRequestResponse {
  requestToken: string;
  authorizationUrl: string;
}

interface TokenExchangeResponse {
  accessTokens: {
    claude: string;
    codex: string;
  };
  expiresIn: number;
  scopes: string[];
  account: DesktopAccountSummary | null;
}

export class AccountAuthorizationError extends Error {
  constructor(
    readonly code: AccountAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountAuthorizationError";
  }
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function createPkceMaterial(): {
  state: string;
  verifier: string;
  challenge: string;
  callbackNonce: string;
} {
  const verifier = base64Url(randomBytes(64));
  return {
    state: base64Url(randomBytes(32)),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    callbackNonce: base64Url(randomBytes(32)),
  };
}

export function constantTimeStringEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}

export function validateAuthorizationUrl(
  expectedAuthorizationOrigin: string,
  candidate: string,
): URL {
  const expectedOrigin = normalizeAccountIssuer(expectedAuthorizationOrigin);
  const parsed = new URL(candidate);
  if (
    parsed.origin !== expectedOrigin
    || parsed.protocol !== "https:"
    || parsed.pathname !== "/desktop/authorize"
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new AccountAuthorizationError(
      "authorization_url_invalid",
      "Authorization URL is not on the configured issuer",
    );
  }
  return parsed;
}

function sendLoopbackPage(
  response: http.ServerResponse,
  statusCode: number,
  title: string,
  message: string,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>`
    + "<style>body{font:16px system-ui;margin:48px;color:#202124}h1{font-size:22px}</style>"
    + `</head><body><h1>${title}</h1><p>${message}</p></body></html>`,
  );
}

export async function createLoopbackReceiver(
  callbackNonce: string,
  expectedState: string,
  signal: AbortSignal,
): Promise<LoopbackReceiver> {
  const callbackPath = `/oauth/callback/${callbackNonce}`;
  let settled = false;
  let resolveCallback!: (value: LoopbackCallback) => void;
  let rejectCallback!: (reason: unknown) => void;
  const callback = new Promise<LoopbackCallback>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  let expectedHost = "";
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || !request.url) {
      response.writeHead(405, { "Cache-Control": "no-store", Allow: "GET" });
      response.end();
      return;
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url, `http://${expectedHost}`);
    } catch {
      response.writeHead(400, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (requestUrl.pathname !== callbackPath) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (request.headers.host !== expectedHost) {
      sendLoopbackPage(response, 400, "Authorization failed", "The callback host was invalid.");
      return;
    }
    if (settled) {
      response.writeHead(410, { "Cache-Control": "no-store" });
      response.end();
      return;
    }

    settled = true;
    const states = requestUrl.searchParams.getAll("state");
    const codes = requestUrl.searchParams.getAll("code");
    const errors = requestUrl.searchParams.getAll("error");
    if (
      states.length !== 1
      || !constantTimeStringEqual(expectedState, states[0])
    ) {
      sendLoopbackPage(response, 400, "Authorization failed", "The callback state did not match.");
      rejectCallback(new AccountAuthorizationError(
        "callback_state_mismatch",
        "Authorization callback state mismatch",
      ));
      server.close();
      return;
    }
    if ((codes.length === 1) === (errors.length === 1)) {
      sendLoopbackPage(response, 400, "Authorization failed", "The callback response was invalid.");
      rejectCallback(new AccountAuthorizationError("callback_invalid", "Invalid callback response"));
      server.close();
      return;
    }

    if (errors.length === 1) {
      sendLoopbackPage(response, 200, "Authorization cancelled", "You can close this tab and return to PccAgent.");
      resolveCallback({ error: errors[0] });
    } else {
      sendLoopbackPage(response, 200, "Authorization received", "You can close this tab and return to PccAgent.");
      resolveCallback({ code: codes[0] });
    }
    server.close();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref();

  const address = server.address() as AddressInfo;
  expectedHost = `127.0.0.1:${address.port}`;
  const redirectUri = `http://${expectedHost}${callbackPath}`;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCallback(new AccountAuthorizationError("callback_timeout", "Authorization callback timed out"));
    server.close();
  }, AUTHORIZATION_TIMEOUT_MS);
  timeout.unref?.();

  const abort = () => {
    if (settled) return;
    settled = true;
    rejectCallback(new AccountAuthorizationError(
      "authorization_cancelled",
      "Authorization was cancelled",
    ));
    server.close();
  };
  signal.addEventListener("abort", abort, { once: true });

  const close = () => {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    server.close();
  };
  void callback.finally(close).catch(() => {});

  return { redirectUri, callback, close };
}

function unwrapData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : record;
}

function stringField(
  value: Record<string, unknown>,
  snakeCase: string,
  camelCase = snakeCase,
): string {
  const candidate = value[snakeCase] ?? value[camelCase];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function numberField(
  value: Record<string, unknown>,
  snakeCase: string,
  camelCase = snakeCase,
): number | undefined {
  const candidate = value[snakeCase] ?? value[camelCase];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function parseAccountSummary(value: unknown): DesktopAccountSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const displayName = stringField(record, "display_name", "displayName");
  const maskedEmail = stringField(record, "masked_email", "maskedEmail");
  const subscriptionState = stringField(record, "subscription_state", "subscriptionState");
  const allowed = record.allowed_models ?? record.allowedModels;
  const allowedModels = Array.isArray(allowed)
    ? allowed.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    displayName: displayName || maskedEmail || "DPCC API user",
    ...(maskedEmail ? { maskedEmail } : {}),
    ...(numberField(record, "quota") !== undefined ? { quota: numberField(record, "quota") } : {}),
    ...(subscriptionState ? { subscriptionState } : {}),
    ...(allowedModels ? { allowedModels } : {}),
  };
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  authorization?: string,
  requestErrorCode: AccountAuthErrorCode = "authorization_request_failed",
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-store",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed: unknown = {};
    try {
      parsed = await response.json();
    } catch {
      // Preserve the stable status-based error below.
    }
    if (!response.ok) {
      const errorCode = stringField(unwrapData(parsed), "error", "code");
      throw new AccountAuthorizationError(
        mapProtocolError(errorCode, requestErrorCode),
        `Authorization server rejected the request (${response.status})`,
      );
    }
    return unwrapData(parsed);
  } catch (error) {
    if (error instanceof AccountAuthorizationError) throw error;
    if (signal.aborted) {
      throw new AccountAuthorizationError("authorization_cancelled", "Authorization was cancelled");
    }
    throw new AccountAuthorizationError(
      requestErrorCode,
      "Authorization server request failed",
    );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

function mapProtocolError(
  error: string,
  fallback: AccountAuthErrorCode,
): AccountAuthErrorCode {
  if (error === "access_denied") return "access_denied";
  if (error === "request_expired" || error === "expired_request") return "request_expired";
  if (error === "invalid_grant" || error === "token_expired") return "token_exchange_failed";
  return fallback;
}

function parseAuthorizationRequest(value: Record<string, unknown>): AuthorizationRequestResponse {
  const requestToken = stringField(value, "request_token", "requestToken");
  const authorizationUrl = stringField(value, "authorization_url", "authorizationUrl");
  if (!requestToken || !authorizationUrl) {
    throw new AccountAuthorizationError(
      "authorization_request_failed",
      "Authorization server returned an invalid request response",
    );
  }
  return { requestToken, authorizationUrl };
}

export function parseTokenExchange(value: Record<string, unknown>): TokenExchangeResponse {
  const legacyAccessToken = stringField(value, "access_token", "accessToken");
  const tokenEnvelope =
    value.tokens && typeof value.tokens === "object"
      ? value.tokens as Record<string, unknown>
      : {};
  const tokenForEngine = (engine: "claude" | "codex"): string => {
    const engineToken = tokenEnvelope[engine];
    if (!engineToken || typeof engineToken !== "object") return legacyAccessToken;
    return stringField(
      engineToken as Record<string, unknown>,
      "access_token",
      "accessToken",
    );
  };
  const accessTokens = {
    claude: tokenForEngine("claude"),
    codex: tokenForEngine("codex"),
  };
  const tokenType = stringField(value, "token_type", "tokenType");
  const expiresIn = numberField(value, "expires_in", "expiresIn");
  const scope = stringField(value, "scope");
  if (
    !accessTokens.claude
    || !accessTokens.codex
    || tokenType.toLowerCase() !== "bearer"
    || expiresIn === undefined
    || expiresIn <= 0
  ) {
    throw new AccountAuthorizationError(
      "token_exchange_failed",
      "Authorization server returned an invalid token response",
    );
  }
  return {
    accessTokens,
    expiresIn,
    scopes: scope.split(/\s+/).filter(Boolean),
    account: parseAccountSummary(value.account),
  };
}

function statusForCredential(credential: StoredAccountCredential, now = Date.now()): AccountAuthSnapshot["status"] {
  if (credential.expiresAt !== null && credential.expiresAt <= now) return "expired";
  if (
    credential.expiresAt !== null
    && credential.expiresAt - now <= EXPIRING_WINDOW_MS
  ) {
    return "expiring";
  }
  return "connected";
}

export class AccountAuthorizationCoordinator {
  private active: ActiveAuthorization | null = null;
  private snapshot: AccountAuthSnapshot;

  constructor(
    private readonly metadata: AuthorizationMetadata,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly onSnapshot: (snapshot: AccountAuthSnapshot) => void,
    private readonly issuer = ACCOUNT_ISSUER,
    private readonly authorizationOrigin = DEFAULT_NEWAPI_AUTHORIZATION_ORIGIN,
  ) {
    this.snapshot = this.readSnapshot();
  }

  getSnapshot(): AccountAuthSnapshot {
    if (this.active) return this.snapshot;
    this.snapshot = this.readSnapshot(this.snapshot.errorCode);
    return this.snapshot;
  }

  beginAuthorization(): AccountAuthActionResult {
    if (this.active) {
      return { ok: false, errorCode: "authorization_in_progress" };
    }
    const storage = readAccountCredential(this.issuer);
    if (storage.kind === "storage_error") {
      this.publish({
        ...this.emptySnapshot(),
        status: "storage_error",
        errorCode: storage.errorCode,
      });
      return { ok: false, errorCode: storage.errorCode };
    }

    const controller = new AbortController();
    const active: ActiveAuthorization = { controller, closeLoopback: () => {} };
    this.active = active;
    this.publish({
      ...this.readSnapshot(),
      status: "authorizing",
      errorCode: undefined,
    });
    void this.runAuthorization(active);
    return { ok: true };
  }

  reauthorize(): AccountAuthActionResult {
    return this.beginAuthorization();
  }

  cancelAuthorization(): AccountAuthActionResult {
    const active = this.active;
    if (!active) return { ok: true };
    this.active = null;
    active.controller.abort();
    active.closeLoopback();
    this.publish({
      ...this.readSnapshot(),
      errorCode: "authorization_cancelled",
    });
    return { ok: true };
  }

  continueAsGuest(): AccountAuthActionResult {
    this.cancelAuthorization();
    const settings = getAppSettings();
    setAppSettings({
      accountMode: "guest",
      ...(settings.claudeCliConfigSource === "default"
        ? { claudeCliConfigSource: "local" as const }
        : {}),
      ...(settings.codexCliConfigSource === "default"
        ? { codexCliConfigSource: "local" as const }
        : {}),
    });
    this.publish({
      ...this.emptySnapshot(),
      status: "guest",
    });
    return { ok: true };
  }

  async logoutAndRevoke(): Promise<AccountAuthActionResult> {
    const read = readAccountCredential(this.issuer);
    if (read.kind === "storage_error") {
      this.publish({ ...this.emptySnapshot(), status: "storage_error", errorCode: read.errorCode });
      return { ok: false, errorCode: read.errorCode };
    }
    if (read.kind === "missing") {
      setAppSettings({ accountMode: "unset" });
      this.publish({ ...this.emptySnapshot(), status: "signed_out" });
      return { ok: true };
    }

    const controller = new AbortController();
    try {
      await postJson(
        `${normalizeAccountIssuer(this.issuer)}/api/desktop/oauth/revoke`,
        {},
        controller.signal,
        `Bearer ${
          credentialTokenForEngine(read.credential, "claude")
          || credentialTokenForEngine(read.credential, "codex")
        }`,
        "revoke_failed",
      );
    } catch {
      return { ok: false, errorCode: "revoke_failed", canClearLocally: true };
    }

    return this.clearLocalAuthorization();
  }

  clearLocalAuthorization(): AccountAuthActionResult {
    try {
      deleteAccountCredential(this.issuer);
      setAppSettings({ accountMode: "unset" });
      this.publish({ ...this.emptySnapshot(), status: "signed_out" });
      return { ok: true };
    } catch {
      return { ok: false, errorCode: "secure_storage_write_failed" };
    }
  }

  markTokenRejected(): void {
    try {
      deleteAccountCredential(this.issuer);
    } catch {
      // The rejected credential must not be used again even if cleanup fails.
    }
    this.publish({
      ...this.emptySnapshot(),
      status: "revoked",
      errorCode: "token_rejected",
    });
  }

  dispose(): void {
    const active = this.active;
    this.active = null;
    active?.controller.abort();
    active?.closeLoopback();
  }

  private async runAuthorization(active: ActiveAuthorization): Promise<void> {
    let receiver: LoopbackReceiver | null = null;
    try {
      const issuer = normalizeAccountIssuer(this.issuer);
      const deviceId = loadOrCreateAccountDeviceId();
      const pkce = createPkceMaterial();
      receiver = await createLoopbackReceiver(
        pkce.callbackNonce,
        pkce.state,
        active.controller.signal,
      );
      active.closeLoopback = receiver.close;

      const authorizationRequest = parseAuthorizationRequest(await postJson(
        `${issuer}/api/desktop/oauth/authorization-requests`,
        {
          client_id: ACCOUNT_CLIENT_ID,
          redirect_uri: receiver.redirectUri,
          state: pkce.state,
          code_challenge: pkce.challenge,
          code_challenge_method: "S256",
          device_id: deviceId,
          device_name: this.metadata.deviceName,
          platform: this.metadata.platform,
          app_version: this.metadata.appVersion,
        },
        active.controller.signal,
        undefined,
        "token_exchange_failed",
      ));
      const authorizationUrl = validateAuthorizationUrl(
        this.authorizationOrigin,
        authorizationRequest.authorizationUrl,
      );

      try {
        await this.openExternal(authorizationUrl.toString());
      } catch {
        throw new AccountAuthorizationError("browser_open_failed", "Failed to open the browser");
      }

      const callback = await receiver.callback;
      if (callback.error) {
        throw new AccountAuthorizationError(
          mapProtocolError(callback.error, "authorization_request_failed"),
          "Authorization was not approved",
        );
      }
      if (!callback.code) {
        throw new AccountAuthorizationError("callback_invalid", "Authorization code missing");
      }

      const exchanged = parseTokenExchange(await postJson(
        `${issuer}/api/desktop/oauth/token`,
        {
          grant_type: "authorization_code",
          client_id: ACCOUNT_CLIENT_ID,
          code: callback.code,
          redirect_uri: receiver.redirectUri,
          code_verifier: pkce.verifier,
          device_id: deviceId,
        },
        active.controller.signal,
      ));
      const credential: StoredAccountCredential = {
        version: 2,
        issuer,
        clientId: ACCOUNT_CLIENT_ID,
        deviceId,
        deviceName: this.metadata.deviceName,
        accessTokens: exchanged.accessTokens,
        tokenType: "Bearer",
        scopes: exchanged.scopes,
        expiresAt: Date.now() + exchanged.expiresIn * 1_000,
        account: exchanged.account,
        source: "desktop",
      };
      saveAccountCredential(credential);
      const wasGuest = getAppSetting("accountMode") === "guest";
      setAppSettings({
        accountMode: "unset",
        ...(wasGuest
          ? {
              claudeCliConfigSource: "default" as const,
              codexCliConfigSource: "default" as const,
            }
          : {}),
      });
      if (this.active === active) {
        this.publish(this.snapshotForCredential(credential));
      }
    } catch (error) {
      if (this.active !== active) return;
      const code = error instanceof AccountAuthorizationError
        ? error.code
        : error instanceof AccountCredentialStoreError
          ? error.code
          : "unknown";
      const status = code.startsWith("secure_storage_")
        ? "storage_error"
        : getAppSetting("accountMode") === "guest"
          ? "guest"
          : "signed_out";
      this.publish({ ...this.emptySnapshot(), status, errorCode: code });
    } finally {
      receiver?.close();
      if (this.active === active) this.active = null;
    }
  }

  private readSnapshot(errorCode?: AccountAuthErrorCode): AccountAuthSnapshot {
    const read = readAccountCredential(this.issuer);
    if (read.kind === "storage_error") {
      return {
        ...this.emptySnapshot(),
        status: "storage_error",
        errorCode: read.errorCode,
      };
    }
    if (read.kind === "missing") {
      return {
        ...this.emptySnapshot(),
        status: getAppSetting("accountMode") === "guest" ? "guest" : "signed_out",
        ...(errorCode ? { errorCode } : {}),
      };
    }
    return {
      ...this.snapshotForCredential(read.credential),
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private snapshotForCredential(credential: StoredAccountCredential): AccountAuthSnapshot {
    const legacyHasRelayCredential = credential.source !== "legacy_manual"
      || Boolean(credential.legacy?.claudeToken || credential.legacy?.codexToken);
    return {
      status: legacyHasRelayCredential ? statusForCredential(credential) : "signed_out",
      issuer: normalizeAccountIssuer(this.issuer),
      clientId: ACCOUNT_CLIENT_ID,
      deviceName: credential.deviceName,
      account: credential.account,
      expiresAt: credential.expiresAt,
      scopes: credential.scopes,
      legacyManual: credential.source === "legacy_manual",
    };
  }

  private emptySnapshot(): AccountAuthSnapshot {
    return {
      status: "signed_out",
      issuer: normalizeAccountIssuer(this.issuer),
      clientId: ACCOUNT_CLIENT_ID,
      deviceName: this.metadata.deviceName,
      account: null,
      expiresAt: null,
      scopes: [],
      legacyManual: false,
    };
  }

  private publish(snapshot: AccountAuthSnapshot): void {
    this.snapshot = snapshot;
    this.onSnapshot(snapshot);
  }
}
