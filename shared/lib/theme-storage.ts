import type { ThemeOption } from "../types/settings";

const SETTINGS_STORE_KEY = "pcc-agent-settings-store";
const LEGACY_THEME_KEY = "pcc-agent-theme";

interface ThemeStorage {
  getItem: (key: string) => string | null;
}

function isThemeOption(value: unknown): value is ThemeOption {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredThemeSource(
  storage: ThemeStorage | undefined,
  fallback: ThemeOption = "dark",
): ThemeOption {
  try {
    const stored = storage?.getItem(SETTINGS_STORE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { theme?: unknown } };
      if (isThemeOption(parsed?.state?.theme)) return parsed.state.theme;
    }
  } catch {
    // Fall through to the legacy key when persisted state is unavailable or invalid.
  }

  try {
    const legacy = storage?.getItem(LEGACY_THEME_KEY);
    if (isThemeOption(legacy)) return legacy;
  } catch {
    // Use the default below when storage cannot be read.
  }

  return fallback;
}
