import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  credentialTokenForEngine,
  isSecureBackendAllowed,
  normalizeAccountIssuer,
  parseAccountCredential,
} from "./account-credential-store";
import type { StoredAccountCredential } from "./account-credential-store";

describe("desktop account credential storage policy", () => {
  it("requires safeStorage encryption", () => {
    expect(isSecureBackendAllowed("darwin", false)).toEqual({
      ok: false,
      errorCode: "secure_storage_unavailable",
    });
    expect(isSecureBackendAllowed("win32", true)).toEqual({ ok: true });
    expect(isSecureBackendAllowed("win32", false)).toEqual({
      ok: false,
      errorCode: "secure_storage_unavailable",
    });
    expect(isSecureBackendAllowed("darwin", true)).toEqual({ ok: true });
  });

  it("fails closed on Linux basic_text", () => {
    expect(isSecureBackendAllowed("linux", true, "basic_text")).toEqual({
      ok: false,
      errorCode: "secure_storage_insecure_backend",
    });
    expect(isSecureBackendAllowed("linux", true, "gnome_libsecret")).toEqual({ ok: true });
    expect(isSecureBackendAllowed("linux", true, "kwallet")).toEqual({ ok: true });
    expect(isSecureBackendAllowed("linux", false, "gnome_libsecret")).toEqual({
      ok: false,
      errorCode: "secure_storage_unavailable",
    });
  });

  it("normalizes only bare HTTPS issuer origins", () => {
    expect(normalizeAccountIssuer("https://api.example.test/")).toBe("https://api.example.test");
    expect(() => normalizeAccountIssuer("http://api.example.test")).toThrow();
    expect(() => normalizeAccountIssuer("https://api.example.test/path")).toThrow();
    expect(() => normalizeAccountIssuer("https://api.example.test?next=evil")).toThrow();
    expect(() => normalizeAccountIssuer("https://user:pass@api.example.test")).toThrow();
  });

  it("migrates a version 1 single token record to both engine slots", () => {
    const credential = parseAccountCredential(JSON.stringify({
      version: 1,
      issuer: "https://api.example.test",
      clientId: "pcc-agent-desktop",
      deviceId: "device-id",
      deviceName: "Desktop",
      accessToken: "sk-legacy",
      tokenType: "Bearer",
      scopes: ["relay"],
      expiresAt: null,
      account: null,
      source: "desktop",
    }));

    expect(credential.version).toBe(2);
    expect(credential.accessTokens).toEqual({
      claude: "sk-legacy",
      codex: "sk-legacy",
    });
    expect("accessToken" in credential).toBe(false);
  });

  it("preserves independent engine keys in a version 2 record", () => {
    const credential = parseAccountCredential(JSON.stringify({
      version: 2,
      issuer: "https://api.example.test",
      clientId: "pcc-agent-desktop",
      deviceId: "device-id",
      deviceName: "Desktop",
      accessTokens: {
        claude: "sk-claude",
        codex: "sk-codex",
      },
      tokenType: "Bearer",
      scopes: ["relay"],
      expiresAt: null,
      account: null,
      source: "desktop",
    }));

    expect(credential.accessTokens).toEqual({
      claude: "sk-claude",
      codex: "sk-codex",
    });
  });

  it("does not return expired browser-authorized tokens", () => {
    const credential = parseAccountCredential(JSON.stringify({
      version: 2,
      issuer: "https://api.example.test",
      clientId: "pcc-agent-desktop",
      deviceId: "device-id",
      deviceName: "Desktop",
      accessTokens: {
        claude: "sk-expired-claude",
        codex: "sk-expired-codex",
      },
      tokenType: "Bearer",
      scopes: ["relay"],
      expiresAt: Date.now() - 1,
      account: null,
      source: "desktop",
    }));

    expect(credentialTokenForEngine(credential, "claude")).toBe("");
    expect(credentialTokenForEngine(credential, "codex")).toBe("");
  });
});

