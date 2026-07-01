import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAppFocus, mockLog } = vi.hoisted(() => ({
  mockAppFocus: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    focus: mockAppFocus,
  },
}));

vi.mock("../logger", () => ({
  log: mockLog,
}));

import { reclaimMacDockFocus } from "../macos-dock-focus";

function makeWindow(overrides: Partial<{
  isDestroyed: boolean;
  isVisible: boolean;
  isMinimized: boolean;
}> = {}) {
  return {
    isDestroyed: vi.fn(() => overrides.isDestroyed ?? false),
    isVisible: vi.fn(() => overrides.isVisible ?? true),
    isMinimized: vi.fn(() => overrides.isMinimized ?? false),
    focus: vi.fn(),
  } as unknown as import("electron").BrowserWindow & { focus: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockAppFocus.mockReset();
  mockLog.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reclaimMacDockFocus", () => {
  it("focuses the visible main window on macOS", () => {
    const win = makeWindow();

    reclaimMacDockFocus(() => win, "codex-start", { platform: "darwin", delaysMs: [1] });
    vi.runAllTimers();

    expect(win.focus).toHaveBeenCalledOnce();
    expect(mockAppFocus).toHaveBeenCalledWith({ steal: true });
  });

  it("does nothing on non-macOS platforms", () => {
    const win = makeWindow();

    reclaimMacDockFocus(() => win, "codex-start", { platform: "linux", delaysMs: [1] });
    vi.runAllTimers();

    expect(win.focus).not.toHaveBeenCalled();
    expect(mockAppFocus).not.toHaveBeenCalled();
  });

  it("does not focus destroyed, hidden, or minimized windows", () => {
    for (const win of [
      makeWindow({ isDestroyed: true }),
      makeWindow({ isVisible: false }),
      makeWindow({ isMinimized: true }),
    ]) {
      reclaimMacDockFocus(() => win, "engine-start", { platform: "darwin", delaysMs: [1] });
    }
    vi.runAllTimers();

    expect(mockAppFocus).not.toHaveBeenCalled();
  });
});
