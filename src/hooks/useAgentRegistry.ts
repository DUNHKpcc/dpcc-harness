import { useState, useEffect, useCallback } from "react";
import type { InstalledAgent } from "@/types";

export function useAgentRegistry() {
  const [agents, setAgents] = useState<InstalledAgent[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.claude.agents.list();
    setAgents(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let syncInFlight: Promise<void> | null = null;
    let syncPending = false;

    const syncPiModelCache = () => {
      if (typeof window.claude.agents.refreshPiModelCache !== "function") {
        return;
      }
      if (syncInFlight) {
        syncPending = true;
        return;
      }
      syncPending = false;
      syncInFlight = window.claude.agents.refreshPiModelCache()
        .catch(() => undefined)
        .then(async () => {
          if (!disposed) await refresh();
        })
        .finally(() => {
          syncInFlight = null;
          if (syncPending && !disposed) syncPiModelCache();
        });
    };
    const applyAccountSnapshot = (snapshot: { status: string }) => {
      if (snapshot.status === "connected" || snapshot.status === "expiring") {
        syncPiModelCache();
      }
    };
    const unsubscribe = window.claude.accountAuth.onChanged(applyAccountSnapshot);
    void window.claude.accountAuth.getStatus()
      .then(applyAccountSnapshot)
      .catch(() => {
        // Authorization changes are also delivered through onChanged.
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [refresh]);

  const saveAgent = useCallback(async (agent: InstalledAgent) => {
    const result = await window.claude.agents.save(agent);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  const deleteAgent = useCallback(async (id: string) => {
    const result = await window.claude.agents.delete(id);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  return { agents, refresh, saveAgent, deleteAgent };
}
