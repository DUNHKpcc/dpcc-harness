import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dataDirRef } = vi.hoisted(() => ({
  dataDirRef: { current: "" },
}));

vi.mock("../data-dir", () => ({
  getDataDir: () => dataDirRef.current,
}));

async function loadModule() {
  vi.resetModules();
  return import("../app-settings");
}

describe("app settings", () => {
  beforeEach(() => {
    dataDirRef.current = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-settings-"));
  });

  afterEach(() => {
    fs.rmSync(dataDirRef.current, { recursive: true, force: true });
  });

  it("migrates legacy Claude and Codex binary sources to built-in by default", async () => {
    const settingsPath = path.join(dataDirRef.current, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      claudeBinarySource: "auto",
      codexBinarySource: "managed",
      codexCustomBinaryPath: "/opt/bin/codex",
      dpccUpstream: {
        baseUrl: "",
        claudeToken: "",
        codexToken: "",
        claudeModel: "",
        codexModel: "",
      },
    }), "utf-8");

    const { getAppSettings } = await loadModule();

    const settings = getAppSettings();
    expect(settings.claudeBinarySource).toBe("builtin");
    expect(settings.codexBinarySource).toBe("builtin");
    expect(settings.binarySourceDefaultsMigrated).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      claudeBinarySource: string;
      codexBinarySource: string;
      binarySourceDefaultsMigrated: boolean;
    };
    expect(persisted).toMatchObject({
      claudeBinarySource: "builtin",
      codexBinarySource: "builtin",
      binarySourceDefaultsMigrated: true,
    });
  });

  it("preserves a legacy custom binary source when an explicit path exists", async () => {
    fs.writeFileSync(path.join(dataDirRef.current, "settings.json"), JSON.stringify({
      claudeBinarySource: "custom",
      claudeCustomBinaryPath: "/opt/bin/claude",
      codexBinarySource: "custom",
      codexCustomBinaryPath: "/opt/bin/codex",
      dpccUpstream: {
        baseUrl: "",
        claudeToken: "",
        codexToken: "",
        claudeModel: "",
        codexModel: "",
      },
    }), "utf-8");

    const { getAppSettings } = await loadModule();

    const settings = getAppSettings();
    expect(settings.claudeBinarySource).toBe("custom");
    expect(settings.codexBinarySource).toBe("custom");
    expect(settings.binarySourceDefaultsMigrated).toBe(true);
  });

  it("backfills gateway model mappings for older settings files", async () => {
    fs.writeFileSync(path.join(dataDirRef.current, "settings.json"), JSON.stringify({
      binarySourceDefaultsMigrated: true,
      claudeGateway: {
        enabled: true,
        baseUrl: "https://anthropic-gateway.example",
        authToken: "sk-claude",
        model: "claude-sonnet-4-6",
      },
      codexGateway: {
        enabled: true,
        name: "My Gateway",
        baseUrl: "https://openai-gateway.example/v1",
        apiKey: "sk-codex",
        model: "gpt-5.5",
      },
      dpccUpstream: {
        baseUrl: "",
        claudeToken: "",
        codexToken: "",
        claudeModel: "",
        codexModel: "",
      },
    }), "utf-8");

    const { getAppSettings } = await loadModule();

    const settings = getAppSettings();
    expect(settings.claudeGateway.modelMappings.map((m) => m.modelId)).toEqual([
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(settings.codexGateway.modelMappings.map((m) => m.modelId)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ]);
  });
});
