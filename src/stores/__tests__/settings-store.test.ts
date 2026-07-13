import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredThemeSource } from "@shared/lib/theme-storage";

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("settings store", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorage = createLocalStorageMock();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: { localStorage },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults new installs to flat layout", async () => {
    const { useSettingsStore } = await import("../settings-store");

    expect(useSettingsStore.getState().islandLayout).toBe(false);
  });

  it("mirrors theme changes to the legacy bootstrap key", async () => {
    const { useSettingsStore } = await import("../settings-store");

    useSettingsStore.getState().setTheme("light");

    expect(useSettingsStore.getState().theme).toBe("light");
    expect(localStorage.getItem("pcc-agent-theme")).toBe("light");
  });

  it("persists the canonical theme when the legacy mirror cannot be written", async () => {
    const { useSettingsStore } = await import("../settings-store");
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "pcc-agent-theme") throw new Error("legacy storage unavailable");
      originalSetItem(key, value);
    });

    expect(() => useSettingsStore.getState().setTheme("light")).not.toThrow();

    expect(useSettingsStore.getState().theme).toBe("light");
    const persisted = JSON.parse(localStorage.getItem("pcc-agent-settings-store") ?? "{}");
    expect(persisted.state?.theme).toBe("light");
  });

  it("does not touch Node's global localStorage when no renderer window exists", async () => {
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("Node localStorage should not be used by settings-store tests");
      },
      configurable: true,
    });

    const { useSettingsStore } = await import("../settings-store");

    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("treats repeated active tool writes with the same contents as a no-op", async () => {
    const { useSettingsStore } = await import("../settings-store");

    useSettingsStore.getState().setActiveTools("project-1", ["tasks"]);
    const firstProjects = useSettingsStore.getState().projects;
    const firstActiveTools = firstProjects["project-1"]?.activeTools;

    useSettingsStore.getState().setActiveTools("project-1", ["tasks"]);
    const secondProjects = useSettingsStore.getState().projects;

    expect(secondProjects).toBe(firstProjects);
    expect(secondProjects["project-1"]?.activeTools).toBe(firstActiveTools);
    expect(secondProjects["project-1"]?.activeTools).toEqual(["tasks"]);
  });

  it("mirrors transparency changes to the legacy key used by preload startup", async () => {
    const { useSettingsStore } = await import("../settings-store");

    useSettingsStore.getState().setTransparency(false);
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("false");

    useSettingsStore.getState().setTransparency(true);
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("true");
  });

  it("mirrors mac background effect transparency changes to the legacy preload key", async () => {
    const { useSettingsStore } = await import("../settings-store");

    useSettingsStore.getState().setMacBackgroundEffect("off");
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("false");

    useSettingsStore.getState().setMacBackgroundEffect("liquid-glass");
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("true");
  });

  it("reads models from the target project instead of the currently active project", async () => {
    const { selectProjectModelForEngine, useSettingsStore } = await import("../settings-store");

    useSettingsStore.getState().setModelForEngine("project-a", "claude", "model-a");
    useSettingsStore.getState().setModelForEngine("project-b", "claude", "model-b");
    useSettingsStore.getState().setModelForEngine("__harnss_chat__", "codex", "chat-model");

    const state = useSettingsStore.getState();
    expect(selectProjectModelForEngine(state, "project-a", "claude")).toBe("model-a");
    expect(selectProjectModelForEngine(state, "project-b", "claude")).toBe("model-b");
    expect(selectProjectModelForEngine(state, "__harnss_chat__", "codex")).toBe("chat-model");
    expect(selectProjectModelForEngine(state, "unconfigured", "claude")).toBe("default");
    expect(selectProjectModelForEngine(state, "unconfigured", "codex")).toBe("");
  });
});

describe("readStoredThemeSource", () => {
  const storage = (values: Record<string, string>) => ({
    getItem: (key: string) => values[key] ?? null,
  });

  it("prefers the canonical Zustand theme over a stale legacy value", () => {
    expect(readStoredThemeSource(storage({
      "pcc-agent-settings-store": JSON.stringify({ state: { theme: "light" } }),
      "pcc-agent-theme": "dark",
    }))).toBe("light");
  });

  it("falls back to the legacy theme when canonical state is unavailable", () => {
    expect(readStoredThemeSource(storage({
      "pcc-agent-settings-store": "invalid-json",
      "pcc-agent-theme": "system",
    }))).toBe("system");
  });

  it("uses dark when neither storage source contains a valid theme", () => {
    expect(readStoredThemeSource(storage({}))).toBe("dark");
  });
});
