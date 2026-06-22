import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { EffectiveCliConfig, EffectiveEngineConfig } from "@shared/types/cc-config";

function SourceBadge({ source }: { source: EffectiveEngineConfig["source"] }) {
  const { t } = useTranslation("settings");
  const styles: Record<EffectiveEngineConfig["source"], string> = {
    gateway: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    local: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    default: "bg-foreground/[0.06] text-muted-foreground",
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

function EngineCard({
  label,
  engine,
  isCodex,
  modelFallback,
}: {
  label: string;
  engine: EffectiveEngineConfig;
  isCodex: boolean;
  modelFallback?: string;
}) {
  const { t } = useTranslation("settings");
  const effectiveModel = engine.model?.trim() || modelFallback?.trim() || null;
  return (
    <SettingsSection icon={Server} label={label} first={!isCodex}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t(`currentConfig.sourceDesc.${engine.source}`)}
        </p>
        <SourceBadge source={engine.source} />
      </div>

      {engine.source === "default" ? (
        <div className="space-y-1.5">
          <p className="rounded-md border border-dashed border-foreground/10 px-3 py-2 text-xs text-muted-foreground">
            {t("currentConfig.defaultHint")}
          </p>
          {/* A local model override still applies under the default source — surface it. */}
          {effectiveModel && <ConfigRow label={t("currentConfig.fields.model")} value={effectiveModel} />}
        </div>
      ) : (
        <div className="space-y-1.5">
          {isCodex && <ConfigRow label={t("currentConfig.fields.provider")} value={engine.providerName} mono={false} />}
          <ConfigRow label={t("currentConfig.fields.baseUrl")} value={engine.baseUrl} />
          <ConfigRow label={t("currentConfig.fields.token")} value={engine.maskedToken} />
          <ConfigRow label={t("currentConfig.fields.model")} value={effectiveModel} />
        </div>
      )}
    </SettingsSection>
  );
}

export const CurrentConfigSettings = memo(function CurrentConfigSettings({
  modelFallbacks,
}: {
  modelFallbacks?: { claude?: string; codex?: string };
}) {
  const { t } = useTranslation("settings");
  const [data, setData] = useState<EffectiveCliConfig | null>(null);

  const refresh = useCallback(async () => {
    setData(await window.claude.ccConfig.effective());
  }, []);

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
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          {data && (
            <>
              <EngineCard
                label={t("currentConfig.claude")}
                engine={data.claude}
                isCodex={false}
                modelFallback={modelFallbacks?.claude}
              />
              <EngineCard
                label={t("currentConfig.codex")}
                engine={data.codex}
                isCodex={true}
                modelFallback={modelFallbacks?.codex}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
