import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isMac } from "@/lib/utils";
import type { MacBackgroundEffect, ThemeOption } from "@/types";

type MacNativeBackgroundEffect = Exclude<MacBackgroundEffect, "off">;

const MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID = "mac-background-effect-restart";

interface UseGlassOrchestratorOptions {
  /** User's desired macOS background effect from settings */
  macBackgroundEffect: MacBackgroundEffect;
  /** Setter to downgrade the effect when liquid glass is unsupported */
  setMacBackgroundEffect: (effect: MacBackgroundEffect) => void;
  /** Whether the user has window transparency enabled */
  transparency: boolean;
  /** Current theme selection (synced to Electron's nativeTheme for Windows Mica) */
  theme: ThemeOption;
}

interface GlassOrchestratorState {
  glassSupported: boolean;
  macLiquidGlassSupported: boolean;
  liveMacBackgroundEffect: MacNativeBackgroundEffect;
}

/**
 * Manages glass/transparency effects across macOS and Windows:
 * - Detects glass and liquid glass support
 * - Applies or upgrades the native background effect at runtime
 * - Shows a restart toast when downgrading from liquid-glass to vibrancy
 * - Auto-falls back to vibrancy when liquid glass is unsupported
 * - Toggles the `glass-enabled` / `glass-vibrancy` CSS classes on the document root
 * - Keeps Electron's nativeTheme in sync for Windows Mica
 */
export function useGlassOrchestrator({
  macBackgroundEffect,
  setMacBackgroundEffect,
  transparency,
  theme,
}: UseGlassOrchestratorOptions): GlassOrchestratorState {
  const [glassSupported, setGlassSupported] = useState(false);
  const [macLiquidGlassSupported, setMacLiquidGlassSupported] = useState<boolean | null>(null);

  // The effect the main process is *actually* rendering right now.
  // Can upgrade vibrancy -> liquid-glass at runtime, but NOT the reverse (requires restart).
  // Seeded from support check + AppSettings on mount.
  const [liveMacBackgroundEffect, setLiveMacBackgroundEffect] = useState<MacNativeBackgroundEffect>("liquid-glass");

  // Detect support and seed live effect together to avoid state mismatches.
  // On pre-Tahoe macOS the main process always resolves to vibrancy — the renderer
  // must reflect that from the start to prevent a false "restart required" toast.
  useEffect(() => {
    window.claude.getGlassSupported().then((supported) => setGlassSupported(supported));
    if (!isMac) return;

    let cancelled = false;
    Promise.all([
      window.claude.getMacBackgroundEffectSupport(),
      window.claude.settings.get(),
    ]).then(([support, appSettings]) => {
      if (cancelled) return;
      const liquidGlass = !!support.liquidGlass;
      setMacLiquidGlassSupported(liquidGlass);

      const stored = appSettings?.macBackgroundEffect === "vibrancy" ? "vibrancy" : "liquid-glass";
      // Main process resolves liquid-glass → vibrancy when unsupported
      setLiveMacBackgroundEffect(liquidGlass ? stored : "vibrancy");
    }).catch(() => { /* keep defaults */ });

    return () => { cancelled = true; };
  }, []);

  // Keep Electron's native theme in sync so Windows Mica follows the app theme.
  useEffect(() => {
    window.claude.setThemeSource(theme);
  }, [theme]);

  // When the desired effect changes, apply it if the transition is safe at runtime.
  // Liquid-glass -> vibrancy requires restart; vibrancy -> liquid-glass is instant.
  useEffect(() => {
    if (!isMac) return;
    const desiredNativeEffect = macBackgroundEffect === "off"
      ? null
      : macBackgroundEffect;
    if (!desiredNativeEffect || desiredNativeEffect === liveMacBackgroundEffect) return;
    // Cannot downgrade from liquid-glass to vibrancy without restart — only when
    // liquid glass is actually running (supported on this OS).
    if (liveMacBackgroundEffect === "liquid-glass" && desiredNativeEffect === "vibrancy"
      && macLiquidGlassSupported) return;

    setLiveMacBackgroundEffect(desiredNativeEffect);
    window.claude.setMacBackgroundEffect(desiredNativeEffect);
  }, [liveMacBackgroundEffect, macBackgroundEffect, macLiquidGlassSupported]);

  // Show restart toast only when liquid glass is actually running and user wants vibrancy.
  // Never show on systems that don't support liquid glass — the main process already
  // resolved to vibrancy, so no restart is needed.
  useEffect(() => {
    if (!isMac) return;
    const requiresRestart = macBackgroundEffect === "vibrancy"
      && liveMacBackgroundEffect === "liquid-glass"
      && macLiquidGlassSupported === true;

    if (!requiresRestart) {
      toast.dismiss(MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID);
      return;
    }

    toast("Restart required", {
      id: MAC_BACKGROUND_EFFECT_RESTART_TOAST_ID,
      duration: Infinity,
      description: "Restart PccAgent to switch away from Liquid Glass cleanly.",
      action: {
        label: "Restart",
        onClick: () => {
          void window.claude.relaunchApp();
        },
      },
    });
  }, [liveMacBackgroundEffect, macBackgroundEffect, macLiquidGlassSupported]);

  // Auto-fallback: if this OS can't do transparency effects (no Liquid Glass),
  // force the effect to "off" so the app renders as a clean opaque window and the
  // settings reflect reality instead of offering a broken vibrancy option.
  useEffect(() => {
    if (!isMac || macLiquidGlassSupported !== false) return;
    if (macBackgroundEffect === "off") return;
    setMacBackgroundEffect("off");
  }, [macLiquidGlassSupported, macBackgroundEffect, setMacBackgroundEffect]);

  // Toggle the glass-enabled CSS class. Preload applies the initial class from
  // localStorage, but only on glass-capable systems — on unsupported ones (e.g.
  // pre-Tahoe macOS) we must actively REMOVE it so the app renders fully opaque.
  useEffect(() => {
    const root = document.documentElement;
    if (glassSupported && transparency) {
      root.classList.add("glass-enabled");
    } else {
      root.classList.remove("glass-enabled");
    }
  }, [transparency, glassSupported]);

  // Toggle the glass-vibrancy class so CSS can distinguish vibrancy from liquid-glass.
  // Only relevant on glass-capable Macs (Tahoe+) with transparency on AND the vibrancy
  // effect chosen; otherwise the app is opaque and needs no glass classes at all.
  useEffect(() => {
    if (!isMac) return;
    const root = document.documentElement;
    if (glassSupported && transparency && liveMacBackgroundEffect === "vibrancy") {
      root.classList.add("glass-vibrancy");
    } else {
      root.classList.remove("glass-vibrancy");
    }
  }, [transparency, liveMacBackgroundEffect, glassSupported]);

  return {
    glassSupported,
    macLiquidGlassSupported: macLiquidGlassSupported ?? false,
    liveMacBackgroundEffect,
  };
}
