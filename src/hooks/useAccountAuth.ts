import { useCallback, useEffect, useState } from "react";
import type {
  AccountAuthActionResult,
  AccountAuthSnapshot,
} from "@shared/types/account-auth";

export interface UseAccountAuthResult {
  snapshot: AccountAuthSnapshot | null;
  loading: boolean;
  actionPending: boolean;
  refresh: () => Promise<void>;
  beginAuthorization: () => Promise<AccountAuthActionResult>;
  cancelAuthorization: () => Promise<AccountAuthActionResult>;
  reauthorize: () => Promise<AccountAuthActionResult>;
  continueAsGuest: () => Promise<AccountAuthActionResult>;
  logoutAndRevoke: () => Promise<AccountAuthActionResult>;
  clearLocalAuthorization: () => Promise<AccountAuthActionResult>;
}

let cachedSnapshot: AccountAuthSnapshot | null = null;

export function useAccountAuth(): UseAccountAuthResult {
  const [snapshot, setSnapshot] = useState<AccountAuthSnapshot | null>(() => cachedSnapshot);
  const [loading, setLoading] = useState(cachedSnapshot === null);
  const [actionPending, setActionPending] = useState(false);

  const applySnapshot = useCallback((next: AccountAuthSnapshot) => {
    cachedSnapshot = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      applySnapshot(await window.claude.accountAuth.getStatus());
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    const unsubscribe = window.claude.accountAuth.onChanged(applySnapshot);
    void refresh();
    return unsubscribe;
  }, [applySnapshot, refresh]);

  const runAction = useCallback(
    async (action: () => Promise<AccountAuthActionResult>) => {
      setActionPending(true);
      try {
        const result = await action();
        if (!result.ok && result.errorCode && snapshot) {
          applySnapshot({ ...snapshot, errorCode: result.errorCode });
        }
        return result;
      } finally {
        setActionPending(false);
      }
    },
    [applySnapshot, snapshot],
  );

  return {
    snapshot,
    loading,
    actionPending,
    refresh,
    beginAuthorization: () => runAction(window.claude.accountAuth.beginAuthorization),
    cancelAuthorization: () => runAction(window.claude.accountAuth.cancelAuthorization),
    reauthorize: () => runAction(window.claude.accountAuth.reauthorize),
    continueAsGuest: () => runAction(window.claude.accountAuth.continueAsGuest),
    logoutAndRevoke: () => runAction(window.claude.accountAuth.logoutAndRevoke),
    clearLocalAuthorization: () => runAction(window.claude.accountAuth.clearLocalAuthorization),
  };
}
