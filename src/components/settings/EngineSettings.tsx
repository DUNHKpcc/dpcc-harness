import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Server, RefreshCw, Loader2, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings, ClaudeGatewaySettings, CodexGatewaySettings } from "@/types";

interface EngineSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const GATEWAY_INPUT_CLASS =
  "h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";

const CLAUDE_GATEWAY_DEFAULT: ClaudeGatewaySettings = { enabled: false, baseUrl: "", authToken: "", model: "" };
const CODEX_GATEWAY_DEFAULT: CodexGatewaySettings = { enabled: false, name: "", baseUrl: "", apiKey: "", model: "" };

/** Controlled text field that commits on blur or Enter (mirrors the custom-path input pattern). */
const GatewayTextField = memo(function GatewayTextField({
  value,
  onSave,
  placeholder,
  type = "text",
}: {
  value: string;
  onSave: (value: string) => void;
  placeholder: string;
  type?: "text" | "password";
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      type={type}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => onSave(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSave(e.currentTarget.value);
      }}
      spellCheck={false}
      autoComplete="off"
      className={GATEWAY_INPUT_CLASS}
      placeholder={placeholder}
    />
  );
});


type CodexOrigin = "env" | "managed" | "known" | "path" | "bundled" | "custom" | "none";
type ClaudeOrigin = "custom" | "env" | "known" | "path" | "sdk-fallback" | "none";

// ── Component ──

