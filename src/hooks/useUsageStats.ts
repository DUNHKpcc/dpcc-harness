import { useState, useCallback, useEffect } from "react";
import type { UsageStats } from "@shared/types/account";

export interface UseUsageStatsResult {
  stats: UsageStats | null;
  loading: boolean;
  hasLoaded: boolean;
  /** Non-null when the fetch failed (e.g. not configured, endpoint disabled). */
  error: string | null;
  /** Load cached stats when available; otherwise fetch from the upstream account log. */
  load: () => Promise<void>;
  /** Force a fresh fetch, bypassing the main-process cache. */
  refresh: () => Promise<void>;
}

/**
 * Loads Token-activity stats from the upstream account log. Lazy: only fetches
 * while `active` is true (e.g. the DPCC API settings panel is visible). Mirrors
 * the lazy-load pattern in useAccount.
 */
export function useUsageStats(active: boolean): UseUsageStatsResult {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setHasLoaded(true);
    setError(null);
    try {
      const res = await window.claude.account.getUsageStats(force);
      if ("error" in res) {
        setStats(null);
        setError(res.error);
      } else {
        setStats(res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load(false);
  }, [active, load]);

  const loadCached = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  return { stats, loading, hasLoaded, error, load: loadCached, refresh };
}
