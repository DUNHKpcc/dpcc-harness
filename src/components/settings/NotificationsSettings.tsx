import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bell, BellRing, Volume2, MonitorSmartphone } from "lucide-react";
import { DEFAULT_ACCOUNT_BALANCE_ALERT_SETTINGS } from "@shared/types/settings";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { useAccount } from "@/hooks/useAccount";
import { useAccountAuth } from "@/hooks/useAccountAuth";
import type {
  AccountBalanceAlertSettings,
  NotificationTrigger,
  NotificationEventSettings,
  NotificationSettings,
  AppSettings,
} from "@/types";

// ── Props ──

interface NotificationsSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Event type keys (labels/descriptions resolved via i18n at render) ──

const EVENT_KEYS: Array<keyof NotificationSettings> = [
  "sessionComplete",
  "exitPlanMode",
  "permissions",
  "askUserQuestion",
];

const TRIGGER_VALUES: NotificationTrigger[] = ["always", "unfocused", "never"];

// ── Component ──

export const NotificationsSettings = memo(function NotificationsSettings({
  appSettings,
  onUpdateAppSettings,
}: NotificationsSettingsProps) {
  const { t } = useTranslation("settings");
  const triggerOptions: Array<{ value: NotificationTrigger; label: string }> =
    TRIGGER_VALUES.map((value) => ({
      value,
      label: t(`notifications.trigger.${value}`),
    }));
  const [settings, setSettings] = useState<NotificationSettings>({
    exitPlanMode: { osNotification: "unfocused", sound: "always" },
    permissions: { osNotification: "unfocused", sound: "unfocused" },
    askUserQuestion: { osNotification: "unfocused", sound: "always" },
    sessionComplete: { osNotification: "unfocused", sound: "always" },
  });
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
  const belowThreshold = !!balance
    && !balance.unlimited
    && balance.remainingUsd <= balanceAlert.thresholdUsd;

  // Sync from loaded AppSettings
  useEffect(() => {
    if (appSettings?.notifications) {
      setSettings(appSettings.notifications);
    }
  }, [appSettings]);

  useEffect(() => {
    if (!appSettings?.accountBalanceAlert) return;
    setBalanceAlert(appSettings.accountBalanceAlert);
    setThresholdInput(appSettings.accountBalanceAlert.thresholdUsd.toFixed(2));
  }, [appSettings?.accountBalanceAlert]);

  const updateEventSetting = useCallback(
    async (
      eventKey: keyof NotificationSettings,
      field: keyof NotificationEventSettings,
      value: NotificationTrigger,
    ) => {
      const updated: NotificationSettings = {
        ...settings,
        [eventKey]: { ...settings[eventKey], [field]: value },
      };
      setSettings(updated); // optimistic
      await onUpdateAppSettings({ notifications: updated });
    },
    [settings, onUpdateAppSettings],
  );

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
      <SettingsHeader
        title={t("notifications.title")}
        description={t("notifications.description")}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection
            icon={BellRing}
            label={t("notifications.balanceAlert.title")}
            first
          >
            <SettingRow
              label={t("notifications.balanceAlert.enabledLabel")}
              description={t("notifications.balanceAlert.enabledDesc")}
            >
              <Switch
                aria-label={t("notifications.balanceAlert.enabledLabel")}
                checked={balanceAlert.enabled}
                onCheckedChange={(enabled) => {
                  void saveBalanceAlert({ ...balanceAlert, enabled }).catch(() => {});
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("notifications.balanceAlert.thresholdLabel")}
              description={t("notifications.balanceAlert.thresholdDesc")}
            >
              <div className="relative w-28">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  aria-label={t("notifications.balanceAlert.thresholdLabel")}
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
              {t("notifications.balanceAlert.deliveryDesc")}
            </p>
            {balanceAlert.enabled && belowThreshold ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t("notifications.balanceAlert.currentLow", {
                    remaining: balance?.remainingUsd.toFixed(2),
                    threshold: balanceAlert.thresholdUsd.toFixed(2),
                  })}
                </span>
              </div>
            ) : null}
          </SettingsSection>

          {EVENT_KEYS.map((eventKey) => (
            <SettingsSection
              key={eventKey}
              icon={Bell}
              label={t(`notifications.events.${eventKey}.label`)}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {t(`notifications.events.${eventKey}.description`)}
              </p>

              {/* Two setting rows per event: OS notification + sound */}
              <div className="flex flex-col">
                <SettingRow label={t("notifications.osNotification")}>
                  <div className="flex items-center gap-1.5">
                    <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <SettingsSelect
                      value={settings[eventKey].osNotification}
                      onValueChange={(v) =>
                        updateEventSetting(eventKey, "osNotification", v)
                      }
                      options={triggerOptions}
                    />
                  </div>
                </SettingRow>

                <SettingRow label={t("notifications.sound")}>
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <SettingsSelect
                      value={settings[eventKey].sound}
                      onValueChange={(v) =>
                        updateEventSetting(eventKey, "sound", v)
                      }
                      options={triggerOptions}
                    />
                  </div>
                </SettingRow>
              </div>
            </SettingsSection>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});
