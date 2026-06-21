import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Download, MessageSquare, Code, Mic } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings, PreferredEditor, VoiceDictationMode, UpdateSource } from "@/types";

interface GeneralSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Component ──

export const GeneralSettings = memo(function GeneralSettings({
  appSettings,
  onUpdateAppSettings,
}: GeneralSettingsProps) {
  const { t } = useTranslation("settings");
  // Local optimistic state — synced from props once loaded
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [updateSource, setUpdateSource] = useState<UpdateSource>("github");
  const [chatLimit, setChatLimit] = useState(10);
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>("auto");
  const [voiceDictation, setVoiceDictation] = useState<VoiceDictationMode>("native");

  useEffect(() => {
    if (appSettings) {
      setAllowPrerelease(appSettings.allowPrereleaseUpdates);
      setUpdateSource(appSettings.updateSource || "github");
      setChatLimit(appSettings.defaultChatLimit || 10);
      setPreferredEditor(appSettings.preferredEditor || "auto");
      setVoiceDictation(appSettings.voiceDictation || "native");
    }
  }, [appSettings]);

  const handleTogglePrerelease = useCallback(
    async (checked: boolean) => {
      setAllowPrerelease(checked); // optimistic
      await onUpdateAppSettings({ allowPrereleaseUpdates: checked });
    },
    [onUpdateAppSettings],
  );

  const handleUpdateSourceChange = useCallback(
    async (value: UpdateSource) => {
      setUpdateSource(value); // optimistic
      await onUpdateAppSettings({ updateSource: value });
    },
    [onUpdateAppSettings],
  );

  const handleChatLimitChange = useCallback(
    async (value: number) => {
      const clamped = Math.max(5, Math.min(100, value));
      setChatLimit(clamped);
      await onUpdateAppSettings({ defaultChatLimit: clamped });
    },
    [onUpdateAppSettings],
  );

  const handleEditorChange = useCallback(
    async (value: PreferredEditor) => {
      setPreferredEditor(value); // optimistic
      await onUpdateAppSettings({ preferredEditor: value });
    },
    [onUpdateAppSettings],
  );

  const handleVoiceDictationChange = useCallback(
    async (value: VoiceDictationMode) => {
      setVoiceDictation(value); // optimistic
      await onUpdateAppSettings({ voiceDictation: value });
    },
    [onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader title={t("general.title")} description={t("general.description")} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Updates section ── */}
          <SettingsSection icon={Download} label={t("general.updates.section")} first>
            <SettingRow
              label={t("general.updates.sourceLabel")}
              description={t("general.updates.sourceDesc")}
            >
              <SettingsSelect
                value={updateSource}
                onValueChange={handleUpdateSourceChange}
                options={[
                  { value: "github", label: t("general.updates.sourceGithub") },
                  { value: "mirror", label: t("general.updates.sourceMirror") },
                ]}
              />
            </SettingRow>
            <SettingRow
              label={t("general.updates.prereleaseLabel")}
              description={t("general.updates.prereleaseDesc")}
            >
              <Switch
                checked={allowPrerelease}
                onCheckedChange={handleTogglePrerelease}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Sidebar section ── */}
          <SettingsSection icon={MessageSquare} label={t("general.sidebar.section")}>
            <SettingRow
              label={t("general.sidebar.recentChatsLabel")}
              description={t("general.sidebar.recentChatsDesc")}
            >
              <SettingsSelect
                value={String(chatLimit)}
                onValueChange={(v) => handleChatLimitChange(Number(v))}
                options={[5, 10, 15, 20, 25, 30, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Editor section ── */}
          <SettingsSection icon={Code} label={t("general.editor.section")}>
            <SettingRow
              label={t("general.editor.defaultLabel")}
              description={t("general.editor.defaultDesc")}
            >
              <SettingsSelect
                value={preferredEditor}
                onValueChange={handleEditorChange}
                options={[
                  { value: "auto", label: t("general.editor.auto") },
                  { value: "cursor", label: "Cursor" },
                  { value: "code", label: "VS Code" },
                  { value: "zed", label: "Zed" },
                ]}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Voice Dictation section ── */}
          <SettingsSection icon={Mic} label={t("general.voice.section")}>
            <SettingRow
              label={t("general.voice.modeLabel")}
              description={t("general.voice.modeDesc")}
            >
              <SettingsSelect
                value={voiceDictation}
                onValueChange={handleVoiceDictationChange}
                options={[
                  { value: "native", label: t("general.voice.native") },
                  { value: "whisper", label: t("general.voice.whisper") },
                ]}
              />
            </SettingRow>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
