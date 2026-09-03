import { getAccentForeground, normalizeAccentColor } from "@/lib/theme-colors";
import { isRecord } from "@/lib/utils";

export type UiFontFamily = "system" | "source-serif" | "instrument-serif";
export type CodeFontFamily = "system" | "cascadia" | "courier";
export type ThemeFontWeight = "400" | "500" | "600" | "700";

export interface ThemeCustomization {
  accentColor: string | null;
  lightBackgroundColor: string | null;
  lightForegroundColor: string | null;
  darkBackgroundColor: string | null;
  darkForegroundColor: string | null;
  uiFontFamily: UiFontFamily;
  uiFontWeight: ThemeFontWeight;
  codeFontFamily: CodeFontFamily;
  codeFontWeight: ThemeFontWeight;
  sidebarTransparency: boolean;
  contrast: number;
}

export const DEFAULT_LIGHT_BACKGROUND_COLOR = "#faf9f5";
export const DEFAULT_LIGHT_FOREGROUND_COLOR = "#2d2d2b";
export const DEFAULT_DARK_BACKGROUND_COLOR = "#252422";
export const DEFAULT_DARK_FOREGROUND_COLOR = "#f9f8f4";

export const DEFAULT_THEME_CUSTOMIZATION: ThemeCustomization = {
  accentColor: null,
  lightBackgroundColor: null,
  lightForegroundColor: null,
  darkBackgroundColor: null,
  darkForegroundColor: null,
  uiFontFamily: "system",
  uiFontWeight: "400",
  codeFontFamily: "system",
  codeFontWeight: "400",
  sidebarTransparency: false,
  contrast: 45,
};

const UI_FONT_FAMILIES: UiFontFamily[] = ["system", "source-serif", "instrument-serif"];
const CODE_FONT_FAMILIES: CodeFontFamily[] = ["system", "cascadia", "courier"];
const FONT_WEIGHTS: ThemeFontWeight[] = ["400", "500", "600", "700"];

function isEnumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.some((item) => item === value);
}

function asEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return isEnumValue(value, values) ? value : fallback;
}

function normalizeThemeColor(value: unknown): string | null {
  return normalizeAccentColor(value);
}

function normalizeContrast(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.max(0, Math.min(100, value)));
}

/** Normalize imported or persisted theme data while preserving current defaults. */
export function normalizeThemeCustomization(
  value: unknown,
  fallback: ThemeCustomization = DEFAULT_THEME_CUSTOMIZATION,
): ThemeCustomization {
  if (!isRecord(value)) return fallback;

  return {
    accentColor: value.accentColor === undefined
      ? fallback.accentColor
      : normalizeThemeColor(value.accentColor),
    lightBackgroundColor: value.lightBackgroundColor === undefined
      ? fallback.lightBackgroundColor
      : normalizeThemeColor(value.lightBackgroundColor),
    lightForegroundColor: value.lightForegroundColor === undefined
      ? fallback.lightForegroundColor
      : normalizeThemeColor(value.lightForegroundColor),
    darkBackgroundColor: value.darkBackgroundColor === undefined
      ? fallback.darkBackgroundColor
      : normalizeThemeColor(value.darkBackgroundColor),
    darkForegroundColor: value.darkForegroundColor === undefined
      ? fallback.darkForegroundColor
      : normalizeThemeColor(value.darkForegroundColor),
    uiFontFamily: asEnum(value.uiFontFamily, UI_FONT_FAMILIES, fallback.uiFontFamily),
    uiFontWeight: asEnum(value.uiFontWeight, FONT_WEIGHTS, fallback.uiFontWeight),
    codeFontFamily: asEnum(value.codeFontFamily, CODE_FONT_FAMILIES, fallback.codeFontFamily),
    codeFontWeight: asEnum(value.codeFontWeight, FONT_WEIGHTS, fallback.codeFontWeight),
    sidebarTransparency: typeof value.sidebarTransparency === "boolean"
      ? value.sidebarTransparency
      : fallback.sidebarTransparency,
    contrast: normalizeContrast(value.contrast, fallback.contrast),
  };
}

