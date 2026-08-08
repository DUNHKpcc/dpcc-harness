import { describe, expect, it } from "vitest";
import type { AccountBalance } from "@shared/types/account";
import {
  ACCOUNT_BALANCE_ALERT_STATE_KEY,
  evaluateAccountBalanceAlert,
  readAccountBalanceAlertState,
  writeAccountBalanceAlertState,
  type AccountBalanceAlertState,
} from "@/lib/account-balance-alert";

function balance(remainingUsd: number, unlimited = false): AccountBalance {
  return {
    totalUsd: unlimited ? 0 : 20,
    usedUsd: unlimited ? 3 : Math.max(0, 20 - remainingUsd),
    remainingUsd,
    unlimited,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("account balance alert", () => {
  const settings = { enabled: true, thresholdUsd: 5 };

  it("notifies on the first low balance and suppresses repeated polling", () => {
    const first = evaluateAccountBalanceAlert("account-a", balance(4.25), settings, null);
    const repeated = evaluateAccountBalanceAlert(
      "account-a",
      balance(3.5),
      settings,
      first.nextState,
    );

    expect(first.shouldNotify).toBe(true);
    expect(repeated.shouldNotify).toBe(false);
    expect(repeated.nextState.belowThreshold).toBe(true);
  });

  it("rearmer after the balance recovers above the threshold", () => {
    const low = evaluateAccountBalanceAlert("account-a", balance(4), settings, null);
    const recovered = evaluateAccountBalanceAlert(
      "account-a",
      balance(8),
      settings,
      low.nextState,
    );
    const lowAgain = evaluateAccountBalanceAlert(
      "account-a",
      balance(2),
      settings,
      recovered.nextState,
    );

    expect(recovered.shouldNotify).toBe(false);
    expect(recovered.nextState.belowThreshold).toBe(false);
    expect(lowAgain.shouldNotify).toBe(true);
  });

  it("treats a different account or threshold as a new alert rule", () => {
    const previous: AccountBalanceAlertState = {
      accountKey: "account-a",
      thresholdUsd: 5,
      belowThreshold: true,
    };

    expect(evaluateAccountBalanceAlert(
      "account-b",
      balance(4),
      settings,
      previous,
    ).shouldNotify).toBe(true);
    expect(evaluateAccountBalanceAlert(
      "account-a",
      balance(4),
      { enabled: true, thresholdUsd: 10 },
      previous,
    ).shouldNotify).toBe(true);
  });

  it("does not alert for disabled monitoring or unlimited accounts", () => {
    expect(evaluateAccountBalanceAlert(
      "account-a",
      balance(0),
      { enabled: false, thresholdUsd: 5 },
      null,
    ).shouldNotify).toBe(false);
    expect(evaluateAccountBalanceAlert(
      "account-a",
      balance(0, true),
      settings,
      null,
    ).shouldNotify).toBe(false);
  });

  it("persists valid crossing state and ignores malformed storage", () => {
    const storage = memoryStorage();
    const state: AccountBalanceAlertState = {
      accountKey: "account-a",
      thresholdUsd: 5,
      belowThreshold: true,
    };
    writeAccountBalanceAlertState(storage, state);
    expect(readAccountBalanceAlertState(storage)).toEqual(state);

    storage.setItem(ACCOUNT_BALANCE_ALERT_STATE_KEY, "{bad json");
    expect(readAccountBalanceAlertState(storage)).toBeNull();

    writeAccountBalanceAlertState(storage, null);
    expect(storage.getItem(ACCOUNT_BALANCE_ALERT_STATE_KEY)).toBeNull();
  });
});