export const EngineSettings = memo(function EngineSettings({
  appSettings,
  onUpdateAppSettings,
}: EngineSettingsProps) {
  const { t } = useTranslation("settings");
  const [claudeBinarySource, setClaudeBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [claudeCustomBinaryPath, setClaudeCustomBinaryPath] = useState("");
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);
  const [claudeOrigin, setClaudeOrigin] = useState<ClaudeOrigin>("none");
  const [claudeUpdating, setClaudeUpdating] = useState(false);
  const [claudeUpdateMsg, setClaudeUpdateMsg] = useState<string | null>(null);
  const [codexBinarySource, setCodexBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [codexCustomBinaryPath, setCodexCustomBinaryPath] = useState("");
  const [codexVersion, setCodexVersion] = useState<string | null>(null);
  const [codexOrigin, setCodexOrigin] = useState<CodexOrigin>("none");
  const [codexUpdating, setCodexUpdating] = useState(false);
  const [codexUpdateMsg, setCodexUpdateMsg] = useState<string | null>(null);
  const [claudeGateway, setClaudeGateway] = useState<ClaudeGatewaySettings>(CLAUDE_GATEWAY_DEFAULT);
  const [codexGateway, setCodexGateway] = useState<CodexGatewaySettings>(CODEX_GATEWAY_DEFAULT);
  const [claudeGatewayOpen, setClaudeGatewayOpen] = useState(false);
  const [codexGatewayOpen, setCodexGatewayOpen] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setClaudeBinarySource(appSettings.claudeBinarySource || "auto");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setCodexBinarySource(appSettings.codexBinarySource || "auto");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
      setClaudeGateway(appSettings.claudeGateway ?? CLAUDE_GATEWAY_DEFAULT);
      setCodexGateway(appSettings.codexGateway ?? CODEX_GATEWAY_DEFAULT);
    }
  }, [appSettings]);

  const refreshClaudeInfo = useCallback(async () => {
    const info = await window.claude.binaryInfo();
    if (info.error) return;
    setClaudeVersion(info.version ?? null);
    setClaudeOrigin((info.origin as ClaudeOrigin) ?? "none");
  }, []);

  const refreshCodexInfo = useCallback(async () => {
    const info = await window.claude.codex.binaryInfo();
    if (info.error) return;
    setCodexVersion(info.version ?? null);
    setCodexOrigin((info.origin as CodexOrigin) ?? "none");
  }, []);

  useEffect(() => {
    void refreshClaudeInfo();
  }, [refreshClaudeInfo, claudeBinarySource, claudeCustomBinaryPath]);

  useEffect(() => {
    void refreshCodexInfo();
  }, [refreshCodexInfo, codexBinarySource, codexCustomBinaryPath]);

  const handleClaudeCheckUpdate = useCallback(async () => {
    setClaudeUpdating(true);
    setClaudeUpdateMsg(null);
    try {
      const result = await window.claude.downloadUpdate();
      if (result.error) {
        setClaudeUpdateMsg(t("engines.claude.updateFailed", { error: result.error }));
      } else {
        setClaudeUpdateMsg(t("engines.claude.updated", { version: result.version ?? "" }));
        await refreshClaudeInfo();
      }
    } catch (err) {
      setClaudeUpdateMsg(t("engines.claude.updateFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setClaudeUpdating(false);
    }
  }, [refreshClaudeInfo, t]);

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

  const handleClaudeGatewayChange = useCallback(
    async (patch: Partial<ClaudeGatewaySettings>) => {
      setClaudeGateway((prev) => {
        const next = { ...prev, ...patch };
        void onUpdateAppSettings({ claudeGateway: next });
        return next;
      });
    },
    [onUpdateAppSettings],
  );

  const handleClaudeGatewayEnabledChange = useCallback(
    (checked: boolean) => {
      if (checked && !claudeGateway.enabled) setClaudeGatewayOpen(true);
      if (!checked) setClaudeGatewayOpen(false);
      void handleClaudeGatewayChange({ enabled: checked });
    },
    [claudeGateway.enabled, handleClaudeGatewayChange],
  );

  const handleCodexGatewayChange = useCallback(
    async (patch: Partial<CodexGatewaySettings>) => {
      setCodexGateway((prev) => {
        const next = { ...prev, ...patch };
        void onUpdateAppSettings({ codexGateway: next });
        return next;
      });
    },
    [onUpdateAppSettings],
  );

  const handleCodexGatewayEnabledChange = useCallback(
    (checked: boolean) => {
      if (checked && !codexGateway.enabled) setCodexGatewayOpen(true);
      if (!checked) setCodexGatewayOpen(false);
      void handleCodexGatewayChange({ enabled: checked });
    },
    [codexGateway.enabled, handleCodexGatewayChange],
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

            {claudeBinarySource !== "custom" && (
              <SettingRow
                label={t("engines.claude.versionLabel")}
                description={
                  claudeUpdateMsg ??
                  t("engines.claude.versionDesc", {
                    version: claudeVersion ?? t("engines.claude.origin.none"),
                    origin: t(`engines.claude.origin.${claudeOrigin}`),
                  })
                }
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClaudeCheckUpdate}
                  disabled={claudeUpdating}
                  className="gap-1.5"
                >
                  {claudeUpdating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {claudeUpdating ? t("action.downloading", { ns: "common" }) : t("action.checkForUpdates", { ns: "common" })}
                </Button>
              </SettingRow>
            )}

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

            <SettingRow
              label={t("engines.claude.gateway.toggleLabel")}
              description={t("engines.claude.gateway.toggleDesc")}
            >
              <Switch
                checked={claudeGateway.enabled}
                onCheckedChange={handleClaudeGatewayEnabledChange}
              />
            </SettingRow>

            {claudeGateway.enabled && (
              <Collapsible open={claudeGatewayOpen} onOpenChange={setClaudeGatewayOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
                  <ChevronRight className={`h-4 w-4 transition-transform ${claudeGatewayOpen ? "rotate-90" : ""}`} />
                  {t("engines.claude.gateway.editLabel")}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-1 pt-1">
                    <SettingRow label={t("engines.claude.gateway.baseUrlLabel")} description={t("engines.claude.gateway.baseUrlDesc")}>
                      <GatewayTextField
                        value={claudeGateway.baseUrl}
                        onSave={(v) => handleClaudeGatewayChange({ baseUrl: v.trim() })}
                        placeholder={t("engines.claude.gateway.baseUrlPlaceholder")}
                      />
                    </SettingRow>
                    <SettingRow label={t("engines.claude.gateway.tokenLabel")} description={t("engines.claude.gateway.tokenDesc")}>
                      <GatewayTextField
                        value={claudeGateway.authToken}
                        onSave={(v) => handleClaudeGatewayChange({ authToken: v.trim() })}
                        placeholder={t("engines.claude.gateway.tokenPlaceholder")}
                        type="password"
                      />
                    </SettingRow>
                    <SettingRow label={t("engines.claude.gateway.modelLabel")} description={t("engines.claude.gateway.modelDesc")}>
                      <GatewayTextField
                        value={claudeGateway.model}
                        onSave={(v) => handleClaudeGatewayChange({ model: v.trim() })}
                        placeholder={t("engines.claude.gateway.modelPlaceholder")}
                      />
                    </SettingRow>
                  </div>
                </CollapsibleContent>
              </Collapsible>
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

            <SettingRow
              label={t("engines.codex.gateway.toggleLabel")}
              description={t("engines.codex.gateway.toggleDesc")}
            >
              <Switch
                checked={codexGateway.enabled}
                onCheckedChange={handleCodexGatewayEnabledChange}
              />
            </SettingRow>

            {codexGateway.enabled && (
              <Collapsible open={codexGatewayOpen} onOpenChange={setCodexGatewayOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
                  <ChevronRight className={`h-4 w-4 transition-transform ${codexGatewayOpen ? "rotate-90" : ""}`} />
                  {t("engines.codex.gateway.editLabel")}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-1 pt-1">
                    <SettingRow label={t("engines.codex.gateway.nameLabel")} description={t("engines.codex.gateway.nameDesc")}>
                      <GatewayTextField
                        value={codexGateway.name}
                        onSave={(v) => handleCodexGatewayChange({ name: v.trim() })}
                        placeholder={t("engines.codex.gateway.namePlaceholder")}
                      />
                    </SettingRow>
                    <SettingRow label={t("engines.codex.gateway.baseUrlLabel")} description={t("engines.codex.gateway.baseUrlDesc")}>
                      <GatewayTextField
                        value={codexGateway.baseUrl}
                        onSave={(v) => handleCodexGatewayChange({ baseUrl: v.trim() })}
                        placeholder={t("engines.codex.gateway.baseUrlPlaceholder")}
                      />
                    </SettingRow>
                    <SettingRow label={t("engines.codex.gateway.apiKeyLabel")} description={t("engines.codex.gateway.apiKeyDesc")}>
                      <GatewayTextField
                        value={codexGateway.apiKey}
                        onSave={(v) => handleCodexGatewayChange({ apiKey: v.trim() })}
                        placeholder={t("engines.codex.gateway.apiKeyPlaceholder")}
                        type="password"
                      />
                    </SettingRow>
                    <SettingRow label={t("engines.codex.gateway.modelLabel")} description={t("engines.codex.gateway.modelDesc")}>
                      <GatewayTextField
                        value={codexGateway.model}
                        onSave={(v) => handleCodexGatewayChange({ model: v.trim() })}
                        placeholder={t("engines.codex.gateway.modelPlaceholder")}
                      />
                    </SettingRow>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
