import { useState, useCallback, useEffect } from "react";
import type { AppSettings } from "@shared/types/settings";
import type {
  AccountConfig,
  AccountBalance,
  AccountStatus,
} from "@shared/types/account";
import { DEFAULT_NEWAPI_BASE_URL } from "@shared/types/account";

/** Full credential save for the DPCC account (one host, two token groups, shared balance creds). */
export interface SaveAccountInput {
  /** Shared host (claude uses it as-is, codex gets a /v1 suffix). */
  host: string;
  claudeToken: string;
  codexToken: string;
  /** Optional default model overrides per engine. */
  claudeModel?: string;
  codexModel?: string;
  /** Optional balance credentials. */
  accessToken?: string;
  userId?: string;
}

export interface UseAccountResult {
  config: AccountConfig | null;
  status: AccountStatus | null;
  balance: AccountBalance | null;
  claudeModels: string[];
  codexModels: string[];
  loading: boolean;
  /** Non-null when the balance lookup failed (e.g. endpoint disabled). */
  error: string | null;
  refresh: () => Promise<void>;
  /** Persist host + both token groups (+ optional models/balance creds), then reload. */
  saveAccount: (input: SaveAccountInput) => Promise<void>;
  /** Persist just the access token + user id (for real account balance), then reload. */
  saveAccessToken: (accessToken: string, userId: string) => Promise<void>;
}

/** Normalize a host to a bare root (no trailing slash or /v1); falls back to the DPCC default. */
function normalizeHost(raw: string): string {
  const n = raw.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  return n || DEFAULT_NEWAPI_BASE_URL;
}

/**
 * Reads the upstream (new-api) account: effective config, balance, and per-engine
 * model lists. Loads lazily — only fetches while `active` is true (e.g. when the
 * account popover is open) and on manual refresh. Branding (name + logo) loads on
 * mount regardless so the sidebar trigger can show the logo.
 */
export function useAccount(active: boolean): UseAccountResult {
  const [config, setConfig] = useState<AccountConfig | null>(null);
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [codexModels, setCodexModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await window.claude.account.getStatus());
    } catch {
      // branding is best-effort; ignore failures
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    void loadStatus();
    try {
      const cfg = await window.claude.account.getConfig();
      setConfig(cfg);
      if (cfg.source === "none" || !cfg.hasToken) {
        setBalance(null);
        setClaudeModels([]);
        setCodexModels([]);
        return;
      }
      const [bal, mdl] = await Promise.all([
        window.claude.account.getBalance(),
        window.claude.account.getModels(),
      ]);
      if ("error" in bal) {
        setBalance(null);
        setError(bal.error);
      } else {
        setBalance(bal);
      }
      if ("error" in mdl) {
        setClaudeModels([]);
        setCodexModels([]);
      } else {
        setClaudeModels(mdl.claude);
        setCodexModels(mdl.codex);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const saveAccount = useCallback(
    async (input: SaveAccountInput) => {
      const settings = await window.claude.settings.get();
      const host = normalizeHost(input.host);
      const claudeToken = input.claudeToken.trim();
      const codexToken = input.codexToken.trim();

      const patch: Partial<AppSettings> = {
        claudeGateway: {
          ...settings.claudeGateway,
          enabled: claudeToken.length > 0,
          baseUrl: host,
          authToken: claudeToken,
          ...(input.claudeModel !== undefined ? { model: input.claudeModel.trim() } : {}),
        },
        codexGateway: {
          ...settings.codexGateway,
          enabled: codexToken.length > 0,
          name: settings.codexGateway.name || (status?.name ?? "DPCC API"),
          baseUrl: codexToken.length > 0 ? `${host}/v1` : settings.codexGateway.baseUrl,
          apiKey: codexToken,
          ...(input.codexModel !== undefined ? { model: input.codexModel.trim() } : {}),
        },
      };
      if (input.accessToken !== undefined) patch.accountAccessToken = input.accessToken.trim();
      if (input.userId !== undefined) patch.accountUserId = input.userId.trim();

      await window.claude.settings.set(patch);
      await load();
    },
    [load, status],
  );

  const saveAccessToken = useCallback(
    async (accessToken: string, userId: string) => {
      await window.claude.settings.set({
        accountAccessToken: accessToken.trim(),
        accountUserId: userId.trim(),
      });
      await load();
    },
    [load],
  );

  return {
    config,
    status,
    balance,
    claudeModels,
    codexModels,
    loading,
    error,
    refresh: load,
    saveAccount,
    saveAccessToken,
  };
}
