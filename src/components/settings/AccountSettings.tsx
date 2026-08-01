import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, ExternalLink, RefreshCw, Smartphone } from "lucide-react";
import { AccountEntryScreen } from "@/components/AccountEntryScreen";
import {
  AccountSubscriptionDetails,
  resolveAccountSubscription,
} from "@/components/AccountSubscriptionDetails";
import { UsageStatsCard } from "@/components/settings/UsageStatsCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAccount } from "@/hooks/useAccount";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import type { AppSettings } from "@/types";

interface AccountSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const ACCOUNT_LINKS = {
  devices: "https://api.dpccgaming.xyz/profile",
  billing: "https://api.dpccgaming.xyz/wallet",
} as const;

export const AccountSettings = memo(function AccountSettings(
  _props: AccountSettingsProps,
) {
  const { t } = useTranslation("settings");
  const auth = useAccountAuth();
  const connected =
    auth.snapshot?.status === "connected" || auth.snapshot?.status === "expiring";
  const account = useAccount(connected);
  const balance = account.balance;
  const subscription = resolveAccountSubscription(
    account.subscription,
    auth.snapshot?.account,
  );

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-6 py-5">
          <section className="border-b border-foreground/[0.06] pb-4">
            <AccountEntryScreen variant="settings" />

            {connected ? (
              <>
                <div className="mt-4 border-t border-foreground/[0.06] pt-4">
                  <AccountSubscriptionDetails
                    subscription={subscription}
                    variant="settings"
                  />
                </div>

                <div className="mt-4 border-t border-foreground/[0.06] pt-4">
                  {balance ? (
                    balance.unlimited ? (
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold tabular-nums text-foreground">
                          ${balance.usedUsd.toFixed(2)}
                        </span>
                        <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t("account.unlimited")}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">
                            {t("account.balanceLabel")}
                          </span>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            ${balance.usedUsd.toFixed(2)} / ${balance.totalUsd.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-2xl font-semibold tabular-nums text-foreground">
                          ${balance.remainingUsd.toFixed(2)}
                        </div>
                      </>
                    )
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {account.error
                          ? t("account.balanceError")
                          : t("account.balanceUnavailable")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={t("account.refresh")}
                        onClick={() => void account.refresh()}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${account.loading ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </section>

          {connected ? (
            <>
              <UsageStatsCard />
              <section className="flex flex-wrap gap-2 border-t border-foreground/[0.06] pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void window.claude.openExternal(ACCOUNT_LINKS.devices)}
                >
                  <Smartphone className="h-4 w-4" />
                  {t("account.manageDevices")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void window.claude.openExternal(ACCOUNT_LINKS.billing)}
                >
                  <CreditCard className="h-4 w-4" />
                  {t("account.openBilling")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </section>
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
});
