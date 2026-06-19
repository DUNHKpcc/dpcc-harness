import { createContext, useContext } from "react";

/**
 * Global Claude→Codex bridge toggle, shared by every input-bar instance
 * (single pane and each split pane) via context so the control renders
 * consistently without threading props through the split-pane chain.
 */
export interface CodexBridgeContextValue {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

const CodexBridgeContext = createContext<CodexBridgeContextValue | null>(null);

export const CodexBridgeProvider = CodexBridgeContext.Provider;

export function useCodexBridge(): CodexBridgeContextValue | null {
  return useContext(CodexBridgeContext);
}