describe("desktop account credential persistence", () => {
  const tempDirs: string[] = [];

  async function loadStore(tempDir: string) {
    vi.resetModules();
    vi.doMock("electron", () => ({
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => "gnome_libsecret",
        encryptString: (value: string) => Buffer.from(value, "utf8"),
        decryptString: (value: Buffer) => value.toString("utf8"),
      },
    }));
    vi.doMock("./data-dir", () => ({ getDataDir: () => tempDir }));
    return import("./account-credential-store");
  }

  afterEach(() => {
    vi.doUnmock("electron");
    vi.doUnmock("./data-dir");
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps a rejected credential blocked across a module restart", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-account-store-"));
    tempDirs.push(tempDir);
    const first = await loadStore(tempDir);
    const deviceId = first.loadOrCreateAccountDeviceId();
    const credential: StoredAccountCredential = {
      version: 2,
      issuer: first.ACCOUNT_ISSUER,
      clientId: first.ACCOUNT_CLIENT_ID,
      deviceId,
      deviceName: "Test device",
      accessTokens: { claude: "sk-old-claude", codex: "sk-old-codex" },
      tokenType: "Bearer",
      scopes: ["relay"],
      expiresAt: Date.now() + 60_000,
      account: null,
      source: "desktop",
    };
    first.saveAccountCredential(credential);
    first.markAccountCredentialRejected();
    expect(first.readAccountCredential().kind).toBe("missing");

    const restarted = await loadStore(tempDir);
    expect(restarted.readAccountCredential().kind).toBe("missing");
    restarted.saveAccountCredential({
      ...credential,
      accessTokens: { claude: "sk-new-claude", codex: "sk-new-codex" },
    });
    expect(restarted.loadAccountCredential()?.accessTokens.claude).toBe("sk-new-claude");
  });

  it("keeps pending confirmation separate and fails closed on credential corruption", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-account-pending-"));
    tempDirs.push(tempDir);
    const store = await loadStore(tempDir);
    const deviceId = store.loadOrCreateAccountDeviceId();
    const active: StoredAccountCredential = {
      version: 2,
      issuer: store.ACCOUNT_ISSUER,
      clientId: store.ACCOUNT_CLIENT_ID,
      deviceId,
      deviceName: "Test device",
      accessTokens: { claude: "sk-active-claude", codex: "sk-active-codex" },
      tokenType: "Bearer",
      scopes: ["relay"],
      expiresAt: Date.now() + 60_000,
      account: null,
      source: "desktop",
    };
    store.saveAccountCredential(active);
    store.savePendingAccountCredential({
      version: 1,
      credential: {
        ...active,
        accessTokens: { claude: "sk-pending-claude", codex: "sk-pending-codex" },
      },
      confirmationToken: "confirmation-secret",
      confirmationExpiresAt: Date.now() + 60_000,
    });

    expect(store.loadAccountCredential()?.accessTokens.claude).toBe("sk-active-claude");
    expect(store.readPendingAccountCredential()?.credential.accessTokens.claude)
      .toBe("sk-pending-claude");

    const credentialDir = path.join(tempDir, "account-credentials");
    const files = fs.readdirSync(credentialDir);
    if (process.platform !== "win32") {
      for (const name of files) {
        expect(fs.statSync(path.join(credentialDir, name)).mode & 0o777).toBe(0o600);
      }
    }
    const activeFile = files.find((name) => /^[a-f0-9]{64}\.bin$/.test(name));
    expect(activeFile).toBeDefined();
    fs.chmodSync(path.join(credentialDir, activeFile!), 0o644);
    expect(store.readAccountCredential().kind).toBe("ok");
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(credentialDir, activeFile!)).mode & 0o777).toBe(0o600);
    }
    fs.writeFileSync(path.join(credentialDir, activeFile!), "corrupt");
    expect(store.readAccountCredential()).toEqual({
      kind: "storage_error",
      errorCode: "secure_storage_decrypt_failed",
    });
  });
});
