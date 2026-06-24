import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Synchronous platform checks — available immediately on first render,
// unlike the preload CSS class which is applied after an async IPC call.
export const isMac = /Mac/.test(navigator.platform);
export const isWindows = /Win/.test(navigator.platform);

// IME composition guard — true while a non-Latin input method (Chinese,
// Japanese, Korean, etc.) is composing a candidate. During composition,
// keys like Enter and Space are commit keys for the IME candidate window
// and must NOT trigger application shortcuts. `keyCode === 229` is the
// legacy Safari fallback when `isComposing` is not yet set.
export function isImeComposing(e: {
  nativeEvent: { isComposing: boolean };
  keyCode: number;
}): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
