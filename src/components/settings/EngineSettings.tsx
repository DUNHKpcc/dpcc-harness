import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Server, RefreshCw, Loader2, ChevronRight, Plus, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import {
  CLAUDE_GATEWAY_MODEL_PRESETS,
  CODEX_GATEWAY_MODEL_PRESETS,
  buildGatewayModelMappings,
  type GatewayEngine,
} from "@/lib/gateway-models";
import { isImeComposing } from "@/lib/utils";
import { resolveGatewayConfigSource } from "@shared/lib/upstream-routing";
import type { AppSettings, ClaudeGatewaySettings, CodexGatewaySettings, GatewayModelMapping } from "@/types";

interface EngineSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const GATEWAY_INPUT_CLASS =
  "h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";
const GATEWAY_WIDE_INPUT_CLASS =
  "h-8 w-full rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";

const CLAUDE_GATEWAY_DEFAULT: ClaudeGatewaySettings = { enabled: false, baseUrl: "", authToken: "", model: "", modelMappings: CLAUDE_GATEWAY_MODEL_PRESETS };
const CODEX_GATEWAY_DEFAULT: CodexGatewaySettings = { enabled: false, name: "", baseUrl: "", apiKey: "", model: "", modelMappings: CODEX_GATEWAY_MODEL_PRESETS };

/** Controlled text field that commits on blur or Enter (mirrors the custom-path input pattern). */
const GatewayTextField = memo(function GatewayTextField({
  value,
  onSave,
  placeholder,
  type = "text",
}: {
  value: string;
  onSave: (value: string) => void | Promise<void>;
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
      onBlur={(e) => {
        void Promise.resolve(onSave(e.target.value)).catch(() => {});
      }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Enter") {
          void Promise.resolve(onSave(e.currentTarget.value)).catch(() => {});
        }
      }}
      spellCheck={false}
      autoComplete="off"
      className={GATEWAY_INPUT_CLASS}
      placeholder={placeholder}
    />
  );
});

const GatewayModelField = memo(function GatewayModelField({
  value,
  mappings,
  upstreamModels,
  onSave,
  placeholder,
  datalistId,
}: {
  value: string;
  mappings: GatewayModelMapping[];
  upstreamModels: string[];
  onSave: (value: string) => void | Promise<void>;
  placeholder: string;
  datalistId: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const optionIds = Array.from(new Set([...mappings.map((m) => m.modelId), ...upstreamModels].filter(Boolean)));
  return (
    <>
      <input
        type="text"
        value={local}
        list={datalistId}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={(e) => {
          void Promise.resolve(onSave(e.target.value.trim())).catch(() => {});
        }}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === "Enter") {
            void Promise.resolve(onSave(e.currentTarget.value.trim())).catch(() => {});
          }
        }}
        spellCheck={false}
        autoComplete="off"
        className={GATEWAY_INPUT_CLASS}
        placeholder={placeholder}
      />
      <datalist id={datalistId}>
        {optionIds.map((modelId) => {
          const mapping = mappings.find((m) => m.modelId === modelId);
          return <option key={modelId} value={modelId} label={mapping?.displayName ?? modelId} />;
        })}
      </datalist>
    </>
  );
});

