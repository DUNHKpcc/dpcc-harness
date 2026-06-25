import { describe, expect, it } from "vitest";
import { getInitialGlassSupported } from "./useGlassOrchestrator";

describe("useGlassOrchestrator", () => {
  it("treats Windows glass support as known on first render", () => {
    expect(getInitialGlassSupported({ isWindowsPlatform: true })).toBe(true);
  });

  it("waits for IPC support detection on non-Windows platforms", () => {
    expect(getInitialGlassSupported({ isWindowsPlatform: false })).toBe(false);
  });
});
