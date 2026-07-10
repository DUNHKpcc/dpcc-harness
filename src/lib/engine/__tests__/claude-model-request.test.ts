import { describe, expect, it } from "vitest";
import {
  claudeModelCatalogSettingsFingerprint,
  isClaudeModelCatalogLoaded,
  isClaudeModelCacheRequestCurrent,
  isClaudeModelRequestCurrent,
} from "../claude-model-request";
import type { AppSettings } from "@shared/types/settings";

describe("isClaudeModelRequestCurrent", () => {
  it("accepts the same session and generation", () => {
    expect(isClaudeModelRequestCurrent(
      { sessionId: "session-a", generation: 2 },
      { sessionId: "session-a", generation: 2 },
    )).toBe(true);
  });

  it("rejects a request captured for a different session", () => {
    expect(isClaudeModelRequestCurrent(
      { sessionId: "session-a", generation: 2 },
      { sessionId: "session-b", generation: 2 },
    )).toBe(false);
  });

  it("rejects a request superseded by a newer generation", () => {
    expect(isClaudeModelRequestCurrent(
      { sessionId: "session-a", generation: 2 },
      { sessionId: "session-a", generation: 3 },
    )).toBe(false);
  });
});

describe("isClaudeModelCacheRequestCurrent", () => {
  it("accepts an exact cache generation match", () => {
    expect(isClaudeModelCacheRequestCurrent(4, 4)).toBe(true);
  });

  it("rejects an older cache generation", () => {
    expect(isClaudeModelCacheRequestCurrent(4, 5)).toBe(false);
  });
});

describe("isClaudeModelCatalogLoaded", () => {
  it("preserves a successful authoritative empty DPCC catalog", () => {
    expect(isClaudeModelCatalogLoaded([], true)).toBe(true);
  });

  it("falls back when a non-authoritative SDK catalog is empty", () => {
    expect(isClaudeModelCatalogLoaded([], false)).toBe(false);
  });

  it("uses a non-empty SDK fallback catalog", () => {
    expect(isClaudeModelCatalogLoaded([{ value: "claude" }], false)).toBe(true);
  });
});

describe("claudeModelCatalogSettingsFingerprint", () => {
  const settings = {
    cliConfigSource: "default",
    claudeCliConfigSource: "default",
    claudeBinarySource: "auto",
    claudeCustomBinaryPath: "",
    claudeGateway: {
      enabled: false,
      baseUrl: "",
      authToken: "",
      model: "",
    },
    dpccUpstream: {
      baseUrl: "https://api.dpcc.example/v1/",
      claudeToken: "token-a",
      claudeModel: "claude-sonnet-4-6",
    },
  } as AppSettings;

  it("changes for Claude source credentials and model selection", () => {
    const initial = claudeModelCatalogSettingsFingerprint(settings);
    expect(claudeModelCatalogSettingsFingerprint({
      ...settings,
      dpccUpstream: { ...settings.dpccUpstream, claudeToken: "token-b" },
    })).not.toBe(initial);
    expect(claudeModelCatalogSettingsFingerprint({
      ...settings,
      dpccUpstream: { ...settings.dpccUpstream, claudeModel: "claude-opus-4-6" },
    })).not.toBe(initial);
    expect(claudeModelCatalogSettingsFingerprint({
      ...settings,
      claudeCliConfigSource: "local",
    })).not.toBe(initial);
  });

  it("ignores inactive gateway changes", () => {
    expect(claudeModelCatalogSettingsFingerprint({
      ...settings,
      claudeGateway: { ...settings.claudeGateway, authToken: "unused" },
    })).toBe(claudeModelCatalogSettingsFingerprint(settings));
  });
});
