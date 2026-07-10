import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types/settings";

const { effectCleanups } = vi.hoisted(() => ({
  effectCleanups: [] as Array<() => void>,
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") effectCleanups.push(cleanup);
  },
  useRef: <T,>(value: T) => ({ current: value }),
}));

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    codexCliConfigSource: "default",
    cliConfigSource: "default",
    codexBinarySource: "builtin",
    codexCustomBinaryPath: "",
    dpccUpstream: {
      baseUrl: "https://api.dpcc.example",
      claudeToken: "sk-claude",
      codexToken: "sk-codex",
      claudeModel: "claude-default",
      codexModel: "gpt-default",
    },
    codexGateway: {
      enabled: false,
      name: "",
      baseUrl: "",
      apiKey: "",
      model: "",
      modelMappings: [],
    },
    ...overrides,
  } as AppSettings;
}

describe("useCodexModelCatalogSync", () => {
  beforeEach(() => {
    effectCleanups.splice(0);
  });

  it("ignores unrelated settings changes and invalidates an in-flight DPCC load for relevant changes", async () => {
    let onSettingsChanged: ((settings: AppSettings) => void) | undefined;
    const initialSettings = makeSettings();
    vi.stubGlobal("window", {
      claude: {
        settings: {
          get: vi.fn(async () => initialSettings),
          onChanged: vi.fn((callback: (settings: AppSettings) => void) => {
            onSettingsChanged = callback;
            return vi.fn();
          }),
        },
      },
    });
    let isCurrent: (() => boolean) | undefined;
    const prefetchCodexModels = vi.fn((_model: string | undefined, guard?: () => boolean) => {
      isCurrent = guard;
      return new Promise<boolean>(() => {});
    });
    const clearModels = vi.fn();
    const { useCodexModelCatalogSync } = await import("./useCodexModelCatalogSync");

    useCodexModelCatalogSync({
      isCodex: true,
      rawModelCount: 0,
      activeSessionId: "draft",
      preferredModel: "composer-selected",
      prefetchCodexModels,
      clearModels,
    });
    await Promise.resolve();

    expect(prefetchCodexModels).toHaveBeenCalledWith("composer-selected", expect.any(Function));
    expect(isCurrent?.()).toBe(true);

    onSettingsChanged?.(makeSettings({ allowPrereleaseUpdates: true }));
    expect(clearModels).not.toHaveBeenCalled();
    expect(isCurrent?.()).toBe(true);

    onSettingsChanged?.(makeSettings({
      dpccUpstream: { ...initialSettings.dpccUpstream, codexToken: "sk-new" },
    }));
    expect(clearModels).toHaveBeenCalledTimes(1);
    expect(isCurrent?.()).toBe(false);
  });

  it("invalidates an old prefetch when the effect context changes", async () => {
    vi.stubGlobal("window", {
      claude: {
        settings: {
          get: vi.fn(async () => makeSettings()),
          onChanged: vi.fn(() => vi.fn()),
        },
      },
    });
    let isCurrent: (() => boolean) | undefined;
    const { useCodexModelCatalogSync } = await import("./useCodexModelCatalogSync");

    useCodexModelCatalogSync({
      isCodex: true,
      rawModelCount: 0,
      activeSessionId: "session-a",
      preferredModel: "model-a",
      prefetchCodexModels: vi.fn((_model, guard) => {
        isCurrent = guard;
        return new Promise<boolean>(() => {});
      }),
      clearModels: vi.fn(),
    });

    expect(isCurrent?.()).toBe(true);
    effectCleanups[0]?.();
    expect(isCurrent?.()).toBe(false);
  });

  it("invalidates the catalog when the active gateway configuration changes", async () => {
    let onSettingsChanged: ((settings: AppSettings) => void) | undefined;
    const initialSettings = makeSettings({
      codexCliConfigSource: "gateway",
      codexGateway: {
        enabled: true,
        name: "Gateway",
        baseUrl: "https://gateway.example/v1",
        apiKey: "sk-gateway",
        model: "gateway-default",
        modelMappings: [],
      },
    });
    vi.stubGlobal("window", {
      claude: {
        settings: {
          get: vi.fn(async () => initialSettings),
          onChanged: vi.fn((callback: (settings: AppSettings) => void) => {
            onSettingsChanged = callback;
            return vi.fn();
          }),
        },
      },
    });
    const clearModels = vi.fn();
    const { useCodexModelCatalogSync } = await import("./useCodexModelCatalogSync");

    useCodexModelCatalogSync({
      isCodex: false,
      rawModelCount: 0,
      activeSessionId: null,
      prefetchCodexModels: vi.fn(async () => false),
      clearModels,
    });
    await Promise.resolve();

    onSettingsChanged?.(makeSettings({
      ...initialSettings,
      codexGateway: { ...initialSettings.codexGateway, model: "gateway-next" },
    }));
    expect(clearModels).toHaveBeenCalledTimes(1);
  });
});
