import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    const { useSettingsStore } = await import("./settings-store");

    expect(useSettingsStore.getState().islandLayout).toBe(false);
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

    const { useSettingsStore } = await import("./settings-store");

    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("treats repeated active tool writes with the same contents as a no-op", async () => {
    const { useSettingsStore } = await import("./settings-store");

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
    const { useSettingsStore } = await import("./settings-store");

    useSettingsStore.getState().setTransparency(false);
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("false");

    useSettingsStore.getState().setTransparency(true);
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("true");
  });

  it("mirrors mac background effect transparency changes to the legacy preload key", async () => {
    const { useSettingsStore } = await import("./settings-store");

    useSettingsStore.getState().setMacBackgroundEffect("off");
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("false");

    useSettingsStore.getState().setMacBackgroundEffect("liquid-glass");
    expect(localStorage.getItem("pcc-agent-transparency")).toBe("true");
  });
});
