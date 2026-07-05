import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Server, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { SettingsHeader, SettingsSection, SettingsSelect } from "@/components/settings/shared";
import { buildConfigSourcePatch, shouldApplyConfigSourceRefresh, type ConfigSourceEngine } from "@/components/settings/current-config-settings-utils";
import { setAppSettingsChecked } from "@/lib/app-settings-ipc";
import { getVisibleGatewayModels } from "@/lib/gateway-models";
import type {
  EffectiveCliConfig,
  EffectiveEngineConfig,
  EffectiveCliModels,
  EffectiveModelList,
} from "@shared/types/cc-config";
import type { CliConfigSource } from "@shared/types/settings";

const CONFIG_SOURCE_OPTIONS: Array<{ value: CliConfigSource; labelKey: string }> = [
  { value: "default", labelKey: "currentConfig.source.default" },
  { value: "local", labelKey: "currentConfig.source.local" },
  { value: "gateway", labelKey: "currentConfig.source.gateway" },
];

function SourceBadge({ source }: { source: EffectiveEngineConfig["source"] }) {
  const { t } = useTranslation("settings");
  const styles: Record<EffectiveEngineConfig["source"], string> = {
    gateway: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    local: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    default: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  };
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${styles[source]}`}>
      {t(`currentConfig.source.${source}`)}
    </span>
  );
}

function ConfigRow({ label, value, mono = true }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-foreground/[0.05] bg-foreground/[0.015] px-2.5 py-1.5">
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{label}</span>
      <span className={`truncate text-end text-[11px] text-foreground ${mono ? "font-mono" : ""}`}>
        {value ?? <span className="text-muted-foreground/60">—</span>}
      </span>
    </div>
  );
}

/** Full list of models the engine's effective upstream exposes (/v1/models). */
function ModelList({ models, activeModel }: { models: EffectiveModelList | undefined; activeModel: string | null }) {
  const { t } = useTranslation("settings");
  const [expanded, setExpanded] = useState(false);

  if (!models) {
    return (
      <p className="rounded border border-dashed border-foreground/10 px-2.5 py-2 text-[11px] text-muted-foreground">
        {t("currentConfig.models.loading")}
      </p>
    );
  }

  if (models.models.length === 0) {
    const msg =
      models.error === "no_token"
        ? t("currentConfig.models.noToken")
        : models.error === "local_provider_unreadable"
          ? t("currentConfig.models.localProviderUnreadable")
        : models.error
          ? t("currentConfig.models.error")
          : t("currentConfig.models.empty");
    return (
      <p className="rounded border border-dashed border-foreground/10 px-2.5 py-2 text-[11px] text-muted-foreground">
        {msg}
      </p>
    );
  }

  const { visible, hiddenCount, totalCount } = getVisibleGatewayModels({
    models: models.models,
    activeModel,
    expanded,
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {t("currentConfig.models.title")}
        </span>
        <span className="text-[10.5px] text-muted-foreground/70">
          {t("currentConfig.models.count", { count: totalCount })}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((m) => {
          const isDefault = m === activeModel;
          return (
            <span
              key={m}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] ${
                isDefault
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-foreground/[0.04] text-foreground/80"
              }`}
            >
              {m}
              {isDefault && (
                <span className="rounded-sm bg-emerald-500/20 px-1 text-[9px] uppercase tracking-wide">
                  {t("currentConfig.models.default")}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {hiddenCount > 0 || expanded ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground"
          onClick={() => setExpanded((next) => !next)}
        >
          {expanded
            ? t("currentConfig.models.showLess")
            : t("currentConfig.models.showMore", { count: hiddenCount })}
        </Button>
      ) : null}
    </div>
  );
}

