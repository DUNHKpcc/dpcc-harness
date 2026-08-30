import { useEffect } from "react";

interface UseKeyboardShortcutsOptions {
  /** Active session ID (keyboard shortcuts are disabled without a session) */
  activeSessionId: string | null;
  /** Setter for chat search overlay visibility */
  setChatSearchOpen: (updater: (prev: boolean) => boolean) => void;
}

/**
 * Global keyboard shortcuts:
 * - Cmd+F / Ctrl+F: toggle in-chat search overlay
 */
export function useKeyboardShortcuts({
  activeSessionId,
  setChatSearchOpen,
}: UseKeyboardShortcutsOptions): void {
  // Cmd+F (Mac) / Ctrl+F — toggle in-chat search overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        if (!activeSessionId) return;
        e.preventDefault();
        setChatSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSessionId, setChatSearchOpen]);
}
