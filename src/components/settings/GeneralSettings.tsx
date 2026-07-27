import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Download, MessageSquare, Code, Mic, SquareTerminal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { isImeComposing } from "@/lib/utils";
import type {
  AppSettings,
  PreferredEditor,
  TerminalShell,
  TerminalShellOption,
  VoiceDictationMode,
  UpdateSource,
} from "@/types";

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
  const [terminalShell, setTerminalShell] = useState<TerminalShell>("auto");
  const [terminalCustomShellPath, setTerminalCustomShellPath] = useState("");
  const [terminalShellOptions, setTerminalShellOptions] = useState<TerminalShellOption[]>([]);

  useEffect(() => {
    if (appSettings) {
      setAllowPrerelease(appSettings.allowPrereleaseUpdates);
      setUpdateSource(appSettings.updateSource || "github");
      setChatLimit(appSettings.defaultChatLimit || 10);
      setPreferredEditor(appSettings.preferredEditor || "auto");
      setVoiceDictation(appSettings.voiceDictation || "native");
      setTerminalShell(appSettings.terminalShell || "auto");
      setTerminalCustomShellPath(appSettings.terminalCustomShellPath || "");
    }
  }, [appSettings]);

  useEffect(() => {
    void window.claude.terminal.shellOptions().then((result) => {
      if (result.options) setTerminalShellOptions(result.options);
    }).catch(() => {});
  }, []);

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

  const handleTerminalShellChange = useCallback(
    async (value: TerminalShell) => {
      setTerminalShell(value);
      await onUpdateAppSettings({ terminalShell: value });
    },
    [onUpdateAppSettings],
  );

  const handleTerminalCustomShellPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setTerminalCustomShellPath(next);
      await onUpdateAppSettings({ terminalCustomShellPath: next });
    },
    [onUpdateAppSettings],
  );

  const terminalSelectOptions = terminalShellOptions.map((option) => ({
    value: option.shell as TerminalShell,
    label: `${t(`general.terminal.shells.${option.shell}`)}${
      option.available ? "" : ` (${t("general.terminal.unavailable")})`
    }`,
    disabled: !option.available,
  }));
  if (
    terminalShell !== "custom"
    && !terminalSelectOptions.some((option) => option.value === terminalShell)
  ) {
    terminalSelectOptions.push({
      value: terminalShell,
      label: `${t(`general.terminal.shells.${terminalShell}`)} (${t("general.terminal.unavailable")})`,
      disabled: true,
    });
  }
  terminalSelectOptions.push({
    value: "custom",
    label: t("general.terminal.shells.custom"),
    disabled: false,
  });

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
                onCheckedChange={(checked) => {
                  void handleTogglePrerelease(checked).catch(() => {});
                }}
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

          {/* ── Integrated terminal section ── */}
          <SettingsSection icon={SquareTerminal} label={t("general.terminal.section")}>
            <div data-package-smoke="terminal-shell-setting">
              <SettingRow
                label={t("general.terminal.defaultLabel")}
                description={t("general.terminal.defaultDesc")}
              >
                <SettingsSelect
                  value={terminalShell}
                  onValueChange={handleTerminalShellChange}
                  options={terminalSelectOptions}
                  className="w-52"
                />
              </SettingRow>
            </div>
            {terminalShell === "custom" && (
              <SettingRow
                label={t("general.terminal.customPathLabel")}
                description={t("general.terminal.customPathDesc")}
              >
                <input
                  type="text"
                  value={terminalCustomShellPath}
                  onChange={(event) => setTerminalCustomShellPath(event.target.value)}
                  onBlur={(event) => {
                    void handleTerminalCustomShellPathSave(event.target.value).catch(() => {});
                  }}
                  onKeyDown={(event) => {
                    if (isImeComposing(event)) return;
                    if (event.key === "Enter") {
                      void handleTerminalCustomShellPathSave(event.currentTarget.value).catch(() => {});
                    }
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder={t("general.terminal.customPathPlaceholder")}
                />
              </SettingRow>
            )}
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
