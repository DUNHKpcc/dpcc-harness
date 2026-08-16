import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { nativeTheme } from "electron";
import type {
  AccountAuthActionResult,
  AccountAuthErrorCode,
  AccountAuthSnapshot,
  DesktopAccountSummary,
} from "@shared/types/account-auth";
import { DESKTOP_CONTRACT_VERSION } from "@shared/types/account-auth";
import {
  DEFAULT_NEWAPI_AUTHORIZATION_ORIGIN,
  type AccountSubscription,
} from "@shared/types/account";
import {
  ACCOUNT_CLIENT_ID,
  ACCOUNT_ISSUER,
  AccountCredentialStoreError,
  credentialTokenForEngine,
  deletePendingAccountCredential,
  deleteAccountCredential,
  loadOrCreateAccountDeviceId,
  markAccountCredentialRejected,
  normalizeAccountIssuer,
  readPendingAccountCredential,
  readAccountCredential,
  savePendingAccountCredential,
  saveAccountCredential,
  type PendingAccountCredential,
  type StoredAccountCredential,
} from "./account-credential-store";
import { getAppSetting, getAppSettings, setAppSettings } from "./app-settings";
import {
  renderAccountAuthorizationPage,
  type AccountAuthorizationPageKind,
  type AccountAuthorizationPageTheme,
} from "./account-auth-loopback-page";
import { log } from "./logger";

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
  contractVersion: number | null;
  accessTokens: {
    claude: string;
    codex: string;
  };
  expiresIn: number;
  scopes: string[];
  account: DesktopAccountSummary | null;
  grantPublicId: string;
  confirmationRequired: boolean;
  confirmationToken: string;
  confirmationExpiresIn: number;
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

