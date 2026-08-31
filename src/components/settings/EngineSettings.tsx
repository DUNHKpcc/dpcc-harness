import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { PiLogo } from "@/components/PiLogo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SettingRow, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { CODEX_GATEWAY_MODEL_PRESETS, buildGatewayModelMappings } from "@/lib/gateway-models";
import { resolveGatewayConfigSource } from "@shared/lib/upstream-routing";
import { OpenAiGatewayEditor } from "./GatewaySettings";
import type { AppSettings, PiGatewaySettings } from "@/types";
import type { PiRuntimeBinaryStatus, PiRuntimeStatus } from "@shared/types/registry";

interface EngineSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const PI_GATEWAY_DEFAULT: PiGatewaySettings = {
  enabled: false,
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  modelMappings: CODEX_GATEWAY_MODEL_PRESETS,
};

export function RuntimeBinaryDetails({ status }: { status: PiRuntimeBinaryStatus }) {
  const { t } = useTranslation("settings");
  const statusClass = status.status === "ok"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : status.status === "missing"
      ? "bg-red-500/15 text-red-700 dark:text-red-300"
      : "bg-amber-500/15 text-amber-700 dark:text-amber-300";

  return (
    <div className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex shrink-0 items-center gap-2">
        <code className="text-sm font-medium text-foreground">{status.binary}</code>
        <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${statusClass}`}>
          {t(`engines.pi.runtimeStatus.${status.status}`)}
        </span>
      </div>
      <div className="w-full min-w-0 text-xs sm:max-w-[70%] sm:text-right">
        {status.resolvedPath ? (
          <p
            className="truncate font-mono text-foreground/80"
            title={status.resolvedPath}
          >
            {status.resolvedPath}
          </p>
        ) : (
          <p className="text-foreground/80">{t("engines.pi.runtimeRepairHint")}</p>
        )}
        <p className="mt-1 text-muted-foreground">
          {status.actualVersion
            ? t("engines.pi.runtimeVersion", {
              actual: status.actualVersion,
              expected: status.expectedVersion,
            })
            : status.available
              ? t("engines.pi.runtimeVersionUnreadable", { expected: status.expectedVersion })
              : t("engines.pi.runtimeRepairHint")}
        </p>
      </div>
    </div>
  );
}

export const EngineSettings = memo(function EngineSettings({
  appSettings,
  onUpdateAppSettings,
}: EngineSettingsProps) {
  const { t } = useTranslation("settings");
  const [piGateway, setPiGateway] = useState<PiGatewaySettings>(PI_GATEWAY_DEFAULT);
  const [piGatewayOpen, setPiGatewayOpen] = useState(false);
  const [piUpstreamModels, setPiUpstreamModels] = useState<string[]>([]);
  const [piUpstreamError, setPiUpstreamError] = useState<string | null>(null);
  const [piModelsLoading, setPiModelsLoading] = useState(false);
  const [piRuntimeStatus, setPiRuntimeStatus] = useState<PiRuntimeStatus | null>(null);
  const [piRuntimeLoading, setPiRuntimeLoading] = useState(false);
  const [piRuntimeError, setPiRuntimeError] = useState(false);

  useEffect(() => {
    if (!appSettings) return;
    setPiGateway({
      ...PI_GATEWAY_DEFAULT,
      ...appSettings.piGateway,
      modelMappings: buildGatewayModelMappings("pi", appSettings.piGateway?.modelMappings),
    });
  }, [appSettings]);

  const refreshPiRuntimeStatus = useCallback(async () => {
    setPiRuntimeLoading(true);
    setPiRuntimeError(false);
    try {
      setPiRuntimeStatus(await window.claude.agents.getPiRuntimeStatus());
    } catch {
      setPiRuntimeError(true);
    } finally {
      setPiRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPiRuntimeStatus();
  }, [refreshPiRuntimeStatus]);

  const handlePiGatewayChange = useCallback(
    async (patch: Partial<PiGatewaySettings>) => {
      const next = { ...piGateway, ...patch };
      setPiGateway(next);
      await onUpdateAppSettings({
        piGateway: next,
        piCliConfigSource: resolveGatewayConfigSource({
          enabled: next.enabled,
          baseUrl: next.baseUrl,
          credential: next.apiKey,
        }),
      });
    },
    [onUpdateAppSettings, piGateway],
  );

  const handlePiGatewayEnabledChange = useCallback(
    (checked: boolean) => {
      setPiGatewayOpen(checked);
      void handlePiGatewayChange({ enabled: checked }).catch(() => {});
    },
    [handlePiGatewayChange],
  );

  const fetchPiGatewayModels = useCallback(async () => {
    setPiModelsLoading(true);
    setPiUpstreamError(null);
    try {
      const result = await window.claude.ccConfig.probeModels({
        baseUrl: piGateway.baseUrl,
        token: piGateway.apiKey,
      });
      setPiUpstreamModels(result.models ?? []);
      setPiUpstreamError(result.error);
    } finally {
      setPiModelsLoading(false);
    }
  }, [piGateway.apiKey, piGateway.baseUrl]);

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("engines.title")}
        description={t("engines.description")}
        actions={
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("engines.pi.runtimeRefresh")}
                  disabled={piRuntimeLoading}
                  onClick={() => void refreshPiRuntimeStatus()}
                >
                  <RefreshCw className={piRuntimeLoading ? "animate-spin" : ""} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("engines.pi.runtimeRefresh")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={PiLogo} label={t("engines.pi.section")} first>
            <div className="py-3">
              <p className="text-sm font-medium text-foreground">
                {t("engines.pi.runtimeLabel")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("engines.pi.runtimeDesc")}
              </p>
              {piRuntimeStatus && (
                <p className={`mt-2 text-xs font-medium ${
                  piRuntimeStatus.offlineReady
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-red-700 dark:text-red-300"
                }`}>
                  {t(piRuntimeStatus.offlineReady
                    ? "engines.pi.runtimeOfflineReady"
                    : "engines.pi.runtimeOfflineUnavailable")}
                </p>
              )}
              <div className="mt-2 divide-y divide-foreground/[0.06]">
                {piRuntimeStatus ? (
                  <>
                    <RuntimeBinaryDetails status={piRuntimeStatus.pi} />
                    <RuntimeBinaryDetails status={piRuntimeStatus.piAcp} />
                    <RuntimeBinaryDetails status={piRuntimeStatus.piMcpAdapter} />
                  </>
                ) : (
                  <p className="py-3 text-xs text-muted-foreground">
                    {piRuntimeError
                      ? t("engines.pi.runtimeLoadFailed")
                      : t("engines.pi.runtimeLoading")}
                  </p>
                )}
              </div>
            </div>
            <SettingRow
              label={t("engines.pi.gateway.toggleLabel")}
              description={t("engines.pi.gateway.toggleDesc")}
            >
              <Switch
                checked={piGateway.enabled}
                onCheckedChange={handlePiGatewayEnabledChange}
              />
            </SettingRow>
            {piGateway.enabled && (
              <OpenAiGatewayEditor
                engine="pi"
                gateway={piGateway}
                open={piGatewayOpen}
                onOpenChange={setPiGatewayOpen}
                upstreamModels={piUpstreamModels}
                upstreamError={piUpstreamError}
                loading={piModelsLoading}
                onFetch={fetchPiGatewayModels}
                onChange={handlePiGatewayChange}
              />
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
