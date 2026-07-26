import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type { DesktopAccountSummary, AccountAuthErrorCode } from "@shared/types/account-auth";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";
import { getAppSettings, setAppSettings } from "./app-settings";
import { getDataDir } from "./data-dir";

export const ACCOUNT_CLIENT_ID = "pcc-agent-desktop";
export const ACCOUNT_ISSUER = DEFAULT_NEWAPI_BASE_URL;

interface LegacyCredentialSet {
  claudeToken: string;
  codexToken: string;
  accountAccessToken: string;
  accountUserId: string;
}

export interface StoredAccountCredential {
  version: 2;
  issuer: string;
  clientId: string;
  deviceId: string;
  deviceName: string;
  accessTokens: {
    claude: string;
    codex: string;
  };
  tokenType: "Bearer";
  scopes: string[];
  expiresAt: number | null;
  account: DesktopAccountSummary | null;
  grantPublicId?: string;
  source: "desktop" | "legacy_manual";
  legacy?: LegacyCredentialSet;
}

export interface PendingAccountCredential {
  version: 1;
  credential: StoredAccountCredential;
  confirmationToken: string;
  confirmationExpiresAt: number;
}

export type AccountCredentialReadResult =
  | { kind: "ok"; credential: StoredAccountCredential }
  | { kind: "missing" }
  | { kind: "storage_error"; errorCode: AccountAuthErrorCode };

export class AccountCredentialStoreError extends Error {
  constructor(
    readonly code: AccountAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountCredentialStoreError";
  }
}

const CREDENTIAL_DIR = "account-credentials";
const DEVICE_ID_FILE = "account-installation-id";
const rejectedCredentialPaths = new Set<string>();

export function normalizeAccountIssuer(raw: string): string {
  const url = new URL(raw);
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("Issuer must be a bare HTTPS origin");
  }
  if (url.protocol !== "https:") {
    throw new Error("Issuer must use HTTPS");
  }
  return url.origin;
}

export function isSecureBackendAllowed(
  platform: NodeJS.Platform,
  encryptionAvailable: boolean,
  backend?: string,
): { ok: true } | { ok: false; errorCode: AccountAuthErrorCode } {
  if (!encryptionAvailable) {
    return { ok: false, errorCode: "secure_storage_unavailable" };
  }
  if (platform === "linux" && backend === "basic_text") {
    return { ok: false, errorCode: "secure_storage_insecure_backend" };
  }
  return { ok: true };
}

function secureStorageCheck(): { ok: true } | { ok: false; errorCode: AccountAuthErrorCode } {
  let available = false;
  let backend: string | undefined;
  try {
    available = safeStorage.isEncryptionAvailable();
    backend = process.platform === "linux"
      ? safeStorage.getSelectedStorageBackend?.()
      : undefined;
  } catch {
    return { ok: false, errorCode: "secure_storage_unavailable" };
  }
  return isSecureBackendAllowed(process.platform, available, backend);
}

function credentialDir(): string {
  const dir = path.join(getDataDir(), CREDENTIAL_DIR);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Windows and some mounted filesystems do not expose POSIX modes.
  }
  return dir;
}

function credentialPath(issuer: string, deviceId: string): string {
  const key = createHash("sha256")
    .update(`${normalizeAccountIssuer(issuer)}\0${ACCOUNT_CLIENT_ID}\0${deviceId}`)
    .digest("hex");
  return path.join(credentialDir(), `${key}.bin`);
}

function accountCredentialRecordKey(issuer: string, deviceId: string): string {
  return createHash("sha256")
    .update(`${normalizeAccountIssuer(issuer)}\0${ACCOUNT_CLIENT_ID}\0${deviceId}`)
    .digest("hex");
}

function pendingCredentialPath(issuer: string, deviceId: string): string {
  return path.join(credentialDir(), `${accountCredentialRecordKey(issuer, deviceId)}.pending.bin`);
}

function rejectedCredentialPath(issuer: string, deviceId: string): string {
  return path.join(credentialDir(), `${accountCredentialRecordKey(issuer, deviceId)}.rejected.bin`);
}

function deviceIdPath(): string {
  return path.join(getDataDir(), DEVICE_ID_FILE);
}

function enforcePrivateFileMode(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Encryption remains mandatory where POSIX modes are unavailable.
  }
}

function writeFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  mode: number,
): void {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, data, { mode });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // Best effort on filesystems that do not support POSIX modes.
    }
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

export function loadOrCreateAccountDeviceId(): string {
  const filePath = deviceIdPath();
  try {
    const current = fs.readFileSync(filePath, "utf-8").trim();
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(current)) {
      enforcePrivateFileMode(filePath);
      return current;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const deviceId = randomUUID();
  writeFileAtomic(filePath, deviceId, 0o600);
  return deviceId;
}

export function parseAccountCredential(json: string): StoredAccountCredential {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const legacyAccessToken =
    parsed.version === 1 && typeof parsed.accessToken === "string"
      ? parsed.accessToken
      : "";
  const accessTokens =
    parsed.version === 2
    && parsed.accessTokens
    && typeof parsed.accessTokens === "object"
      ? parsed.accessTokens as Record<string, unknown>
      : null;
  const claudeAccessToken =
    accessTokens && typeof accessTokens.claude === "string"
      ? accessTokens.claude
      : legacyAccessToken;
  const codexAccessToken =
    accessTokens && typeof accessTokens.codex === "string"
      ? accessTokens.codex
      : legacyAccessToken;
  if (
    (parsed.version !== 1 && parsed.version !== 2)
    || typeof parsed.issuer !== "string"
    || typeof parsed.clientId !== "string"
    || typeof parsed.deviceId !== "string"
    || typeof parsed.deviceName !== "string"
    || !claudeAccessToken
    || !codexAccessToken
    || parsed.tokenType !== "Bearer"
    || !Array.isArray(parsed.scopes)
    || !parsed.scopes.every((scope) => typeof scope === "string")
    || (
      parsed.expiresAt !== null
      && (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt))
    )
    || (parsed.source !== "desktop" && parsed.source !== "legacy_manual")
  ) {
    throw new Error("Invalid account credential record");
  }
  const legacy =
    parsed.legacy && typeof parsed.legacy === "object"
      ? parsed.legacy as LegacyCredentialSet
      : undefined;
  return {
    version: 2,
    issuer: parsed.issuer,
    clientId: parsed.clientId,
    deviceId: parsed.deviceId,
    deviceName: parsed.deviceName,
    accessTokens: {
      claude: claudeAccessToken,
      codex: codexAccessToken,
    },
    tokenType: "Bearer",
    scopes: parsed.scopes,
    expiresAt: parsed.expiresAt,
    account:
      parsed.account && typeof parsed.account === "object"
        ? parsed.account as DesktopAccountSummary
        : null,
    ...(typeof parsed.grantPublicId === "string" && parsed.grantPublicId
      ? { grantPublicId: parsed.grantPublicId }
      : {}),
    source: parsed.source,
    ...(legacy ? { legacy } : {}),
  };
}

export function readAccountCredential(
  issuer = ACCOUNT_ISSUER,
): AccountCredentialReadResult {
  const storage = secureStorageCheck();
  if (!storage.ok) return { kind: "storage_error", errorCode: storage.errorCode };

  const deviceId = loadOrCreateAccountDeviceId();
  const filePath = credentialPath(issuer, deviceId);
  if (
    rejectedCredentialPaths.has(filePath)
    || fs.existsSync(rejectedCredentialPath(issuer, deviceId))
  ) {
    enforcePrivateFileMode(rejectedCredentialPath(issuer, deviceId));
    return { kind: "missing" };
  }
  let encrypted: Buffer;
  try {
    enforcePrivateFileMode(filePath);
    encrypted = fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "storage_error", errorCode: "secure_storage_decrypt_failed" };
  }

  try {
    const credential = parseAccountCredential(safeStorage.decryptString(encrypted));
    if (
      credential.issuer !== normalizeAccountIssuer(issuer)
      || credential.clientId !== ACCOUNT_CLIENT_ID
      || credential.deviceId !== deviceId
    ) {
      throw new Error("Account credential binding mismatch");
    }
    return {
      kind: "ok",
      credential,
    };
  } catch {
    return { kind: "storage_error", errorCode: "secure_storage_decrypt_failed" };
  }
}

export function loadAccountCredential(
  issuer = ACCOUNT_ISSUER,
): StoredAccountCredential | null {
  const result = readAccountCredential(issuer);
  return result.kind === "ok" ? result.credential : null;
}

