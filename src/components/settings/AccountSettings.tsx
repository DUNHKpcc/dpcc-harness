import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BellRing, CreditCard, ExternalLink, RefreshCw, Smartphone } from "lucide-react";
import { DEFAULT_ACCOUNT_BALANCE_ALERT_SETTINGS } from "@shared/types/settings";
import { AccountEntryScreen } from "@/components/AccountEntryScreen";
import {
  AccountSubscriptionDetails,
  resolveAccountSubscription,
} from "@/components/AccountSubscriptionDetails";
import { UsageStatsCard } from "@/components/settings/UsageStatsCard";
import { SettingRow } from "@/components/settings/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useAccount } from "@/hooks/useAccount";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import type { AccountBalanceAlertSettings, AppSettings } from "@/types";

interface AccountSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const ACCOUNT_LINKS = {
  devices: "https://api.dpccgaming.xyz/profile",
  billing: "https://api.dpccgaming.xyz/wallet",
} as const;

export const AccountSettings = memo(function AccountSettings({
  appSettings,
  onUpdateAppSettings,
}: AccountSettingsProps) {
  const { t } = useTranslation("settings");
  const [balanceAlert, setBalanceAlert] = useState<AccountBalanceAlertSettings>(
    DEFAULT_ACCOUNT_BALANCE_ALERT_SETTINGS,
  );
  const [thresholdInput, setThresholdInput] = useState(
    DEFAULT_ACCOUNT_BALANCE_ALERT_SETTINGS.thresholdUsd.toFixed(2),
  );
  const auth = useAccountAuth();
  const connected =
    auth.snapshot?.status === "connected" || auth.snapshot?.status === "expiring";
  const account = useAccount(connected);
  const balance = account.balance;
  const subscription = resolveAccountSubscription(
    account.subscription,
    auth.snapshot?.account,
  );
  const belowThreshold = !!balance
    && !balance.unlimited
    && balance.remainingUsd <= balanceAlert.thresholdUsd;

  useEffect(() => {
    if (!appSettings?.accountBalanceAlert) return;
    setBalanceAlert(appSettings.accountBalanceAlert);
    setThresholdInput(appSettings.accountBalanceAlert.thresholdUsd.toFixed(2));
  }, [appSettings?.accountBalanceAlert]);

  const saveBalanceAlert = useCallback(async (next: AccountBalanceAlertSettings) => {
    setBalanceAlert(next);
    await onUpdateAppSettings({ accountBalanceAlert: next });
  }, [onUpdateAppSettings]);

  const commitThreshold = useCallback(async () => {
    const parsed = thresholdInput.trim() ? Number(thresholdInput) : balanceAlert.thresholdUsd;
    const normalized = Number.isFinite(parsed)
      ? Math.round(Math.min(1_000_000, Math.max(0, parsed)) * 100) / 100
      : balanceAlert.thresholdUsd;
    setThresholdInput(normalized.toFixed(2));
    if (normalized === balanceAlert.thresholdUsd) return;
    await saveBalanceAlert({ ...balanceAlert, thresholdUsd: normalized });
  }, [balanceAlert, saveBalanceAlert, thresholdInput]);

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

          <section className="border-b border-foreground/[0.06] pb-4">
            <div className="mb-1 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-muted-foreground" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("account.balanceAlert.title")}
              </span>
            </div>
            <SettingRow
              label={t("account.balanceAlert.enabledLabel")}
              description={t("account.balanceAlert.enabledDesc")}
            >
              <Switch
                aria-label={t("account.balanceAlert.enabledLabel")}
                checked={balanceAlert.enabled}
                onCheckedChange={(enabled) => {
                  void saveBalanceAlert({ ...balanceAlert, enabled }).catch(() => {});
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("account.balanceAlert.thresholdLabel")}
              description={t("account.balanceAlert.thresholdDesc")}
            >
              <div className="relative w-28">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  aria-label={t("account.balanceAlert.thresholdLabel")}
                  type="number"
                  min={0}
                  max={1_000_000}
                  step={0.01}
                  inputMode="decimal"
                  className="h-8 pl-7 text-right tabular-nums"
                  value={thresholdInput}
                  disabled={!balanceAlert.enabled}
                  onChange={(event) => setThresholdInput(event.target.value)}
                  onBlur={() => void commitThreshold().catch(() => {})}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
            </SettingRow>
            <p className="text-xs text-muted-foreground">
              {t("account.balanceAlert.deliveryDesc")}
            </p>
            {balanceAlert.enabled && belowThreshold ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t("account.balanceAlert.currentLow", {
                    remaining: balance?.remainingUsd.toFixed(2),
                    threshold: balanceAlert.thresholdUsd.toFixed(2),
                  })}
                </span>
              </div>
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
