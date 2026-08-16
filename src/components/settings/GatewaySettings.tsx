import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SettingRow } from "@/components/settings/shared";
import {
  buildGatewayModelMappings,
  type GatewayEngine,
} from "@/lib/gateway-models";
import { isImeComposing } from "@/lib/utils";
import type {
  GatewayModelMapping,
  OpenAiCompatibleGatewaySettings,
} from "@/types";

const GATEWAY_INPUT_CLASS =
  "h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";
const GATEWAY_WIDE_INPUT_CLASS =
  "h-8 w-full rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20";

export const GatewayTextField = memo(function GatewayTextField({
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
      onChange={(event) => setLocal(event.target.value)}
      onBlur={(event) => {
        void Promise.resolve(onSave(event.target.value)).catch(() => {});
      }}
      onKeyDown={(event) => {
        if (isImeComposing(event)) return;
        if (event.key === "Enter") {
          void Promise.resolve(onSave(event.currentTarget.value)).catch(() => {});
        }
      }}
      spellCheck={false}
      autoComplete="off"
      className={GATEWAY_INPUT_CLASS}
      placeholder={placeholder}
    />
  );
});

export const GatewayModelField = memo(function GatewayModelField({
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
  const optionIds = Array.from(new Set([
    ...mappings.map((mapping) => mapping.modelId),
    ...upstreamModels,
  ].filter(Boolean)));

  return (
    <>
      <input
        type="text"
        value={local}
        list={datalistId}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={(event) => {
          void Promise.resolve(onSave(event.target.value.trim())).catch(() => {});
        }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) return;
          if (event.key === "Enter") {
            void Promise.resolve(onSave(event.currentTarget.value.trim())).catch(() => {});
          }
        }}
        spellCheck={false}
        autoComplete="off"
        className={GATEWAY_INPUT_CLASS}
        placeholder={placeholder}
      />
      <datalist id={datalistId}>
        {optionIds.map((modelId) => {
          const mapping = mappings.find((candidate) => candidate.modelId === modelId);
          return <option key={modelId} value={modelId} label={mapping?.displayName ?? modelId} />;
        })}
      </datalist>
    </>
  );
});

export const GatewayModelMappingsEditor = memo(function GatewayModelMappingsEditor({
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

  const commit = (next: GatewayModelMapping[]) => {
    onChange(buildGatewayModelMappings(engine, next));
  };
  const updateRow = (index: number, next: Partial<GatewayModelMapping>) => {
    commit(normalized.map((mapping, currentIndex) => (
      currentIndex === index ? { ...mapping, ...next } : mapping
    )));
  };
  const addEmptyRow = () => {
    commit([
      ...normalized,
      { displayName: "", modelId: `custom-model-${normalized.length + 1}` },
    ]);
  };
  const addUpstreamModel = (modelId: string) => {
    if (!modelId || normalized.some((mapping) => mapping.modelId === modelId)) return;
    commit([...normalized, { displayName: modelId, modelId }]);
  };
  const removeRow = (index: number) => {
    commit(normalized.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground/80">
            {t("engines.gatewayModels.title")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("engines.gatewayModels.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onFetch}
          disabled={loading}
        >
          {loading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          {loading ? t("engines.gatewayModels.loading") : t("engines.gatewayModels.fetch")}
        </Button>
      </div>

      {upstreamModels.length > 0 && (
        <select
          className={GATEWAY_WIDE_INPUT_CLASS}
          value=""
          onChange={(event) => addUpstreamModel(event.target.value)}
        >
          <option value="">
            {t("engines.gatewayModels.addFromUpstream", { count: upstreamModels.length })}
          </option>
          {upstreamModels.map((modelId) => (
            <option key={modelId} value={modelId}>{modelId}</option>
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
          <div
            key={`${mapping.modelId}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_auto] gap-2"
          >
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 px-2"
        onClick={addEmptyRow}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("engines.gatewayModels.add")}
      </Button>
    </div>
  );
});

export const OpenAiGatewayEditor = memo(function OpenAiGatewayEditor({
  engine,
  gateway,
  open,
  onOpenChange,
  upstreamModels,
  upstreamError,
  loading,
  onFetch,
  onChange,
}: {
  engine: "codex" | "pi";
  gateway: OpenAiCompatibleGatewaySettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upstreamModels: string[];
  upstreamError: string | null;
  loading: boolean;
  onFetch: () => void;
  onChange: (patch: Partial<OpenAiCompatibleGatewaySettings>) => void | Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const key = `engines.${engine}.gateway`;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground">
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        {t(`${key}.editLabel`)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-1 pt-1">
          <SettingRow label={t(`${key}.nameLabel`)} description={t(`${key}.nameDesc`)}>
            <GatewayTextField
              value={gateway.name}
              onSave={(value) => onChange({ name: value.trim() })}
              placeholder={t(`${key}.namePlaceholder`)}
            />
          </SettingRow>
          <SettingRow label={t(`${key}.baseUrlLabel`)} description={t(`${key}.baseUrlDesc`)}>
            <GatewayTextField
              value={gateway.baseUrl}
              onSave={(value) => onChange({ baseUrl: value.trim() })}
              placeholder={t(`${key}.baseUrlPlaceholder`)}
            />
          </SettingRow>
          <SettingRow label={t(`${key}.apiKeyLabel`)} description={t(`${key}.apiKeyDesc`)}>
            <GatewayTextField
              value={gateway.apiKey}
              onSave={(value) => onChange({ apiKey: value.trim() })}
              placeholder={t(`${key}.apiKeyPlaceholder`)}
              type="password"
            />
          </SettingRow>
          <SettingRow label={t(`${key}.modelLabel`)} description={t(`${key}.modelDesc`)}>
            <GatewayModelField
              value={gateway.model}
              mappings={gateway.modelMappings}
              upstreamModels={upstreamModels}
              onSave={(value) => onChange({ model: value.trim() })}
              placeholder={t(`${key}.modelPlaceholder`)}
              datalistId={`${engine}-gateway-default-models`}
            />
          </SettingRow>
          <GatewayModelMappingsEditor
            engine={engine}
            mappings={gateway.modelMappings}
            upstreamModels={upstreamModels}
            upstreamError={upstreamError}
            loading={loading}
            onFetch={onFetch}
            onChange={(modelMappings) => {
              void Promise.resolve(onChange({ modelMappings })).catch(() => {});
            }}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
