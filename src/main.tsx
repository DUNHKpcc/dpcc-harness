import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { migrateLocalStorage } from "./lib/local-storage-migration";
import { migrateSettingsIfNeeded, useSettingsStore } from "./stores/settings-store";
import { initPostHog, posthog } from "./lib/analytics/posthog";
import { applyLanguage } from "./i18n";
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
useSettingsStore.subscribe((state, prev) => {
  if (state.language !== prev.language) applyLanguage(state.language);
});

// Initialize posthog-js (starts opted-out until settings confirm opt-in)
initPostHog();

// Analytics opt-in sync is deferred to after React mount (in App.tsx useEffect)
// to avoid firing IPC calls before first paint.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PostHogProvider client={posthog}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PostHogProvider>
  </StrictMode>,
);
