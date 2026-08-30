import { useState, useCallback, useEffect } from "react";
import type { McpServerConfig } from "@/types";

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.claude.mcp
      .list()
      .then((s) => {
        if (!cancelled) setServers(s);
      })
      .catch(() => {
        /* IPC failure — leave empty */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addServer = useCallback(
    async (server: McpServerConfig) => {
      await window.claude.mcp.add(server);
      setServers((prev) => {
        const idx = prev.findIndex((s) => s.name === server.name);
        if (idx >= 0) return prev.map((s, i) => (i === idx ? server : s));
        return [...prev, server];
      });
    },
    [],
  );

  const removeServer = useCallback(
    async (name: string) => {
      await window.claude.mcp.remove(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
    },
    [],
  );

  return { servers, loading, addServer, removeServer };
}