function recordAuthorizationStage(
  stage: "request" | "browser_callback" | "exchange" | "storage" | "confirmation",
  outcome: "ok" | "error",
  startedAt: number,
  errorCode?: AccountAuthErrorCode,
  grantPublicId?: string,
): void {
  log("ACCOUNT_AUTH_STAGE", {
    stage,
    outcome,
    latencyMs: Math.max(0, Date.now() - startedAt),
    ...(errorCode ? { errorCode } : {}),
    ...(grantPublicId
      ? {
          grant: createHash("sha256")
            .update(grantPublicId)
            .digest("hex")
            .slice(0, 16),
        }
      : {}),
  });
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
  expectedRequestToken: string,
): URL {
  const expectedOrigin = normalizeAccountIssuer(expectedAuthorizationOrigin);
  const parsed = new URL(candidate);
  const requestTokens = parsed.searchParams.getAll("request");
  if (
    parsed.origin !== expectedOrigin
    || parsed.protocol !== "https:"
    || parsed.pathname !== "/desktop/authorize"
    || parsed.username
    || parsed.password
    || parsed.hash
    || requestTokens.length !== 1
    || requestTokens[0] !== expectedRequestToken
    || [...parsed.searchParams.keys()].some((key) => key !== "request")
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
  kind: AccountAuthorizationPageKind,
  acceptLanguage: string | string[] | undefined,
  theme?: AccountAuthorizationPageTheme,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  response.end(renderAccountAuthorizationPage({ kind, acceptLanguage, theme }));
}

export async function createLoopbackReceiver(
  callbackNonce: string,
  expectedState: string,
  signal: AbortSignal,
  theme?: AccountAuthorizationPageTheme,
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
      sendLoopbackPage(
        response,
        400,
        "invalid-host",
        request.headers["accept-language"],
        theme,
      );
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
      sendLoopbackPage(
        response,
        400,
        "state-mismatch",
        request.headers["accept-language"],
        theme,
      );
      rejectCallback(new AccountAuthorizationError(
        "callback_state_mismatch",
        "Authorization callback state mismatch",
      ));
      server.close();
      return;
    }
    if ((codes.length === 1) === (errors.length === 1)) {
      sendLoopbackPage(
        response,
        400,
        "invalid-response",
        request.headers["accept-language"],
        theme,
      );
      rejectCallback(new AccountAuthorizationError("callback_invalid", "Invalid callback response"));
      server.close();
      return;
    }

    if (errors.length === 1) {
      sendLoopbackPage(
        response,
        200,
        "cancelled",
        request.headers["accept-language"],
        theme,
      );
      resolveCallback({ error: errors[0] });
    } else {
      sendLoopbackPage(
        response,
        200,
        "success",
        request.headers["accept-language"],
        theme,
      );
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
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }

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

function parseAccountSubscription(
  record: Record<string, unknown>,
): AccountSubscription | undefined {
  const raw = record.subscription;
  const subscription = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : null;
  const state =
    (subscription ? stringField(subscription, "state") : "")
    || stringField(record, "subscription_state", "subscriptionState");
  if (!state) return undefined;
  const expiresAtSeconds = subscription
    ? numberField(subscription, "expires_at", "expiresAt")
    : undefined;
  return {
    state,
    expiresAt: expiresAtSeconds && expiresAtSeconds > 0
      ? expiresAtSeconds * 1_000
      : null,
    items: [],
  };
}

function parseAccountSummary(value: unknown): DesktopAccountSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const displayName = stringField(record, "display_name", "displayName");
  const maskedEmail =
    stringField(record, "masked_email", "maskedEmail")
    || stringField(record, "email");
  const subscriptionState = stringField(record, "subscription_state", "subscriptionState");
  const subscription = parseAccountSubscription(record);
  const allowed = record.allowed_models ?? record.allowedModels;
  const allowedModels = Array.isArray(allowed)
    ? allowed.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    displayName: displayName || maskedEmail || "DPCC API user",
    ...(maskedEmail ? { maskedEmail } : {}),
    ...(numberField(record, "quota") !== undefined ? { quota: numberField(record, "quota") } : {}),
    ...(subscription ? { subscription } : {}),
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
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
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
  const normalized = error.trim().toLowerCase();
  if (normalized === "access_denied") return "access_denied";
  if (
    normalized === "request_expired"
    || normalized === "expired_request"
    || normalized === "desktop_request_expired"
  ) {
    return "request_expired";
  }
  if (
    normalized === "invalid_grant"
    || normalized === "token_expired"
    || normalized === "desktop_request_consumed"
    || normalized === "desktop_invalid_pkce"
  ) {
    return "token_exchange_failed";
  }
  if (normalized === "desktop_confirmation_expired") return "token_confirmation_expired";
  if (normalized === "desktop_confirmation_invalid") return "token_confirmation_failed";
  if (normalized === "desktop_device_limit") return "device_limit_reached";
  if (normalized === "desktop_token_invalid" || normalized === "desktop_scope_denied") {
    return "token_rejected";
  }
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
  const contractVersion = numberField(value, "contract_version", "contractVersion") ?? null;
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
  const confirmationRequired =
    value.confirmation_required === true || value.confirmationRequired === true;
  const confirmationToken = stringField(
    value,
    "confirmation_token",
    "confirmationToken",
  );
  const confirmationExpiresIn =
    numberField(value, "confirmation_expires_in", "confirmationExpiresIn") ?? 0;
  const accountRecord =
    value.account && typeof value.account === "object"
      ? value.account as Record<string, unknown>
      : {};
  const grantPublicId = stringField(accountRecord, "grant_public_id", "grantPublicId");
  if (
    !accessTokens.claude
    || !accessTokens.codex
    || tokenType.toLowerCase() !== "bearer"
    || expiresIn === undefined
    || expiresIn <= 0
    || (contractVersion !== null && contractVersion !== DESKTOP_CONTRACT_VERSION)
    || (
      contractVersion === DESKTOP_CONTRACT_VERSION
      && (!confirmationRequired || !grantPublicId)
    )
    || (
      confirmationRequired
      && (!confirmationToken || confirmationExpiresIn <= 0)
    )
  ) {
    throw new AccountAuthorizationError(
      "token_exchange_failed",
      "Authorization server returned an invalid token response",
    );
  }
  return {
    contractVersion,
    accessTokens,
    expiresIn,
    scopes: scope.split(/\s+/).filter(Boolean),
    account: parseAccountSummary(value.account),
    grantPublicId,
    confirmationRequired,
    confirmationToken,
    confirmationExpiresIn,
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
    private readonly stopDesktopSessions: (reason: string) => void = () => {},
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
    if (readPendingAccountCredential(this.issuer)) {
      if (getAppSetting("accountMode") !== "guest") {
        this.resumePendingConfirmation();
        return { ok: true };
      }
      try {
        deletePendingAccountCredential(this.issuer);
      } catch {
        this.publish({
          ...this.emptySnapshot(),
          status: "storage_error",
          errorCode: "secure_storage_write_failed",
        });
        return { ok: false, errorCode: "secure_storage_write_failed" };
      }
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

  resumePendingConfirmation(): void {
    if (this.active || getAppSetting("accountMode") === "guest") return;
    const pending = readPendingAccountCredential(this.issuer);
    if (!pending) return;
    const controller = new AbortController();
    const active: ActiveAuthorization = { controller, closeLoopback: () => {} };
    this.active = active;
    this.publish({
      ...this.readSnapshot(),
      status: "authorizing",
      errorCode: undefined,
    });
    void (async () => {
      const startedAt = Date.now();
      const grantPublicId = pending.credential.grantPublicId;
      try {
        const credential = await this.confirmPendingCredential(
          pending,
          active.controller.signal,
        );
        recordAuthorizationStage(
          "confirmation",
          "ok",
          startedAt,
          undefined,
          grantPublicId,
        );
        if (this.active === active) this.publishConnectedCredential(credential);
      } catch (error) {
        if (this.active !== active) return;
        const code = error instanceof AccountAuthorizationError
          ? error.code
          : error instanceof AccountCredentialStoreError
            ? error.code
            : "unknown";
        recordAuthorizationStage(
          "confirmation",
          "error",
          startedAt,
          code,
          grantPublicId,
        );
        if (code === "token_confirmation_expired") {
          try { deletePendingAccountCredential(this.issuer); } catch { /* fail closed */ }
        }
        const current = this.readSnapshot(code);
        this.publish(current);
      } finally {
        if (this.active === active) this.active = null;
      }
    })();
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
    this.stopDesktopSessions("account-guest-mode");
    try {
      deletePendingAccountCredential(this.issuer);
    } catch {
      // Guest mode remains fail-closed even when pending cleanup is unavailable.
    }
    const settings = getAppSettings();
    setAppSettings({
      accountMode: "guest",
      ...(settings.claudeCliConfigSource === "default"
        ? { claudeCliConfigSource: "local" as const }
        : {}),
      ...(settings.codexCliConfigSource === "default"
        ? { codexCliConfigSource: "local" as const }
        : {}),
      ...(settings.piCliConfigSource === "default"
        ? { piCliConfigSource: "local" as const }
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
    this.stopDesktopSessions("account-authorization-cleared");
    try {
      deleteAccountCredential(this.issuer);
      deletePendingAccountCredential(this.issuer);
      setAppSettings({ accountMode: "unset" });
      this.publish({ ...this.emptySnapshot(), status: "signed_out" });
      return { ok: true };
    } catch {
      return { ok: false, errorCode: "secure_storage_write_failed" };
    }
  }

  markTokenRejected(): void {
    this.stopDesktopSessions("account-token-rejected");
    markAccountCredentialRejected(this.issuer);
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
    let observedStage: Parameters<typeof recordAuthorizationStage>[0] = "request";
    let stageStartedAt = Date.now();
    let grantPublicId = "";
    try {
      const issuer = normalizeAccountIssuer(this.issuer);
      const deviceId = loadOrCreateAccountDeviceId();
      const pkce = createPkceMaterial();
      receiver = await createLoopbackReceiver(
        pkce.callbackNonce,
        pkce.state,
        active.controller.signal,
        nativeTheme?.shouldUseDarkColors ? "dark" : "light",
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
        "authorization_request_failed",
      ));
      recordAuthorizationStage("request", "ok", stageStartedAt);
      const authorizationUrl = validateAuthorizationUrl(
        this.authorizationOrigin,
        authorizationRequest.authorizationUrl,
        authorizationRequest.requestToken,
      );

      try {
        await this.openExternal(authorizationUrl.toString());
      } catch {
        throw new AccountAuthorizationError("browser_open_failed", "Failed to open the browser");
      }

      observedStage = "browser_callback";
      stageStartedAt = Date.now();
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
      recordAuthorizationStage("browser_callback", "ok", stageStartedAt);

      observedStage = "exchange";
      stageStartedAt = Date.now();
      const exchanged = parseTokenExchange(await postJson(
        `${issuer}/api/desktop/oauth/token`,
        {
          grant_type: "authorization_code",
          client_id: ACCOUNT_CLIENT_ID,
          code: callback.code,
          redirect_uri: receiver.redirectUri,
          code_verifier: pkce.verifier,
          device_id: deviceId,
          protocol_version: DESKTOP_CONTRACT_VERSION,
        },
        active.controller.signal,
        undefined,
        "token_exchange_failed",
      ));
      grantPublicId = exchanged.grantPublicId;
      recordAuthorizationStage("exchange", "ok", stageStartedAt, undefined, grantPublicId);
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
        ...(grantPublicId ? { grantPublicId } : {}),
        source: "desktop",
      };

      observedStage = "storage";
      stageStartedAt = Date.now();
      if (exchanged.confirmationRequired) {
        const pending: PendingAccountCredential = {
          version: 1,
          credential,
          confirmationToken: exchanged.confirmationToken,
          confirmationExpiresAt: Date.now() + exchanged.confirmationExpiresIn * 1_000,
        };
        savePendingAccountCredential(pending);
        recordAuthorizationStage("storage", "ok", stageStartedAt, undefined, grantPublicId);
        observedStage = "confirmation";
        stageStartedAt = Date.now();
        await this.confirmPendingCredential(pending, active.controller.signal);
        recordAuthorizationStage("confirmation", "ok", stageStartedAt, undefined, grantPublicId);
      } else {
        try {
          saveAccountCredential(credential);
          recordAuthorizationStage("storage", "ok", stageStartedAt, undefined, grantPublicId);
        } catch (storageError) {
          const cleanupController = new AbortController();
          try {
            await postJson(
              `${issuer}/api/desktop/oauth/revoke`,
              {},
              cleanupController.signal,
              `Bearer ${exchanged.accessTokens.claude || exchanged.accessTokens.codex}`,
              "revoke_failed",
            );
          } catch {
            // Legacy servers activate during exchange, so cleanup remains best-effort.
          }
          throw storageError;
        }
      }
      if (this.active === active) {
        this.publishConnectedCredential(credential);
      }
    } catch (error) {
      if (this.active !== active) return;
      const code = error instanceof AccountAuthorizationError
        ? error.code
        : error instanceof AccountCredentialStoreError
          ? error.code
          : "unknown";
      recordAuthorizationStage(
        observedStage,
        "error",
        stageStartedAt,
        code,
        grantPublicId,
      );
      const current = this.readSnapshot(code);
      this.publish(
        current.status === "signed_out" && code.startsWith("secure_storage_")
          ? { ...current, status: "storage_error" }
          : current,
      );
    } finally {
      receiver?.close();
      if (this.active === active) this.active = null;
    }
  }

  private async confirmPendingCredential(
    pending: PendingAccountCredential,
    signal: AbortSignal,
  ): Promise<StoredAccountCredential> {
    if (pending.confirmationExpiresAt <= Date.now()) {
      throw new AccountAuthorizationError(
        "token_confirmation_expired",
        "Token confirmation expired",
      );
    }
    await postJson(
      `${normalizeAccountIssuer(this.issuer)}/api/desktop/oauth/confirm`,
      { confirmation_token: pending.confirmationToken },
      signal,
      undefined,
      "token_confirmation_failed",
    );
    saveAccountCredential(pending.credential);
    try {
      deletePendingAccountCredential(this.issuer);
    } catch {
      // The active credential is already verified. A stale pending record can be
      // retried idempotently on the next launch without exposing the token.
    }
    return pending.credential;
  }

  private publishConnectedCredential(credential: StoredAccountCredential): void {
    this.stopDesktopSessions("account-credential-rotated");
    const wasGuest = getAppSetting("accountMode") === "guest";
    setAppSettings({
      accountMode: "unset",
      ...(wasGuest
        ? {
            claudeCliConfigSource: "default" as const,
            codexCliConfigSource: "default" as const,
            piCliConfigSource: "default" as const,
          }
        : {}),
    });
    this.publish(this.snapshotForCredential(credential));
  }

  private readSnapshot(errorCode?: AccountAuthErrorCode): AccountAuthSnapshot {
    if (getAppSetting("accountMode") === "guest") {
      return {
        ...this.emptySnapshot(),
        status: "guest",
        ...(errorCode ? { errorCode } : {}),
      };
    }
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