const GatewayModelMappingsEditor = memo(function GatewayModelMappingsEditor({
  engine,
  mappings,
  upstreamModels,
  upstreamError,
  loading,
  onFetch,
  onChange,
}: {
  engine: GatewayEngine;
  mappings: GatewayModelMapping[];
  upstreamModels: string[];
  upstreamError: string | null;
  loading: boolean;
  onFetch: () => void;
  onChange: (mappings: GatewayModelMapping[]) => void;
}) {
  const { t } = useTranslation("settings");
  const normalized = buildGatewayModelMappings(engine, mappings);
  const datalistId = `${engine}-gateway-upstream-models`;

  const commit = (next: GatewayModelMapping[]) => onChange(buildGatewayModelMappings(engine, next));
  const updateRow = (index: number, patch: Partial<GatewayModelMapping>) => {
    commit(normalized.map((mapping, i) => (i === index ? { ...mapping, ...patch } : mapping)));
  };
  const addEmptyRow = () => commit([...normalized, { displayName: "", modelId: `custom-model-${normalized.length + 1}` }]);
  const addUpstreamModel = (modelId: string) => {
    if (!modelId || normalized.some((mapping) => mapping.modelId === modelId)) return;
    commit([...normalized, { displayName: modelId, modelId }]);
  };
  const removeRow = (index: number) => commit(normalized.filter((_, i) => i !== index));

  return (
    <div className="space-y-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground/80">{t("engines.gatewayModels.title")}</p>
          <p className="text-[11px] text-muted-foreground">{t("engines.gatewayModels.description")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onFetch} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {loading ? t("engines.gatewayModels.loading") : t("engines.gatewayModels.fetch")}
        </Button>
      </div>

      {upstreamModels.length > 0 && (
        <select
          className={GATEWAY_WIDE_INPUT_CLASS}
          value=""
          onChange={(event) => addUpstreamModel(event.target.value)}
        >
          <option value="">{t("engines.gatewayModels.addFromUpstream", { count: upstreamModels.length })}</option>
          {upstreamModels.map((modelId) => (
            <option key={modelId} value={modelId}>
              {modelId}
            </option>
          ))}
        </select>
      )}
      {upstreamError && (
        <p className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          {t("engines.gatewayModels.fetchError", { error: upstreamError })}
        </p>
      )}

      <datalist id={datalistId}>
        {upstreamModels.map((modelId) => (
          <option key={modelId} value={modelId} />
        ))}
      </datalist>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_auto] gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{t("engines.gatewayModels.displayName")}</span>
        <span>{t("engines.gatewayModels.modelId")}</span>
        <span className="sr-only">{t("engines.gatewayModels.remove")}</span>
      </div>
      <div className="space-y-2">
        {normalized.map((mapping, index) => (
          <div key={`${mapping.modelId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_auto] gap-2">
            <input
              value={mapping.displayName}
              onChange={(event) => updateRow(index, { displayName: event.target.value })}
              className={GATEWAY_WIDE_INPUT_CLASS}
              placeholder={t("engines.gatewayModels.displayNamePlaceholder")}
              spellCheck={false}
            />
            <input
              value={mapping.modelId}
              list={datalistId}
              onChange={(event) => updateRow(index, { modelId: event.target.value })}
              className={GATEWAY_WIDE_INPUT_CLASS}
              placeholder={t("engines.gatewayModels.modelIdPlaceholder")}
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(index)}
              disabled={normalized.length <= 4}
              title={t("engines.gatewayModels.remove")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2" onClick={addEmptyRow}>
        <Plus className="h-3.5 w-3.5" />
        {t("engines.gatewayModels.add")}
      </Button>
    </div>
  );
});


type CodexOrigin = "env" | "managed" | "known" | "path" | "bundled" | "custom" | "none";
type ClaudeOrigin = "custom" | "env" | "known" | "path" | "sdk-fallback" | "none";
interface ClaudeGitBashStatus {
  required: boolean;
  ready: boolean;
  path: string | null;
  message: string | null;
}

// ── Component ──

export const EngineSettings = memo(function EngineSettings({
  appSettings,
  onUpdateAppSettings,
}: EngineSettingsProps) {
  const { t } = useTranslation("settings");
  const [claudeBinarySource, setClaudeBinarySource] = useState<"builtin" | "auto" | "managed" | "custom">("builtin");
  const [claudeCustomBinaryPath, setClaudeCustomBinaryPath] = useState("");
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);
  const [claudeOrigin, setClaudeOrigin] = useState<ClaudeOrigin>("none");
  const [claudeGitBash, setClaudeGitBash] = useState<ClaudeGitBashStatus | null>(null);
  const [claudeUpdating, setClaudeUpdating] = useState(false);
  const [claudeUpdateMsg, setClaudeUpdateMsg] = useState<string | null>(null);
  const [codexBinarySource, setCodexBinarySource] = useState<"builtin" | "auto" | "managed" | "custom">("builtin");
  const [codexCustomBinaryPath, setCodexCustomBinaryPath] = useState("");
  const [codexVersion, setCodexVersion] = useState<string | null>(null);
  const [codexOrigin, setCodexOrigin] = useState<CodexOrigin>("none");
  const [codexUpdating, setCodexUpdating] = useState(false);
  const [codexUpdateMsg, setCodexUpdateMsg] = useState<string | null>(null);
  const [claudeGateway, setClaudeGateway] = useState<ClaudeGatewaySettings>(CLAUDE_GATEWAY_DEFAULT);
  const [codexGateway, setCodexGateway] = useState<CodexGatewaySettings>(CODEX_GATEWAY_DEFAULT);
  const [claudeGatewayOpen, setClaudeGatewayOpen] = useState(false);
  const [codexGatewayOpen, setCodexGatewayOpen] = useState(false);
  const [claudeUpstreamModels, setClaudeUpstreamModels] = useState<string[]>([]);
  const [codexUpstreamModels, setCodexUpstreamModels] = useState<string[]>([]);
  const [claudeUpstreamError, setClaudeUpstreamError] = useState<string | null>(null);
  const [codexUpstreamError, setCodexUpstreamError] = useState<string | null>(null);
  const [claudeModelsLoading, setClaudeModelsLoading] = useState(false);
  const [codexModelsLoading, setCodexModelsLoading] = useState(false);

  useEffect(() => {
    if (appSettings) {
      setClaudeBinarySource(appSettings.claudeBinarySource || "builtin");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setCodexBinarySource(appSettings.codexBinarySource || "builtin");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
      setClaudeGateway({
        ...CLAUDE_GATEWAY_DEFAULT,
        ...appSettings.claudeGateway,
        modelMappings: buildGatewayModelMappings("claude", appSettings.claudeGateway?.modelMappings),
      });
      setCodexGateway({
        ...CODEX_GATEWAY_DEFAULT,
        ...appSettings.codexGateway,
        modelMappings: buildGatewayModelMappings("codex", appSettings.codexGateway?.modelMappings),
      });
    }
  }, [appSettings]);

  const refreshClaudeInfo = useCallback(async () => {
    const info = await window.claude.binaryInfo();
    if (info.error) return;
    setClaudeVersion(info.version ?? null);
    setClaudeOrigin((info.origin as ClaudeOrigin) ?? "none");
    setClaudeGitBash(info.gitBash ?? null);
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
    async (source: "builtin" | "auto" | "managed" | "custom") => {
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
    async (source: "builtin" | "auto" | "managed" | "custom") => {
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
      const next = { ...claudeGateway, ...patch };
      setClaudeGateway(next);
      await onUpdateAppSettings({
        claudeGateway: next,
        claudeCliConfigSource: resolveGatewayConfigSource({
          enabled: next.enabled,
          baseUrl: next.baseUrl,
          credential: next.authToken,
        }),
      });
    },
    [claudeGateway, onUpdateAppSettings],
  );

  const handleClaudeGatewayEnabledChange = useCallback(
    (checked: boolean) => {
      if (checked && !claudeGateway.enabled) setClaudeGatewayOpen(true);
      if (!checked) setClaudeGatewayOpen(false);
      void handleClaudeGatewayChange({ enabled: checked }).catch(() => {});
    },
    [claudeGateway.enabled, handleClaudeGatewayChange],
  );

  const handleCodexGatewayChange = useCallback(
    async (patch: Partial<CodexGatewaySettings>) => {
      const next = { ...codexGateway, ...patch };
      setCodexGateway(next);
      await onUpdateAppSettings({
        codexGateway: next,
        codexCliConfigSource: resolveGatewayConfigSource({
          enabled: next.enabled,
          baseUrl: next.baseUrl,
          credential: next.apiKey,
        }),
      });
    },
    [codexGateway, onUpdateAppSettings],
  );

  const handleCodexGatewayEnabledChange = useCallback(
    (checked: boolean) => {
      if (checked && !codexGateway.enabled) setCodexGatewayOpen(true);
      if (!checked) setCodexGatewayOpen(false);
      void handleCodexGatewayChange({ enabled: checked }).catch(() => {});
    },
    [codexGateway.enabled, handleCodexGatewayChange],
  );

  const fetchClaudeGatewayModels = useCallback(async () => {
    setClaudeModelsLoading(true);
    setClaudeUpstreamError(null);
    try {
      const result = await window.claude.ccConfig.probeModels({
        baseUrl: claudeGateway.baseUrl,
        token: claudeGateway.authToken,
      });
      setClaudeUpstreamModels(result.models ?? []);
      setClaudeUpstreamError(result.error);
    } finally {
      setClaudeModelsLoading(false);
    }
  }, [claudeGateway.baseUrl, claudeGateway.authToken]);

  const fetchCodexGatewayModels = useCallback(async () => {
    setCodexModelsLoading(true);
    setCodexUpstreamError(null);
    try {
      const result = await window.claude.ccConfig.probeModels({
        baseUrl: codexGateway.baseUrl,
        token: codexGateway.apiKey,
      });
      setCodexUpstreamModels(result.models ?? []);
      setCodexUpstreamError(result.error);
    } finally {
      setCodexModelsLoading(false);
    }
  }, [codexGateway.baseUrl, codexGateway.apiKey]);

  const claudeGitBashMissing = !!claudeGitBash?.required && !claudeGitBash.ready;
  const claudeRuntimeDescription = claudeGitBashMissing
    ? t("engines.claude.gitBashMissing")
    : t("engines.claude.versionDesc", {
      version: claudeVersion ?? t("engines.claude.origin.none"),
      origin: t(`engines.claude.origin.${claudeOrigin}`),
    });

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
                  { value: "builtin", label: t("engines.source.builtin") },
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
                  claudeRuntimeDescription
                }
              >
                {/* Only "managed" downloads a native Claude from claude.ai; for
                    built-in/auto the binary is already present, so show status only. */}
                {claudeBinarySource === "managed" ? (
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
                ) : null}
              </SettingRow>
            )}

            {claudeBinarySource === "custom" && (
              <SettingRow
                label={t("engines.claude.customLabel")}
                description={claudeGitBashMissing ? t("engines.claude.gitBashMissing") : t("engines.claude.customDesc")}
              >
                <input
                  type="text"
                  value={claudeCustomBinaryPath}
                  onChange={(e) => setClaudeCustomBinaryPath(e.target.value)}
                  onBlur={(e) => {
                    void handleClaudeCustomPathSave(e.target.value).catch(() => {});
                  }}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === "Enter") {
                      void handleClaudeCustomPathSave(e.currentTarget.value).catch(() => {});
                    }
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
                      <GatewayModelField
                        value={claudeGateway.model}
                        mappings={claudeGateway.modelMappings}
                        upstreamModels={claudeUpstreamModels}
                        onSave={(v) => handleClaudeGatewayChange({ model: v.trim() })}
                        placeholder={t("engines.claude.gateway.modelPlaceholder")}
                        datalistId="claude-gateway-default-models"
                      />
                    </SettingRow>
                    <GatewayModelMappingsEditor
                      engine="claude"
                      mappings={claudeGateway.modelMappings}
                      upstreamModels={claudeUpstreamModels}
                      upstreamError={claudeUpstreamError}
                      loading={claudeModelsLoading}
                      onFetch={fetchClaudeGatewayModels}
                      onChange={(modelMappings) => {
                        void handleClaudeGatewayChange({ modelMappings }).catch(() => {});
                      }}
                    />
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
                  { value: "builtin", label: t("engines.source.builtin") },
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
                {/* Only "managed" downloads codex from npm; built-in/auto already
                    have a binary, so show status only. */}
                {codexBinarySource === "managed" ? (
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
                ) : null}
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
                  onBlur={(e) => {
                    void handleCodexCustomPathSave(e.target.value).catch(() => {});
                  }}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === "Enter") {
                      void handleCodexCustomPathSave(e.currentTarget.value).catch(() => {});
                    }
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
                      <GatewayModelField
                        value={codexGateway.model}
                        mappings={codexGateway.modelMappings}
                        upstreamModels={codexUpstreamModels}
                        onSave={(v) => handleCodexGatewayChange({ model: v.trim() })}
                        placeholder={t("engines.codex.gateway.modelPlaceholder")}
                        datalistId="codex-gateway-default-models"
                      />
                    </SettingRow>
                    <GatewayModelMappingsEditor
                      engine="codex"
                      mappings={codexGateway.modelMappings}
                      upstreamModels={codexUpstreamModels}
                      upstreamError={codexUpstreamError}
                      loading={codexModelsLoading}
                      onFetch={fetchCodexGatewayModels}
                      onChange={(modelMappings) => {
                        void handleCodexGatewayChange({ modelMappings }).catch(() => {});
                      }}
                    />
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