export function serializeThemeCustomization(theme: ThemeCustomization): string {
  return JSON.stringify({ version: 1, ...normalizeThemeCustomization(theme) }, null, 2);
}

export function parseThemeCustomization(value: string): ThemeCustomization | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== undefined && parsed.version !== 1) return null;
    const payload = isRecord(parsed.theme) ? parsed.theme : parsed;
    const supportedKeys = [
      "accentColor", "lightBackgroundColor", "lightForegroundColor",
      "darkBackgroundColor", "darkForegroundColor", "uiFontFamily",
      "uiFontWeight", "codeFontFamily", "codeFontWeight",
      "sidebarTransparency", "contrast",
    ];
    if (!supportedKeys.some((key) => key in payload)) return null;
    return normalizeThemeCustomization(payload);
  } catch {
    return null;
  }
}

function getUiFontFamily(family: UiFontFamily): string | null {
  if (family === "source-serif") {
    return '"Source Serif 4 Variable", "Noto Serif SC Variable", Georgia, "Songti SC", STSong, serif';
  }
  if (family === "instrument-serif") {
    return '"Instrument Serif", "Noto Serif SC Variable", Georgia, "Songti SC", STSong, serif';
  }
  return null;
}

function getCodeFontFamily(family: CodeFontFamily): string | null {
  if (family === "cascadia") {
    return '"Cascadia Code", "SFMono-Regular", Consolas, monospace';
  }
  if (family === "courier") {
    return '"Courier New", Courier, monospace';
  }
  return null;
}

function setOrRemove(root: HTMLElement, name: string, value: string | null): void {
  if (value) root.style.setProperty(name, value);
  else root.style.removeProperty(name);
}

/** Apply theme customization to the renderer without replacing the theme mode. */
export function applyThemeCustomization(theme: ThemeCustomization): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const normalized = normalizeThemeCustomization(theme);
  const accentColor = normalized.accentColor;

  setOrRemove(root, "--theme-accent", accentColor);
  setOrRemove(root, "--theme-accent-foreground", accentColor ? getAccentForeground(accentColor) : null);
  setOrRemove(root, "--theme-light-background", normalized.lightBackgroundColor);
  setOrRemove(root, "--theme-light-foreground", normalized.lightForegroundColor);
  setOrRemove(root, "--theme-dark-background", normalized.darkBackgroundColor);
  setOrRemove(root, "--theme-dark-foreground", normalized.darkForegroundColor);

  setOrRemove(root, "--theme-ui-font", getUiFontFamily(normalized.uiFontFamily));
  setOrRemove(root, "--theme-code-font", getCodeFontFamily(normalized.codeFontFamily));
  root.style.setProperty("--theme-ui-weight", normalized.uiFontWeight);
  root.style.setProperty("--theme-code-weight", normalized.codeFontWeight);

  const lightBorderMix = 4 + normalized.contrast * 0.08;
  const darkBorderMix = 20 + normalized.contrast * 0.2;
  root.style.setProperty(
    "--theme-light-border",
    `color-mix(in oklch, var(--theme-light-foreground, ${DEFAULT_LIGHT_FOREGROUND_COLOR}) ${lightBorderMix}%, var(--theme-light-background, ${DEFAULT_LIGHT_BACKGROUND_COLOR}))`,
  );
  root.style.setProperty(
    "--theme-dark-border",
    `color-mix(in oklch, var(--theme-dark-foreground, ${DEFAULT_DARK_FOREGROUND_COLOR}) ${darkBorderMix}%, var(--theme-dark-background, ${DEFAULT_DARK_BACKGROUND_COLOR}))`,
  );
  root.style.setProperty("--theme-contrast", String(normalized.contrast));
  root.classList.toggle("theme-sidebar-transparent", normalized.sidebarTransparency);
}
