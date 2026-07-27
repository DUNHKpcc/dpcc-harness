import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { AccountSubscription } from "@shared/types/account";
import type { DesktopAccountSummary } from "@shared/types/account-auth";

interface AccountSubscriptionDetailsProps {
  subscription: AccountSubscription | null;
  variant: "popover" | "settings";
}

export function resolveAccountSubscription(
  subscription: AccountSubscription | null,
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

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

export const AccountSubscriptionDetails = memo(function AccountSubscriptionDetails({
  subscription,
  variant,
}: AccountSubscriptionDetailsProps) {
  const { t } = useTranslation("common");
  const summaryExpired =
    subscription?.state === "active"
    && subscription.expiresAt !== null
    && subscription.expiresAt <= Date.now();
  const state = summaryExpired ? "expired" : subscription?.state;
  const stateLabel =
    state === "active"
      ? t("accountSubscription.active")
      : state === "none"
        ? t("accountSubscription.none")
        : state === "expired"
          ? t("accountSubscription.expired")
          : t("accountSubscription.unavailable");
  const items = subscription?.items ?? [];
  const summaryExpiry =
    state === "active" && subscription?.expiresAt
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
          subscription.expiresAt,
        )
      : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {t("accountSubscription.title")}
          </div>
          {variant === "settings" ? (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {items.length === 0 && summaryExpiry
                ? t("accountSubscription.validUntil", { date: summaryExpiry })
                : t("accountSubscription.description")}
            </div>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded px-2 py-1 text-[10px] font-medium ${
            state === "active"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-foreground/[0.06] text-muted-foreground"
          }`}
        >
          {stateLabel}
        </span>
      </div>

      {items.length > 0 ? (
        <div
          className={`${variant === "settings" ? "mt-3" : "mt-2"} ${
            items.length > 2
              ? "max-h-48 overflow-y-auto overscroll-contain pe-1"
              : ""
          }`}
        >
          {items.map((item, index) => {
            const usedPercent =
              item.unlimited || item.totalUsd <= 0
                ? 0
                : Math.min(100, Math.round((item.usedUsd / item.totalUsd) * 100));
            const remainingPercent = 100 - usedPercent;
            const expiry = item.expiresAt
              ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                  item.expiresAt,
                )
              : null;
            const remainingLabel = item.unlimited
              ? t("accountSubscription.unlimited")
              : formatUsd(item.remainingUsd);

            return (
              <div
                key={item.id}
                className={`h-24 py-3 ${
                  index > 0 ? "border-t border-foreground/[0.06]" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground">
                      {item.name || t("accountSubscription.current")}
                    </div>
                    {expiry ? (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {t("accountSubscription.validUntil", { date: expiry })}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {remainingLabel}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t("accountSubscription.remaining")}
                    </div>
                  </div>
                </div>

                <div
                  className="mt-2 flex h-1.5 w-full overflow-hidden bg-foreground/10"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={usedPercent}
                  aria-label={t("accountSubscription.progressLabel", {
                    used: usedPercent,
                    remaining: remainingPercent,
                  })}
                >
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${usedPercent}%` }}
                  />
                  <div
                    className="h-full bg-foreground/10"
                    style={{ width: `${remainingPercent}%` }}
                  />
                </div>

                <div className="mt-1.5 flex justify-between gap-3 text-[10px] tabular-nums text-muted-foreground">
                  <span>
                    {t("accountSubscription.used")} {formatUsd(item.usedUsd)} · {usedPercent}%
                  </span>
                  <span>
                    {t("accountSubscription.remaining")} {remainingLabel} · {remainingPercent}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : summaryExpiry && variant === "popover" ? (
        <div className="mt-1 text-end text-[11px] tabular-nums text-muted-foreground">
          {t("accountSubscription.validUntil", { date: summaryExpiry })}
        </div>
      ) : null}
    </div>
  );
});
