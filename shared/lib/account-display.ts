import type { AccountSubscription } from "../types/account";
import type { DesktopAccountSummary } from "../types/account-auth";

export function formatAccountUsd(value: number): string {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

export function resolveAccountSubscription(
  subscription: AccountSubscription | null | undefined,
  account: DesktopAccountSummary | null | undefined,
): AccountSubscription | null {
  if (subscription) return subscription;
  if (account?.subscription) return account.subscription;
  return account?.subscriptionState
    ? {
        state: account.subscriptionState,
        expiresAt: null,
        items: [],
      }
    : null;
}
