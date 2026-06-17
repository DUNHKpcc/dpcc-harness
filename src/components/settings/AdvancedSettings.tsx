import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings } from "@/types";

interface AdvancedSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
}

// ── Component ──

export const AdvancedSettings = memo(function AdvancedSettings({
  appSettings,
  onUpdateAppSettings,
  onReplayWelcome,
}: AdvancedSettingsProps) {
  const { t } = useTranslation("settings");
  const [codexClientName, setCodexClientName] = useState("PccAgent");
  const [showDevFillInChatTitleBar, setShowDevFillInChatTitleBar] = useState(false);
  const [showJiraBoard, setShowJiraBoard] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setCodexClientName(appSettings.codexClientName || "PccAgent");
      setShowDevFillInChatTitleBar(!!appSettings.showDevFillInChatTitleBar);
      setShowJiraBoard(!!appSettings.showJiraBoard);
    }
  }, [appSettings]);

  const handleClientNameChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setCodexClientName(trimmed);
      await onUpdateAppSettings({ codexClientName: trimmed });
    },
    [onUpdateAppSettings],
  );

  const handleDevFillToggle = useCallback(
    async (checked: boolean) => {
      setShowDevFillInChatTitleBar(checked);
      await onUpdateAppSettings({ showDevFillInChatTitleBar: checked });
    },
    [onUpdateAppSettings],
  );

  const handleJiraBoardToggle = useCallback(
    async (checked: boolean) => {
      setShowJiraBoard(checked);
      await onUpdateAppSettings({ showJiraBoard: checked });
    },
    [onUpdateAppSettings],
  );

  const isDev = import.meta.env.DEV;

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("advanced.title")}
        description={t("advanced.description")}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={Server} label={t("advanced.codexSection")} first>
            <SettingRow
              label={t("advanced.clientNameLabel")}
              description={t("advanced.clientNameDesc")}
            >
              <input
                type="text"
                value={codexClientName}
                onChange={(e) => setCodexClientName(e.target.value)}
                onBlur={(e) => handleClientNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleClientNameChange(e.currentTarget.value);
                }}
                spellCheck={false}
                className="h-8 w-40 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                placeholder="PccAgent"
              />
            </SettingRow>

            {isDev && (
              <SettingRow
                label={t("advanced.devFillLabel")}
                description={t("advanced.devFillDesc")}
              >
                <Switch
                  checked={showDevFillInChatTitleBar}
                  onCheckedChange={handleDevFillToggle}
                />
              </SettingRow>
            )}

            <SettingRow
              label={t("advanced.jiraBoardLabel")}
              description={t("advanced.jiraBoardDesc")}
            >
              <Switch
                checked={showJiraBoard}
                onCheckedChange={handleJiraBoardToggle}
              />
            </SettingRow>

            {isDev && (
              <SettingRow
                label={t("advanced.replayWelcomeLabel")}
                description={t("advanced.replayWelcomeDesc")}
              >
                <button
                  onClick={onReplayWelcome}
                  className="rounded-md border border-foreground/10 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/[0.03]"
                >
                  {t("advanced.replay")}
                </button>
              </SettingRow>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
