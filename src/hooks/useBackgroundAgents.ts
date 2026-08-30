import { useCallback, useRef, useSyncExternalStore } from "react";
import { bgAgentStore } from "@/lib/background/agent-store";
import type { BackgroundAgent } from "@/types";

const EMPTY: BackgroundAgent[] = [];

interface UseBackgroundAgentsOptions {
  sessionId: string | null;
}

/**
 * Subscribes to the BackgroundAgentStore for the active session.
 *
 * Retains read-only access to historical background-agent data. Pi ACP does
 * not create entries in this legacy store.
 */
export function useBackgroundAgents({ sessionId }: UseBackgroundAgentsOptions) {
  // Keep sessionId in a ref so the subscribe/getSnapshot closures
  // always read the latest value without needing to be recreated
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const agents = useSyncExternalStore(
    // subscribe: stable function — reads sessionId from ref
    subscribeToStore,
    // getSnapshot: stable function — reads sessionId from ref, returns cached array
    () => {
      const sid = sessionIdRef.current;
      return sid ? bgAgentStore.getAgents(sid) : EMPTY;
    },
  );

  const dismissAgent = useCallback(
    (agentId: string) => {
      if (sessionIdRef.current) bgAgentStore.dismissAgent(sessionIdRef.current, agentId);
    },
    [],
  );

  return { agents, dismissAgent };
}

// Module-level stable subscribe function — avoids re-subscription on every render.
// Notifies on ANY session change; the getSnapshot function filters by sessionId.
function subscribeToStore(onStoreChange: () => void): () => void {
  return bgAgentStore.subscribe(() => onStoreChange());
}
