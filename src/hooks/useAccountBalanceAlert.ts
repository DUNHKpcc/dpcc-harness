import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { AccountBalance } from "@shared/types/account";
import type { AccountBalanceAlertSettings } from "@shared/types/settings";
import type { AppNotificationPayload } from "@shared/types/notifications";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import {
  evaluateAccountBalanceAlert,
  getAccountBalanceAlertStorage,
  readAccountBalanceAlertState,
  writeAccountBalanceAlertState,
} from "@/lib/account-balance-alert";
import { reportError } from "@/lib/analytics/analytics";
import {
  createAppNotificationId,
  showNativeNotificationWithFallback,
} from "@/lib/notification-utils";
import { isWindows } from "@/lib/utils";
import i18n from "@/i18n";

const POLL_INTERVAL_MS = 5 * 60 * 1_000;
const FOCUS_REFRESH_MIN_INTERVAL_MS = 60 * 1_000;
const COMPLETION_REFRESH_DELAY_MS = 10 * 1_000;
const BILLING_URL = "https://api.dpccgaming.xyz/wallet";

interface UseAccountBalanceAlertOptions {
  settings: AccountBalanceAlertSettings | null;
  isProcessing: boolean;
}

function showWebNotification(payload: AppNotificationPayload): void {
  if (typeof Notification === "undefined" || Notification.permission === "denied") return;
  try {
    const notification = new Notification(payload.title, {
      body: payload.body,
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (error) {
    reportError("ACCOUNT_BALANCE_WEB_NOTIFICATION", error);
  }
}

function presentBalanceAlert(balance: AccountBalance, thresholdUsd: number): void {
  const remaining = balance.remainingUsd.toFixed(2);
  const threshold = thresholdUsd.toFixed(2);
  const title = i18n.t("notifications.balanceLowTitle");
  const body = i18n.t("notifications.balanceLowBody", { remaining, threshold });

  toast.warning(title, {
    description: body,
    duration: 12_000,
    action: {
      label: i18n.t("notifications.balanceRecharge"),
      onClick: () => void window.claude.openExternal(BILLING_URL),
    },
  });

  if (document.hasFocus()) return;
  const payload: AppNotificationPayload = {
    id: createAppNotificationId("balance-alert", null, `${Date.now()}`),
    kind: "balance-alert",
    title,
    body,
  };
  if (isWindows) {
    void showNativeNotificationWithFallback(
      () => window.claude.notifications.show(payload),
      () => showWebNotification(payload),
    );
  } else {
    showWebNotification(payload);
  }
}

export function useAccountBalanceAlert({
  settings,
  isProcessing,
}: UseAccountBalanceAlertOptions): void {
  const auth = useAccountAuth();
  const connected = auth.snapshot?.status === "connected"
    || auth.snapshot?.status === "expiring";
  const storageRef = useRef(getAccountBalanceAlertStorage());
  const stateRef = useRef(readAccountBalanceAlertState(storageRef.current));
  const settingsRef = useRef(settings);
  const connectedRef = useRef(connected);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastRefreshAtRef = useRef(0);
  const wasProcessingRef = useRef(isProcessing);
  settingsRef.current = settings;
  connectedRef.current = connected;

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    if (!connectedRef.current || !settingsRef.current?.enabled) return Promise.resolve();

    const request = (async () => {
      const config = await window.claude.account.getConfig();
      if (!config.hasToken && !config.hasAccessToken) return;
      const result = await window.claude.account.getBalance();
      lastRefreshAtRef.current = Date.now();
      if ("error" in result) return;
      const currentSettings = settingsRef.current;
      if (!connectedRef.current || !currentSettings?.enabled) return;

      const decision = evaluateAccountBalanceAlert(
        config.cacheKey,
        result,
        currentSettings,
        stateRef.current,
      );
      stateRef.current = decision.nextState;
      writeAccountBalanceAlertState(storageRef.current, decision.nextState);
      if (decision.shouldNotify) presentBalanceAlert(result, currentSettings.thresholdUsd);
    })()
      .catch((error) => {
        reportError("ACCOUNT_BALANCE_ALERT_REFRESH", error);
      })
      .finally(() => {
        refreshInFlightRef.current = null;
      });
    refreshInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!settings || settings.enabled) return;
    stateRef.current = null;
    writeAccountBalanceAlertState(storageRef.current, null);
  }, [settings]);

  useEffect(() => {
    if (!connected || !settings?.enabled) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onFocus = () => {
      if (Date.now() - lastRefreshAtRef.current >= FOCUS_REFRESH_MIN_INTERVAL_MS) {
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [connected, refresh, settings?.enabled, settings?.thresholdUsd]);

  useEffect(() => {
    const completed = wasProcessingRef.current && !isProcessing;
    wasProcessingRef.current = isProcessing;
    if (!completed || !connected || !settings?.enabled) return;
    const timeout = window.setTimeout(() => void refresh(), COMPLETION_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [connected, isProcessing, refresh, settings?.enabled]);

  useEffect(() => {
    if (!connected || !settings?.enabled) return;
    let timeout: number | null = null;
    const onBackgroundComplete = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void refresh(), COMPLETION_REFRESH_DELAY_MS);
    };
    window.addEventListener("pcc-agent:background-session-complete", onBackgroundComplete);
    return () => {
      window.removeEventListener("pcc-agent:background-session-complete", onBackgroundComplete);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [connected, refresh, settings?.enabled]);
}
