import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_CUSTOMIZATION,
  applyThemeCustomization,
  normalizeThemeCustomization,
  parseThemeCustomization,
  serializeThemeCustomization,
} from "../theme-customization";

describe("theme customization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes colors, enums, booleans, and contrast values", () => {
    expect(normalizeThemeCustomization({
      accentColor: "#CC7D5E",
      lightBackgroundColor: "#F9F9F7",
      lightForegroundColor: "#2D2D2B",
      darkBackgroundColor: "invalid",
      uiFontFamily: "instrument-serif",
      uiFontWeight: "700",
      codeFontFamily: "courier",
      codeFontWeight: "not-a-weight",
      sidebarTransparency: true,
      contrast: 140.4,
    })).toEqual({
      ...DEFAULT_THEME_CUSTOMIZATION,
      accentColor: "#cc7d5e",
      lightBackgroundColor: "#f9f9f7",
      lightForegroundColor: "#2d2d2b",
      darkBackgroundColor: null,
      uiFontFamily: "instrument-serif",
      uiFontWeight: "700",
      codeFontFamily: "courier",
      sidebarTransparency: true,
      contrast: 100,
    });
  });

  it("serializes and parses a versioned theme configuration", () => {
    const serialized = serializeThemeCustomization({
      ...DEFAULT_THEME_CUSTOMIZATION,
      accentColor: "#CC7D5E",
      contrast: 45.4,
    });

    expect(JSON.parse(serialized)).toMatchObject({ version: 1, accentColor: "#cc7d5e" });
    expect(parseThemeCustomization(serialized)).toMatchObject({
      accentColor: "#cc7d5e",
      contrast: 45,
    });
    expect(parseThemeCustomization('{"version":2,"accentColor":"#cc7d5e"}')).toBeNull();
    expect(parseThemeCustomization('{"notATheme":true}')).toBeNull();
  });

  it("applies theme variables and removes optional overrides on reset", () => {
    const setProperty = vi.fn();
    const removeProperty = vi.fn();
    const toggle = vi.fn();
    vi.stubGlobal("document", {
      documentElement: {
        style: { setProperty, removeProperty },
        classList: { toggle },
      },
    });

    applyThemeCustomization({
      ...DEFAULT_THEME_CUSTOMIZATION,
      accentColor: "#CC7D5E",
      lightBackgroundColor: "#F9F9F7",
      uiFontFamily: "instrument-serif",
      codeFontFamily: "courier",
      uiFontWeight: "600",
      codeFontWeight: "500",
      sidebarTransparency: true,
      contrast: 45,
    });

    expect(setProperty).toHaveBeenCalledWith("--theme-accent", "#cc7d5e");
    expect(setProperty).toHaveBeenCalledWith("--theme-light-background", "#f9f9f7");
    expect(setProperty).toHaveBeenCalledWith("--theme-ui-weight", "600");
    expect(setProperty).toHaveBeenCalledWith("--theme-code-weight", "500");
    expect(setProperty).toHaveBeenCalledWith("--theme-contrast", "45");
    expect(toggle).toHaveBeenCalledWith("theme-sidebar-transparent", true);

    applyThemeCustomization(DEFAULT_THEME_CUSTOMIZATION);
    expect(removeProperty).toHaveBeenCalledWith("--theme-accent");
    expect(removeProperty).toHaveBeenCalledWith("--theme-light-background");
    expect(removeProperty).toHaveBeenCalledWith("--theme-ui-font");
    expect(toggle).toHaveBeenCalledWith("theme-sidebar-transparent", false);
  });
});
