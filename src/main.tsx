import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { migrateLocalStorage } from "./lib/local-storage-migration";
import { migrateSettingsIfNeeded, useSettingsStore } from "./stores/settings-store";
import { applyLanguage } from "./i18n";
import { applyAccentColor } from "./lib/theme-colors";
import { App } from "./App";
import "./index.css";

// Migrate localStorage keys from old "openacpui-*" prefix before React mounts
migrateLocalStorage();

// Hydrate Zustand settings store from legacy per-key localStorage entries.
// Must run before createRoot() so components read correct initial values.
migrateSettingsIfNeeded();

// Apply the persisted UI language before first paint, then keep i18n in sync
// with the settings store (the Appearance language switcher writes here).
applyLanguage(useSettingsStore.getState().language);
applyAccentColor(useSettingsStore.getState().accentColor);
useSettingsStore.subscribe((state, prev) => {
  if (state.language !== prev.language) applyLanguage(state.language);
  if (state.accentColor !== prev.accentColor) applyAccentColor(state.accentColor);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
