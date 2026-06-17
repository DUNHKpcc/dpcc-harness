import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { LanguageOption } from "@/types";

/**
 * i18n setup. Translation resources live as JSON under
 * `src/i18n/locales/<lng>/<namespace>.json` and are auto-discovered at build
 * time via Vite's import.meta.glob — adding a new namespace file is enough to
 * register it; no edits here are needed.
 *
 * Language is driven by the settings store (`language`), not by a browser
 * detector. `system` resolves to Chinese for zh-* locales, English otherwise.
 *
 * Proper nouns (Claude, Codex, ACP, MCP, Jira, Git, …) are intentionally left
 * untranslated inside the resource files.
 */

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const FALLBACK_LANGUAGE: SupportedLanguage = "en";

// Eagerly import every locale JSON: { "./locales/en/common.json": {...}, ... }
const localeModules = import.meta.glob<Record<string, unknown>>("./locales/*/*.json", {
  eager: true,
  import: "default",
});

function buildResources(): Record<string, Record<string, Record<string, unknown>>> {
  const resources: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [filePath, content] of Object.entries(localeModules)) {
    // filePath: ./locales/<lng>/<namespace>.json
    const match = filePath.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;
    const [, lng, namespace] = match;
    resources[lng] ??= {};
    resources[lng][namespace] = content;
  }
  return resources;
}

const resources = buildResources();

/** Collect the namespaces present so react-i18next preloads them all. */
const namespaces = Array.from(
  new Set(Object.values(resources).flatMap((nsMap) => Object.keys(nsMap))),
);

/** Resolve a stored LanguageOption to a concrete, supported i18n language. */
export function resolveLanguage(option: LanguageOption): SupportedLanguage {
  if (option === "en" || option === "zh") return option;
  // "system" — follow the OS/browser locale.
  const locale = (typeof navigator !== "undefined" ? navigator.language : "") || "";
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: FALLBACK_LANGUAGE, // overridden immediately by applyLanguage() at startup
  fallbackLng: FALLBACK_LANGUAGE,
  ns: namespaces.length > 0 ? namespaces : ["common"],
  defaultNS: "common",
  // Missing keys fall back to the key text (which we author as readable English),
  // so an untranslated string degrades to sensible English rather than a raw id.
  returnEmptyString: false,
  interpolation: { escapeValue: false }, // React already escapes
  react: { useSuspense: false },
});

/** Apply a stored language option (resolving "system") to the i18n instance. */
export function applyLanguage(option: LanguageOption): void {
  const resolved = resolveLanguage(option);
  if (i18n.language !== resolved) {
    void i18n.changeLanguage(resolved);
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = resolved;
  }
}

export default i18n;
