import type { AccountBalance } from "@shared/types/account";
import type { AccountBalanceAlertSettings } from "@shared/types/settings";

export const ACCOUNT_BALANCE_ALERT_STATE_KEY = "pcc-agent-account-balance-alert-v1";

type BalanceAlertStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AccountBalanceAlertState {
  accountKey: string;
  thresholdUsd: number;
  belowThreshold: boolean;
}

export interface AccountBalanceAlertDecision {
  shouldNotify: boolean;
  nextState: AccountBalanceAlertState;
}

function isAccountBalanceAlertState(value: unknown): value is AccountBalanceAlertState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AccountBalanceAlertState>;
  return typeof candidate.accountKey === "string"
    && candidate.accountKey.length > 0
    && typeof candidate.thresholdUsd === "number"
    && Number.isFinite(candidate.thresholdUsd)
    && candidate.thresholdUsd >= 0
    && typeof candidate.belowThreshold === "boolean";
}

export function getAccountBalanceAlertStorage(): BalanceAlertStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAccountBalanceAlertState(
  storage: BalanceAlertStorage | null,
): AccountBalanceAlertState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACCOUNT_BALANCE_ALERT_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAccountBalanceAlertState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAccountBalanceAlertState(
  storage: BalanceAlertStorage | null,
  state: AccountBalanceAlertState | null,
): void {
  if (!storage) return;
  try {
    if (state) {
      storage.setItem(ACCOUNT_BALANCE_ALERT_STATE_KEY, JSON.stringify(state));
    } else {
      storage.removeItem(ACCOUNT_BALANCE_ALERT_STATE_KEY);
    }
  } catch {
    // Alert-state persistence is best-effort and must never break account refresh.
  }
}

/**
 * Notify once per downward threshold crossing. The persisted state keeps app
 * restarts and repeated polling from replaying the same low-balance alert.
 */
export function evaluateAccountBalanceAlert(
  accountKey: string,
  balance: AccountBalance,
  settings: AccountBalanceAlertSettings,
  previous: AccountBalanceAlertState | null,
): AccountBalanceAlertDecision {
  const belowThreshold = !balance.unlimited
    && balance.remainingUsd <= settings.thresholdUsd;
  const sameRule = previous?.accountKey === accountKey
    && previous.thresholdUsd === settings.thresholdUsd;
  return {
    shouldNotify: settings.enabled
      && belowThreshold
      && (!sameRule || previous.belowThreshold === false),
    nextState: {
      accountKey,
      thresholdUsd: settings.thresholdUsd,
      belowThreshold: settings.enabled && belowThreshold,
    },
  };
}
