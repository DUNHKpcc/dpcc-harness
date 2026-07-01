import { app, type BrowserWindow } from "electron";
import { log } from "./logger";

export interface ReclaimDockFocusOptions {
  platform?: string;
  delaysMs?: number[];
}

function isFocusableWindow(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
}

/**
 * macOS may briefly activate CLI/MCP helper processes as Dock items while an
 * engine starts. Reclaiming focus keeps Harnss as the visible foreground app.
 */
export function reclaimMacDockFocus(
  getMainWindow: () => BrowserWindow | null,
  reason: string,
  options?: ReclaimDockFocusOptions,
): void {
  if ((options?.platform ?? process.platform) !== "darwin") return;

  const delays = options?.delaysMs ?? [120, 700];
  for (const delay of delays) {
    setTimeout(() => {
      const win = getMainWindow();
      if (!isFocusableWindow(win)) return;
      try {
        win.focus();
        app.focus({ steal: true });
      } catch (err) {
        log("MAC_DOCK_FOCUS_ERR", `${reason}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, delay);
  }
}