function EngineCard({
  label,
  engine,
  isCodex,
  models,
  selectedSource,
  savingSource,
  onSourceChange,
  first = false,
}: {
  label: string;
  engine: EffectiveEngineConfig;
  isCodex: boolean;
  models: EffectiveModelList | undefined;
  selectedSource: CliConfigSource;
  savingSource: boolean;
  onSourceChange: (source: CliConfigSource) => void;
  first?: boolean;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsSection icon={Server} label={label} first={first}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-xs text-muted-foreground">
          {t(`currentConfig.sourceDesc.${engine.source}`)}
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <SourceBadge source={engine.source} />
          <SettingsSelect
            value={selectedSource}
            onValueChange={onSourceChange}
            options={CONFIG_SOURCE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            className="w-[180px]"
            disabled={savingSource}
          />
          {savingSource && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {isCodex && <ConfigRow label={t("currentConfig.fields.provider")} value={engine.providerName} mono={false} />}
        <ConfigRow label={t("currentConfig.fields.baseUrl")} value={engine.baseUrl} />
        <ConfigRow label={t("currentConfig.fields.token")} value={engine.maskedToken} />
        <ModelList models={models} activeModel={engine.model} />
      </div>
    </SettingsSection>
  );
}

export const CurrentConfigSettings = memo(function CurrentConfigSettings() {
  const { t } = useTranslation("settings");
  const [data, setData] = useState<EffectiveCliConfig | null>(null);
  const [models, setModels] = useState<EffectiveCliModels | null>(null);
  const [claudeConfigSource, setClaudeConfigSource] = useState<CliConfigSource>("default");
  const [codexConfigSource, setCodexConfigSource] = useState<CliConfigSource>("default");
  const [refreshing, setRefreshing] = useState(false);
  const [savingSource, setSavingSource] = useState<ConfigSourceEngine | null>(null);
  const refreshRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    setRefreshing(true);
    try {
      // Effective config resolves instantly; the model lists hit /v1/models, so
      // fetch both together and let the slower one gate the spinner.
      const [cfg, mdl, settings] = await Promise.all([
        window.claude.ccConfig.effective(),
        window.claude.ccConfig.models(),
        window.claude.settings.get(),
      ]);
      if (!shouldApplyConfigSourceRefresh(requestId, refreshRequestIdRef.current)) return;
      setData(cfg);
      setModels(mdl);
      setClaudeConfigSource(settings?.claudeCliConfigSource ?? settings?.cliConfigSource ?? "default");
      setCodexConfigSource(settings?.codexCliConfigSource ?? settings?.cliConfigSource ?? "default");
    } finally {
      if (shouldApplyConfigSourceRefresh(requestId, refreshRequestIdRef.current)) {
        setRefreshing(false);
      }
    }
  }, []);

  const updateConfigSource = useCallback(async (engine: ConfigSourceEngine, source: CliConfigSource) => {
    const previousSource = engine === "claude" ? claudeConfigSource : codexConfigSource;
    const setSource = engine === "claude" ? setClaudeConfigSource : setCodexConfigSource;
    setSource(source);
    setSavingSource(engine);
    try {
      await setAppSettingsChecked(buildConfigSourcePatch(engine, source));
      await refresh();
    } catch {
      setSource(previousSource);
      toast.error(t("currentConfig.saveFailed"));
      void refresh();
    } finally {
      setSavingSource(null);
    }
  }, [claudeConfigSource, codexConfigSource, refresh, t]);

  useEffect(() => {
    void refresh();

    // The effective config derives from app settings AND external CLI config
    // files (~/.claude, ~/.codex). Refetch on both triggers so the panel never
    // shows stale values (B8): in-app settings changes push `settings.onChanged`,
    // while out-of-band edits (or settings.json edited outside the app) are
    // picked up when the window regains focus.
    const unsubscribe = window.claude.settings.onChanged(() => {
      void refresh();
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("currentConfig.title")}
        description={t("currentConfig.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? t("currentConfig.refreshing") : t("currentConfig.refresh")}
          </Button>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          {data && (
            <>
              <EngineCard
                label={t("currentConfig.claude")}
                engine={data.claude}
                isCodex={false}
                models={models?.claude}
                selectedSource={claudeConfigSource}
                savingSource={savingSource === "claude"}
                onSourceChange={(source) => void updateConfigSource("claude", source)}
              />
              <EngineCard
                label={t("currentConfig.codex")}
                engine={data.codex}
                isCodex={true}
                models={models?.codex}
                selectedSource={codexConfigSource}
                savingSource={savingSource === "codex"}
                onSourceChange={(source) => void updateConfigSource("codex", source)}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
