import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAccentColor,
  getAccentForeground,
  normalizeAccentColor,
} from "../theme-colors";

describe("theme colors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts six-digit hex colors and normalizes their casing", () => {
    expect(normalizeAccentColor("#3B82F6")).toBe("#3b82f6");
    expect(normalizeAccentColor("#fff")).toBeNull();
    expect(normalizeAccentColor("red")).toBeNull();
  });

  it("chooses readable foreground colors", () => {
    expect(getAccentForeground("#ffffff")).toBe("#1c1917");
    expect(getAccentForeground("#000000")).toBe("#fffaf5");
  });

  it("applies and removes the renderer CSS overrides", () => {
    const setProperty = vi.fn();
    const removeProperty = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { style: { setProperty, removeProperty } },
    });

    applyAccentColor("#3B82F6");
    expect(setProperty).toHaveBeenCalledWith("--theme-accent", "#3b82f6");
    expect(setProperty).toHaveBeenCalledWith(
      "--theme-accent-foreground",
      "#1c1917",
    );

    applyAccentColor(null);
    expect(removeProperty).toHaveBeenCalledWith("--theme-accent");
    expect(removeProperty).toHaveBeenCalledWith("--theme-accent-foreground");
  });
});
