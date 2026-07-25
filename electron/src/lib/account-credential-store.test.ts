import { describe, expect, it } from "vitest";
import {
  isSecureBackendAllowed,
  normalizeAccountIssuer,
  parseAccountCredential,
} from "./account-credential-store";

describe("desktop account credential storage policy", () => {
  it("requires safeStorage encryption", () => {
    expect(isSecureBackendAllowed("darwin", false)).toEqual({
      ok: false,
      errorCode: "secure_storage_unavailable",
    });
    expect(isSecureBackendAllowed("win32", true)).toEqual({ ok: true });
  });

  it("fails closed on Linux basic_text", () => {
    expect(isSecureBackendAllowed("linux", true, "basic_text")).toEqual({
      ok: false,
      errorCode: "secure_storage_insecure_backend",
    });
    expect(isSecureBackendAllowed("linux", true, "gnome_libsecret")).toEqual({ ok: true });
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
});
