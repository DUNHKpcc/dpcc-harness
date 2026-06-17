import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Server, RefreshCw, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings } from "@/types";

interface EngineSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

type CodexOrigin = "env" | "managed" | "known" | "path" | "bundled" | "custom" | "none";

// ── Component ──

export const EngineSettings = memo(function EngineSettings({
  appSettings,
  onUpdateAppSettings,
}: EngineSettingsProps) {
  const { t } = useTranslation("settings");
  const [claudeBinarySource, setClaudeBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [claudeCustomBinaryPath, setClaudeCustomBinaryPath] = useState("");
  const [codexBinarySource, setCodexBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [codexCustomBinaryPath, setCodexCustomBinaryPath] = useState("");
  const [codexVersion, setCodexVersion] = useState<string | null>(null);
  const [codexOrigin, setCodexOrigin] = useState<CodexOrigin>("none");
  const [codexUpdating, setCodexUpdating] = useState(false);
  const [codexUpdateMsg, setCodexUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    if (appSettings) {
      setClaudeBinarySource(appSettings.claudeBinarySource || "auto");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setCodexBinarySource(appSettings.codexBinarySource || "auto");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
    }
  }, [appSettings]);

  const refreshCodexInfo = useCallback(async () => {
    const info = await window.claude.codex.binaryInfo();
    if (info.error) return;
    setCodexVersion(info.version ?? null);
    setCodexOrigin((info.origin as CodexOrigin) ?? "none");
  }, []);

  useEffect(() => {
    void refreshCodexInfo();
  }, [refreshCodexInfo, codexBinarySource, codexCustomBinaryPath]);

  const handleCodexCheckUpdate = useCallback(async () => {
    setCodexUpdating(true);
    setCodexUpdateMsg(null);
    try {
      const result = await window.claude.codex.downloadUpdate();
      if (result.error) {
        setCodexUpdateMsg(t("engines.codex.updateFailed", { error: result.error }));
      } else {
        setCodexUpdateMsg(t("engines.codex.updated", { version: result.version ?? "" }));
        await refreshCodexInfo();
      }
    } catch (err) {
      setCodexUpdateMsg(t("engines.codex.updateFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setCodexUpdating(false);
    }
  }, [refreshCodexInfo, t]);

  const handleClaudeBinarySourceChange = useCallback(
    async (source: "auto" | "managed" | "custom") => {
      setClaudeBinarySource(source);
      await onUpdateAppSettings({ claudeBinarySource: source });
    },
    [onUpdateAppSettings],
  );

  const handleClaudeCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setClaudeCustomBinaryPath(next);
      await onUpdateAppSettings({ claudeCustomBinaryPath: next });
    },
    [onUpdateAppSettings],
  );

  const handleCodexBinarySourceChange = useCallback(
    async (source: "auto" | "managed" | "custom") => {
      setCodexBinarySource(source);
      await onUpdateAppSettings({ codexBinarySource: source });
    },
    [onUpdateAppSettings],
  );

  const handleCodexCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setCodexCustomBinaryPath(next);
      await onUpdateAppSettings({ codexCustomBinaryPath: next });
    },
    [onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("engines.title")}
        description={t("engines.description")}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={Server} label={t("engines.claude.section")} first>
            <SettingRow
              label={t("engines.claude.sourceLabel")}
              description={t("engines.claude.sourceDesc")}
            >
              <SettingsSelect
                value={claudeBinarySource}
                onValueChange={handleClaudeBinarySourceChange}
                options={[
                  { value: "auto", label: t("engines.source.auto") },
                  { value: "managed", label: t("engines.source.managedInstall") },
                  { value: "custom", label: t("engines.source.custom") },
                ]}
                className="w-44"
              />
            </SettingRow>

            {claudeBinarySource === "custom" && (
              <SettingRow
                label={t("engines.claude.customLabel")}
                description={t("engines.claude.customDesc")}
              >
                <input
                  type="text"
                  value={claudeCustomBinaryPath}
                  onChange={(e) => setClaudeCustomBinaryPath(e.target.value)}
                  onBlur={(e) => handleClaudeCustomPathSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleClaudeCustomPathSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder={t("engines.claude.customPlaceholder")}
                />
              </SettingRow>
            )}
          </SettingsSection>

          <SettingsSection icon={Server} label={t("engines.codex.section")}>
            <SettingRow
              label={t("engines.codex.sourceLabel")}
              description={t("engines.codex.sourceDesc")}
            >
              <SettingsSelect
                value={codexBinarySource}
                onValueChange={handleCodexBinarySourceChange}
                options={[
                  { value: "auto", label: t("engines.source.auto") },
                  { value: "managed", label: t("engines.source.managedDownload") },
                  { value: "custom", label: t("engines.source.custom") },
                ]}
                className="w-44"
              />
            </SettingRow>

            {codexBinarySource !== "custom" && (
              <SettingRow
                label={t("engines.codex.versionLabel")}
                description={
                  codexUpdateMsg ??
                  t("engines.codex.versionDesc", {
                    version: codexVersion ?? t("engines.codex.origin.none"),
                    origin: t(`engines.codex.origin.${codexOrigin}`),
                  })
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCodexCheckUpdate}
                  disabled={codexUpdating}
                  className="gap-1.5"
                >
                  {codexUpdating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {codexUpdating ? t("action.downloading", { ns: "common" }) : t("action.checkForUpdates", { ns: "common" })}
                </Button>
              </SettingRow>
            )}

            {codexBinarySource === "custom" && (
              <SettingRow
                label={t("engines.codex.customLabel")}
                description={t("engines.codex.customDesc")}
              >
                <input
                  type="text"
                  value={codexCustomBinaryPath}
                  onChange={(e) => setCodexCustomBinaryPath(e.target.value)}
                  onBlur={(e) => handleCodexCustomPathSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCodexCustomPathSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder={t("engines.codex.customPlaceholder")}
                />
              </SettingRow>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
