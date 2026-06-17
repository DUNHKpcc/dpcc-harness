import { useEffect, useState } from "react";
import type { MacBackgroundEffect, Space } from "@/types";
import { computeGlassTintColor } from "@/lib/color-utils";
import { isMac, isWindows } from "@/lib/utils";

const TINT_VARS = [
  "--space-hue", "--space-chroma",
  "--background", "--accent", "--border",
  "--muted", "--secondary", "--card", "--input",
  "--sidebar", "--sidebar-accent", "--sidebar-border",
  "--island-overlay-bg", "--island-fill",
];

const DARK_SURFACE_BRIGHTNESS_MULTIPLIER = 1.3;
const LIGHT_SURFACE_WHITE_MIX = 0.3;
const NON_NATIVE_TINT_DARKEN_FACTOR = 0.25;
const BASE_TINT_OVERLAY_LIGHTNESS = 0.5;
const NEUTRAL_HUE = 0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getTintStrength(chroma: number): number {
  const normalized = clamp01(chroma / 0.3);
  return Math.pow(normalized, 0.8);
}

function brightenDarkLightness(value: number): number {
  return clamp01(value * DARK_SURFACE_BRIGHTNESS_MULTIPLIER);
}

function brightenLightLightness(value: number): number {
  return clamp01(value + (1 - value) * LIGHT_SURFACE_WHITE_MIX);
}

function darkenTintLightness(value: number, isDark: boolean, enabled: boolean): number {
  if (!enabled) return clamp01(value);
  if (isDark) return clamp01(value * (1 - NON_NATIVE_TINT_DARKEN_FACTOR));
  return clamp01(1 - (1 - value) * (1 + NON_NATIVE_TINT_DARKEN_FACTOR));
}

function darkenShellLightness(value: number, enabled: boolean): number {
  if (!enabled) return clamp01(value);
  return clamp01(value * (1 - NON_NATIVE_TINT_DARKEN_FACTOR));
}

function applySidebarTokens(
  root: HTMLElement,
  options: {
    isDark: boolean;
    isGlass: boolean;
    hue: number;
    tintStrength: number;
    sidebarChroma: number;
    surfaceChroma: number;
    borderChroma: number;
    sidebarLightness: number;
    sidebarAccentLightness: number;
    sidebarBorderLightness: number;
  },
): void {
  const {
    isDark,
    isGlass,
    hue,
    tintStrength,
    sidebarChroma,
    surfaceChroma,
    borderChroma,
    sidebarLightness,
    sidebarAccentLightness,
    sidebarBorderLightness,
  } = options;

  if (!isGlass) {
    root.style.setProperty("--sidebar", `oklch(${sidebarLightness} ${sidebarChroma} ${hue})`);
    root.style.setProperty("--sidebar-accent", `oklch(${sidebarAccentLightness} ${surfaceChroma} ${hue})`);
    root.style.setProperty("--sidebar-border", `oklch(${sidebarBorderLightness} ${borderChroma} ${hue})`);
    return;
  }

  if (isDark) {
    root.style.setProperty(
      "--sidebar",
      `oklch(${sidebarLightness} ${sidebarChroma} ${hue} / ${0.34 + 0.08 * tintStrength})`,
    );
    root.style.setProperty(
      "--sidebar-accent",
      `oklch(${sidebarAccentLightness} ${surfaceChroma} ${hue} / ${0.46 + 0.08 * tintStrength})`,
    );
    root.style.setProperty(
      "--sidebar-border",
      `oklch(${sidebarBorderLightness} ${borderChroma} ${hue} / ${0.32 + 0.06 * tintStrength})`,
    );
    return;
  }

  root.style.setProperty(
    "--sidebar",
    `oklch(${sidebarLightness} ${sidebarChroma} ${hue} / ${0.22 + 0.12 * tintStrength})`,
  );
  root.style.setProperty(
    "--sidebar-accent",
    `oklch(${sidebarAccentLightness} ${surfaceChroma} ${hue} / ${0.22 + 0.14 * tintStrength})`,
  );
  root.style.setProperty(
    "--sidebar-border",
    `oklch(${sidebarBorderLightness} ${borderChroma} ${hue} / ${0.08 + 0.08 * tintStrength})`,
  );
}

