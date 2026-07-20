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

  it("migrates the legacy DPCC API host to the origin upstream", async () => {
    const settingsPath = path.join(dataDirRef.current, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      binarySourceDefaultsMigrated: true,
      dpccUpstream: {
        baseUrl: "https://api.dpccgaming.xyz/v1/",
        claudeToken: "sk-claude",
        codexToken: "sk-codex",
        claudeModel: "",
        codexModel: "",
      },
    }), "utf-8");

    const { getAppSettings } = await loadModule();

    expect(getAppSettings().dpccUpstream.baseUrl).toBe("https://origin-api.dpccgaming.xyz");
    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      dpccUpstream: { baseUrl: string };
    };
    expect(persisted.dpccUpstream.baseUrl).toBe("https://origin-api.dpccgaming.xyz");
  });

  it("normalizes the legacy DPCC API host when settings are saved", async () => {
    const settingsPath = path.join(dataDirRef.current, "settings.json");
    const { setAppSettings } = await loadModule();

    const settings = setAppSettings({
      dpccUpstream: {
        baseUrl: "https://api.dpccgaming.xyz/v1/",
        claudeToken: "sk-claude",
        codexToken: "sk-codex",
        claudeModel: "",
        codexModel: "",
      },
    });

    expect(settings.dpccUpstream.baseUrl).toBe("https://origin-api.dpccgaming.xyz");
    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      dpccUpstream: { baseUrl: string };
    };
    expect(persisted.dpccUpstream.baseUrl).toBe("https://origin-api.dpccgaming.xyz");
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

  it("preserves legacy third-party gateway routing by selecting the gateway source", async () => {
    const settingsPath = path.join(dataDirRef.current, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
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
    expect(settings.cliConfigSource).toBe("gateway");
    expect(settings.claudeCliConfigSource).toBe("gateway");
    expect(settings.codexCliConfigSource).toBe("gateway");

    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      cliConfigSource: string;
      claudeCliConfigSource: string;
      codexCliConfigSource: string;
    };
    expect(persisted.cliConfigSource).toBe("gateway");
    expect(persisted.claudeCliConfigSource).toBe("gateway");
    expect(persisted.codexCliConfigSource).toBe("gateway");
  });

  it("keeps legacy DPCC gateway credentials on the default source after migration", async () => {
    fs.writeFileSync(path.join(dataDirRef.current, "settings.json"), JSON.stringify({
      binarySourceDefaultsMigrated: true,
      claudeGateway: {
        enabled: true,
        baseUrl: "https://api.dpccgaming.xyz",
        authToken: "sk-dpcc-claude",
        model: "dpcc-claude",
      },
      codexGateway: {
        enabled: true,
        name: "DPCC",
        baseUrl: "https://api.dpccgaming.xyz/v1",
        apiKey: "sk-dpcc-codex",
        model: "dpcc-codex",
      },
    }), "utf-8");

    const { getAppSettings } = await loadModule();

    const settings = getAppSettings();
    expect(settings.cliConfigSource).toBe("default");
    expect(settings.claudeCliConfigSource).toBe("default");
    expect(settings.codexCliConfigSource).toBe("default");
    expect(settings.dpccUpstream).toMatchObject({
      claudeToken: "sk-dpcc-claude",
      codexToken: "sk-dpcc-codex",
    });
  });

  it("cleans DPCC-shaped gateway settings even after dpccUpstream has been created", async () => {
    fs.writeFileSync(path.join(dataDirRef.current, "settings.json"), JSON.stringify({
      binarySourceDefaultsMigrated: true,
      cliConfigSource: "default",
      claudeCliConfigSource: "local",
      codexCliConfigSource: "gateway",
      claudeGateway: {
        enabled: false,
        baseUrl: "https://api.dpccgaming.xyz",
        authToken: "sk-legacy-claude",
        model: "",
      },
      codexGateway: {
        enabled: true,
        name: "DPCC API",
        baseUrl: "https://api.dpccgaming.xyz/v1",
        apiKey: "sk-legacy-codex",
        model: "",
      },
      dpccUpstream: {
        baseUrl: "https://api.dpccgaming.xyz",
        claudeToken: "sk-current-claude",
        codexToken: "sk-current-codex",
        claudeModel: "",
        codexModel: "",
      },
    }), "utf-8");

    const { getAppSettings } = await loadModule();

    const settings = getAppSettings();
    expect(settings.claudeGateway).toMatchObject({ enabled: false, baseUrl: "", authToken: "" });
    expect(settings.codexGateway).toMatchObject({ enabled: false, baseUrl: "", apiKey: "" });
    expect(settings.claudeCliConfigSource).toBe("local");
    expect(settings.codexCliConfigSource).toBe("default");
    expect(settings.dpccUpstream).toMatchObject({
      claudeToken: "sk-current-claude",
      codexToken: "sk-current-codex",
    });
  });

  it("preserves explicit per-engine config sources over the legacy shared source", async () => {
    const settingsPath = path.join(dataDirRef.current, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      binarySourceDefaultsMigrated: true,
      cliConfigSource: "local",
      claudeCliConfigSource: "gateway",
      codexCliConfigSource: "default",
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
    expect(settings.cliConfigSource).toBe("local");
    expect(settings.claudeCliConfigSource).toBe("gateway");
    expect(settings.codexCliConfigSource).toBe("default");

    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      claudeCliConfigSource: string;
      codexCliConfigSource: string;
    };
    expect(persisted.claudeCliConfigSource).toBe("gateway");
    expect(persisted.codexCliConfigSource).toBe("default");
  });

  it("falls back invalid per-engine config sources to the legacy shared source", async () => {
    const settingsPath = path.join(dataDirRef.current, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      binarySourceDefaultsMigrated: true,
      cliConfigSource: "local",
      claudeCliConfigSource: "bad-source",
      codexCliConfigSource: "gateway",
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
    expect(settings.claudeCliConfigSource).toBe("local");
    expect(settings.codexCliConfigSource).toBe("gateway");

    const persisted = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      claudeCliConfigSource: string;
      codexCliConfigSource: string;
    };
    expect(persisted.claudeCliConfigSource).toBe("local");
    expect(persisted.codexCliConfigSource).toBe("gateway");
  });

  it("throws when settings cannot be persisted", async () => {
    const { setAppSettings } = await loadModule();
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });

    expect(() => setAppSettings({ cliConfigSource: "gateway" })).toThrow("disk full");

    writeSpy.mockRestore();
  });
});