export function saveAccountCredential(credential: StoredAccountCredential): void {
  const storage = secureStorageCheck();
  if (!storage.ok) {
    throw new AccountCredentialStoreError(storage.errorCode, "Secure credential storage unavailable");
  }

  const normalized: StoredAccountCredential = {
    ...credential,
    issuer: normalizeAccountIssuer(credential.issuer),
    clientId: ACCOUNT_CLIENT_ID,
  };
  let encrypted: Buffer;
  try {
    encrypted = safeStorage.encryptString(JSON.stringify(normalized));
    const encryptedRoundTrip = parseAccountCredential(safeStorage.decryptString(encrypted));
    if (
      encryptedRoundTrip.accessTokens.claude !== normalized.accessTokens.claude
      || encryptedRoundTrip.accessTokens.codex !== normalized.accessTokens.codex
    ) {
      throw new Error("Credential encryption verification mismatch");
    }
  } catch {
    throw new AccountCredentialStoreError(
      "secure_storage_encrypt_failed",
      "Failed to encrypt account credential",
    );
  }

  const filePath = credentialPath(normalized.issuer, normalized.deviceId);
  try {
    writeFileAtomic(filePath, encrypted, 0o600);
    const verified = parseAccountCredential(safeStorage.decryptString(fs.readFileSync(filePath)));
    if (
      verified.accessTokens.claude !== normalized.accessTokens.claude
      || verified.accessTokens.codex !== normalized.accessTokens.codex
    ) {
      throw new Error("Credential verification mismatch");
    }
    try {
      fs.unlinkSync(rejectedCredentialPath(normalized.issuer, normalized.deviceId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    rejectedCredentialPaths.delete(filePath);
  } catch (error) {
    if (error instanceof AccountCredentialStoreError) throw error;
    throw new AccountCredentialStoreError(
      "secure_storage_write_failed",
      "Failed to persist account credential",
    );
  }
}

export function deleteAccountCredential(issuer = ACCOUNT_ISSUER): boolean {
  const deviceId = loadOrCreateAccountDeviceId();
  const filePath = credentialPath(issuer, deviceId);
  try {
    fs.unlinkSync(filePath);
    try {
      fs.unlinkSync(rejectedCredentialPath(issuer, deviceId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    rejectedCredentialPaths.delete(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        fs.unlinkSync(rejectedCredentialPath(issuer, deviceId));
      } catch (tombstoneError) {
        if ((tombstoneError as NodeJS.ErrnoException).code !== "ENOENT") throw tombstoneError;
      }
      rejectedCredentialPaths.delete(filePath);
      return false;
    }
    throw error;
  }
}

export function markAccountCredentialRejected(issuer = ACCOUNT_ISSUER): void {
  const deviceId = loadOrCreateAccountDeviceId();
  const filePath = credentialPath(issuer, deviceId);
  rejectedCredentialPaths.add(filePath);
  const tombstone = {
    version: 1,
    issuer: normalizeAccountIssuer(issuer),
    clientId: ACCOUNT_CLIENT_ID,
    deviceId,
    rejectedAt: Date.now(),
  };
  try {
    const storage = secureStorageCheck();
    if (!storage.ok) return;
    writeFileAtomic(
      rejectedCredentialPath(issuer, deviceId),
      safeStorage.encryptString(JSON.stringify(tombstone)),
      0o600,
    );
  } catch {
    // The in-memory rejection remains fail-closed for this process.
  }
}

export function savePendingAccountCredential(pending: PendingAccountCredential): void {
  const storage = secureStorageCheck();
  if (!storage.ok) {
    throw new AccountCredentialStoreError(storage.errorCode, "Secure credential storage unavailable");
  }
  if (
    pending.version !== 1
    || !pending.confirmationToken
    || !Number.isFinite(pending.confirmationExpiresAt)
    || pending.confirmationExpiresAt <= Date.now()
  ) {
    throw new AccountCredentialStoreError(
      "secure_storage_write_failed",
      "Invalid pending account credential",
    );
  }
  const normalized: PendingAccountCredential = {
    ...pending,
    credential: {
      ...pending.credential,
      issuer: normalizeAccountIssuer(pending.credential.issuer),
      clientId: ACCOUNT_CLIENT_ID,
    },
  };
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(normalized));
    writeFileAtomic(
      pendingCredentialPath(normalized.credential.issuer, normalized.credential.deviceId),
      encrypted,
      0o600,
    );
    const verified = JSON.parse(
      safeStorage.decryptString(fs.readFileSync(
        pendingCredentialPath(normalized.credential.issuer, normalized.credential.deviceId),
      )),
    ) as PendingAccountCredential;
    if (
      verified.confirmationToken !== normalized.confirmationToken
      || verified.credential.accessTokens.claude !== normalized.credential.accessTokens.claude
      || verified.credential.accessTokens.codex !== normalized.credential.accessTokens.codex
    ) {
      throw new Error("Pending credential verification mismatch");
    }
  } catch (error) {
    if (error instanceof AccountCredentialStoreError) throw error;
    throw new AccountCredentialStoreError(
      "secure_storage_write_failed",
      "Failed to persist pending account credential",
    );
  }
}

export function readPendingAccountCredential(
  issuer = ACCOUNT_ISSUER,
): PendingAccountCredential | null {
  const storage = secureStorageCheck();
  if (!storage.ok) return null;
  const deviceId = loadOrCreateAccountDeviceId();
  try {
    enforcePrivateFileMode(pendingCredentialPath(issuer, deviceId));
    const parsed = JSON.parse(safeStorage.decryptString(
      fs.readFileSync(pendingCredentialPath(issuer, deviceId)),
    )) as PendingAccountCredential;
    if (
      parsed.version !== 1
      || !parsed.confirmationToken
      || !Number.isFinite(parsed.confirmationExpiresAt)
    ) {
      throw new Error("Invalid pending credential record");
    }
    const credential = parseAccountCredential(JSON.stringify(parsed.credential));
    if (
      credential.issuer !== normalizeAccountIssuer(issuer)
      || credential.clientId !== ACCOUNT_CLIENT_ID
      || credential.deviceId !== deviceId
    ) {
      throw new Error("Pending credential binding mismatch");
    }
    return { ...parsed, credential };
  } catch {
    return null;
  }
}

export function deletePendingAccountCredential(issuer = ACCOUNT_ISSUER): boolean {
  const deviceId = loadOrCreateAccountDeviceId();
  try {
    fs.unlinkSync(pendingCredentialPath(issuer, deviceId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function credentialTokenForEngine(
  credential: StoredAccountCredential | null,
  engine: "claude" | "codex",
): string {
  if (!credential) return "";
  if (credential.source === "legacy_manual" && credential.legacy) {
    return engine === "claude"
      ? credential.legacy.claudeToken
      : credential.legacy.codexToken;
  }
  if (credential.expiresAt !== null && credential.expiresAt <= Date.now()) {
    return "";
  }
  return credential.accessTokens[engine];
}

/**
 * Moves old DPCC secrets out of settings.json only after an encrypted write and
 * read-back succeed. Existing browser-authorized credentials always win.
 */
export function migrateLegacyAccountCredentials(deviceName: string): AccountCredentialReadResult {
  const settings = getAppSettings();
  const legacy: LegacyCredentialSet = {
    claudeToken: settings.dpccUpstream.claudeToken.trim(),
    codexToken: settings.dpccUpstream.codexToken.trim(),
    accountAccessToken: settings.accountAccessToken.trim(),
    accountUserId: settings.accountUserId.trim(),
  };
  const hasLegacy = Object.values(legacy).some(Boolean);
  const current = readAccountCredential();
  if (!hasLegacy || current.kind === "storage_error") return current;

  if (current.kind === "missing") {
    const deviceId = loadOrCreateAccountDeviceId();
    const commonToken = legacy.claudeToken || legacy.codexToken || legacy.accountAccessToken;
    if (!commonToken) return current;
    saveAccountCredential({
      version: 2,
      issuer: ACCOUNT_ISSUER,
      clientId: ACCOUNT_CLIENT_ID,
      deviceId,
      deviceName,
      accessTokens: {
        claude: legacy.claudeToken || commonToken,
        codex: legacy.codexToken || commonToken,
      },
      tokenType: "Bearer",
      scopes: [],
      expiresAt: null,
      account: null,
      source: "legacy_manual",
      legacy,
    });
  }

  setAppSettings({
    dpccUpstream: {
      ...settings.dpccUpstream,
      claudeToken: "",
      codexToken: "",
    },
    accountAccessToken: "",
    accountUserId: "",
  });

  return readAccountCredential();
}