function bindNativeGlassTintOnFocus(tintColor: string | null): () => void {
  const applyTint = () => window.claude.glass?.setTintColor(tintColor);
  applyTint();
  window.addEventListener("focus", applyTint);
  return () => window.removeEventListener("focus", applyTint);
}

/**
 * Applies the active space's color tint to CSS custom properties on the document root.
 * Handles dark/light mode branching and glass/non-glass transparency.
 *
 * On macOS with native glass, sends tintColor to the main process via IPC so
 * the glass material is tinted natively (higher quality than CSS overlay).
 * Falls back to CSS overlay on non-macOS platforms (Windows Mica, etc.).
 *
 * Returns the glass overlay style object (or null) for the tint overlay div.
 */
export function useSpaceTheme(
  activeSpace: Space | undefined,
  resolvedTheme: string,
  isGlassActive: boolean,
  macBackgroundEffect: MacBackgroundEffect,
): React.CSSProperties | null {
  const [glassOverlayStyle, setGlassOverlayStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    const space = activeSpace;
    const root = document.documentElement;
    const isGlass = isGlassActive;
    const isDark = resolvedTheme === "dark";
    // Native macOS glass supports tintColor via addView()
    const isNativeGlass = isGlass && isMac && macBackgroundEffect === "liquid-glass";
    const isWindowsMica = isGlass && isWindows;
    // Darken the shell ONLY when glass is rendered via the non-native CSS/vibrancy
    // fallback (to compensate for its lighter material). When there is no glass at
    // all (opaque window, e.g. pre-Tahoe macOS), darkening must NOT apply — it would
    // turn the near-white sidebar into a muddy gray. The missing `isGlass` guard here
    // was the cause of the "灰蒙蒙" opaque sidebar.
    const shouldDarkenTint = isGlass && !isNativeGlass && !isWindowsMica;
    const neutralTintStrength = 0;
    const neutralSidebarChroma = 0;
    const neutralSurfaceChroma = 0;
    const neutralBorderChroma = 0;
    const neutralLightSidebarLightness = darkenShellLightness(
      isGlass ? 1 : 0.99,
      shouldDarkenTint,
    );
    const neutralLightSidebarAccentLightness = darkenShellLightness(
      0.976,
      shouldDarkenTint,
    );
    const neutralLightSidebarBorderLightness = darkenShellLightness(
      isGlass ? 0 : 0.945,
      shouldDarkenTint,
    );
    const neutralDarkSidebarLightness = darkenShellLightness(
      isGlass ? 0.139 : 0.254,
      shouldDarkenTint,
    );
    const neutralDarkSidebarAccentLightness = darkenShellLightness(
      isGlass ? 0.334 : 0.411,
      shouldDarkenTint,
    );
    const neutralDarkSidebarBorderLightness = darkenShellLightness(
      isGlass ? 0.468 : 0.494,
      shouldDarkenTint,
    );

    if (!space || space.color.chroma === 0) {
      // Clear all tinted vars so the CSS base values take over
      for (const v of TINT_VARS) root.style.removeProperty(v);
      if (shouldDarkenTint) {
        applySidebarTokens(root, {
          isDark,
          isGlass,
          hue: NEUTRAL_HUE,
          tintStrength: neutralTintStrength,
          sidebarChroma: neutralSidebarChroma,
          surfaceChroma: neutralSurfaceChroma,
          borderChroma: neutralBorderChroma,
          sidebarLightness: isDark ? neutralDarkSidebarLightness : neutralLightSidebarLightness,
          sidebarAccentLightness: isDark ? neutralDarkSidebarAccentLightness : neutralLightSidebarAccentLightness,
          sidebarBorderLightness: isDark ? neutralDarkSidebarBorderLightness : neutralLightSidebarBorderLightness,
        });
      }
      setGlassOverlayStyle(
        isGlass && shouldDarkenTint
          ? { background: `oklch(0 0 0 / ${NON_NATIVE_TINT_DARKEN_FACTOR})` }
          : null,
      );
      const releaseFocusTint = isNativeGlass
        ? bindNativeGlassTintOnFocus(null)
        : null;

      // Still apply opacity even for colorless (default) space
      const opacity = space?.color.opacity;
      if (opacity !== undefined && opacity < 1) {
        const darkBase = brightenDarkLightness(0.107);
        const bg = isDark ? `oklch(${darkBase} 0 0 / ${opacity})` : `oklch(1 0 0 / ${opacity})`;
        root.style.setProperty("--island-fill", bg);
      } else {
        root.style.removeProperty("--island-fill");
      }

      return () => {
        releaseFocusTint?.();
        if (isNativeGlass) window.claude.glass?.setTintColor(null);
      };
    }

    const { hue, chroma } = space.color;
    const opacity = space.color.opacity ?? 1;
    const tintStrength = getTintStrength(chroma);
    const bgChroma = (isDark ? 0.028 : 0.04) * tintStrength;
    const surfaceChroma = (isDark ? 0.04 : 0.055) * tintStrength;
    const borderChroma = (isDark ? 0.026 : 0.034) * tintStrength;
    const sidebarChroma = (isDark ? 0.024 : 0.03) * tintStrength;
    const lightBgLightness = darkenTintLightness(
      brightenLightLightness(0.985 - 0.012 * tintStrength),
      false,
      shouldDarkenTint,
    );
    const lightSurfaceLightness = darkenTintLightness(
      brightenLightLightness(0.955 - 0.02 * tintStrength),
      false,
      shouldDarkenTint,
    );
    const lightBorderLightness = darkenTintLightness(
      brightenLightLightness(0.91),
      false,
      shouldDarkenTint,
    );
    const lightCardLightness = darkenTintLightness(
      brightenLightLightness(0.98),
      false,
      shouldDarkenTint,
    );
    const lightSidebarLightness = darkenTintLightness(
      brightenLightLightness(0.968),
      false,
      shouldDarkenTint,
    );
    const lightSidebarAccentLightness = darkenTintLightness(
      brightenLightLightness(0.947),
      false,
      shouldDarkenTint,
    );
    const darkBgLightness = darkenTintLightness(
      brightenDarkLightness(0.12 - 0.013 * tintStrength),
      true,
      shouldDarkenTint,
    );
    const darkSurfaceLightness = darkenTintLightness(
      brightenDarkLightness(0.355 - 0.04 * tintStrength),
      true,
      shouldDarkenTint,
    );
    const darkBorderLightness = darkenTintLightness(
      brightenDarkLightness(0.39),
      true,
      shouldDarkenTint,
    );
    const darkCardLightness = darkenTintLightness(
      brightenDarkLightness(0.25),
      true,
      shouldDarkenTint,
    );
    const darkSidebarLightness = darkenTintLightness(
      brightenDarkLightness(0.2),
      true,
      shouldDarkenTint,
    );
    const darkSidebarAccentLightness = darkenTintLightness(
      brightenDarkLightness(0.31),
      true,
      shouldDarkenTint,
    );
    const darkSidebarBorderLightness = darkenTintLightness(
      brightenDarkLightness(0.4),
      true,
      shouldDarkenTint,
    );
    const shellLightSidebarLightness = darkenShellLightness(
      brightenLightLightness(0.968),
      shouldDarkenTint,
    );
    const shellLightSidebarAccentLightness = darkenShellLightness(
      brightenLightLightness(0.947),
      shouldDarkenTint,
    );
    const shellLightSidebarBorderLightness = darkenShellLightness(
      brightenLightLightness(0.91),
      shouldDarkenTint,
    );
    const shellDarkSidebarLightness = darkenShellLightness(
      brightenDarkLightness(0.2),
      shouldDarkenTint,
    );
    const shellDarkSidebarAccentLightness = darkenShellLightness(
      brightenDarkLightness(0.31),
      shouldDarkenTint,
    );
    const shellDarkSidebarBorderLightness = darkenShellLightness(
      brightenDarkLightness(0.4),
      shouldDarkenTint,
    );

    root.style.setProperty("--space-hue", String(hue));
    root.style.setProperty("--space-chroma", String(chroma));

    if (isDark) {
      root.style.setProperty("--background", `oklch(${darkBgLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(${darkBorderLightness} ${borderChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(${darkSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(${darkCardLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(${darkBorderLightness} ${borderChroma} ${hue})`);
      // Island fill with alpha for per-space opacity (--background stays opaque for gradient fades)
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(${darkBgLightness} ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      applySidebarTokens(root, {
        isDark,
        isGlass,
        hue,
        tintStrength,
        sidebarChroma,
        surfaceChroma,
        borderChroma,
        sidebarLightness: isGlass ? shellDarkSidebarLightness : darkSidebarLightness,
        sidebarAccentLightness: isGlass ? shellDarkSidebarAccentLightness : darkSidebarAccentLightness,
        sidebarBorderLightness: isGlass ? shellDarkSidebarBorderLightness : darkSidebarBorderLightness,
      });
    } else {
      root.style.setProperty("--background", `oklch(${lightBgLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--accent", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--border", `oklch(${lightBorderLightness} ${borderChroma} ${hue})`);
      root.style.setProperty("--muted", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--secondary", `oklch(${lightSurfaceLightness} ${surfaceChroma} ${hue})`);
      root.style.setProperty("--card", `oklch(${lightCardLightness} ${bgChroma} ${hue})`);
      root.style.setProperty("--input", `oklch(${lightBorderLightness} ${borderChroma} ${hue})`);
      // Island fill with alpha for per-space opacity
      if (opacity < 1) {
        root.style.setProperty("--island-fill", `oklch(${lightBgLightness} ${bgChroma} ${hue} / ${opacity})`);
      } else {
        root.style.removeProperty("--island-fill");
      }
      applySidebarTokens(root, {
        isDark,
        isGlass,
        hue,
        tintStrength,
        sidebarChroma,
        surfaceChroma,
        borderChroma,
        sidebarLightness: isGlass ? shellLightSidebarLightness : lightSidebarLightness,
        sidebarAccentLightness: isGlass ? shellLightSidebarAccentLightness : lightSidebarAccentLightness,
        sidebarBorderLightness: isGlass ? shellLightSidebarBorderLightness : lightBorderLightness,
      });
    }

    const gradientHue = space.color.gradientHue;
    const overlayChroma = Math.min(0.18, 0.04 + 0.12 * tintStrength);
    const overlayLightness = shouldDarkenTint
      ? BASE_TINT_OVERLAY_LIGHTNESS * (1 - NON_NATIVE_TINT_DARKEN_FACTOR)
      : BASE_TINT_OVERLAY_LIGHTNESS;

    // ── Glass tinting ──
    let releaseFocusTint: (() => void) | null = null;
    if (isNativeGlass) {
      // Native macOS glass tinting via addView({ tintColor }).
      const hexTint = computeGlassTintColor(space.color);
      releaseFocusTint = bindNativeGlassTintOnFocus(hexTint);
      // Native tint handles the glass material — no CSS overlay needed
      setGlassOverlayStyle(null);
    } else if (isGlass) {
      // Non-macOS glass (Windows Mica, etc.) — CSS overlay for tinting
      const a = 0.04 + 0.12 * tintStrength;
      const bg = gradientHue !== undefined
        ? `linear-gradient(135deg, oklch(${overlayLightness} ${overlayChroma} ${hue} / ${a}), oklch(${overlayLightness} ${overlayChroma} ${gradientHue} / ${a}))`
        : `oklch(${overlayLightness} ${overlayChroma} ${hue} / ${a})`;
      setGlassOverlayStyle({ background: bg });
    } else {
      setGlassOverlayStyle(null);
    }

    if (gradientHue !== undefined) {
      const a = 0.035 + 0.115 * tintStrength;
      // Set CSS custom prop so .island::before picks up the gradient on ALL islands
      root.style.setProperty(
        "--island-overlay-bg",
        `linear-gradient(135deg, oklch(${overlayLightness} ${overlayChroma} ${hue} / ${a}), oklch(${overlayLightness} ${overlayChroma} ${gradientHue} / ${a}))`,
      );
    } else {
      root.style.removeProperty("--island-overlay-bg");
    }

    return () => {
      releaseFocusTint?.();
      for (const v of TINT_VARS) root.style.removeProperty(v);
      setGlassOverlayStyle(null);
      if (isNativeGlass) window.claude.glass?.setTintColor(null);
    };
  }, [activeSpace, resolvedTheme, isGlassActive, macBackgroundEffect]);

  return glassOverlayStyle;
}
