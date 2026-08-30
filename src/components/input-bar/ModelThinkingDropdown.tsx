import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ACPConfigOption } from "@/types";
import { flattenConfigOptions } from "@/lib/engine/acp-utils";
import {
  getPiThinkingDisplayLevel,
  getPiThinkingProfile,
  normalizeModelId,
  type PiThinkingLevel,
} from "@shared/lib/model-effort-capabilities";
import {
  ModelOptionList,
  selectedModelOptionLabel,
  toAcpModelOptionItems,
} from "./ModelOptionList";
import { TOOLBAR_BTN } from "./constants";

interface ThinkingOptionItem {
  value: string;
  label: string;
  description?: string;
}

interface ModelThinkingDropdownProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  isProcessing: boolean;
  acpConfigOptions?: ACPConfigOption[];
  acpConfigOptionsLoading?: boolean;
  onACPConfigChange?: (configId: string, value: string) => void;
}

function findAcpOption(
  options: ACPConfigOption[] | undefined,
  kind: "model" | "thinking",
): ACPConfigOption | undefined {
  return options?.find((option) => kind === "model"
    ? option.id === "model" || option.category === "model"
    : option.id === "thought_level"
      || option.category === "thought_level"
      || option.id === "mode"
      || option.category === "mode");
}

function compactAcpValueLabel(option: ACPConfigOption, label: string): string {
  const prefix = `${option.name}:`;
  return label.toLowerCase().startsWith(prefix.toLowerCase())
    ? label.slice(prefix.length).trim()
    : label;
}

function acpCurrentLabel(option: ACPConfigOption | undefined): string {
  if (!option) return "";
  const current = flattenConfigOptions(option.options).find(
    (candidate) => candidate.value === option.currentValue,
  );
  return compactAcpValueLabel(option, current?.name ?? option.currentValue);
}

function managedDpccPiModelId(value: string | undefined): string | undefined {
  const model = value?.trim();
  return model?.startsWith("pcc-agent-dpcc-") ? normalizeModelId(model) : undefined;
}

/** One menu with an internally scrolling model list and a fixed thinking panel. */
export const ModelThinkingDropdown = memo(function ModelThinkingDropdown({
  open,
  onOpenChange,
  isProcessing,
  acpConfigOptions,
  acpConfigOptionsLoading,
  onACPConfigChange,
}: ModelThinkingDropdownProps) {
  const { t } = useTranslation("input");
  const acpModelOption = findAcpOption(acpConfigOptions, "model");
  const acpThinkingOption = findAcpOption(acpConfigOptions, "thinking");
  const acpModelItems = acpModelOption
    ? toAcpModelOptionItems(acpModelOption.options)
    : [];
  const dpccPiModelId = managedDpccPiModelId(acpModelOption?.currentValue);
  const piThinkingProfile = dpccPiModelId
    ? getPiThinkingProfile(dpccPiModelId)
    : undefined;
  const acpThinkingItems = acpThinkingOption
    ? flattenConfigOptions(acpThinkingOption.options).filter((option) =>
        piThinkingProfile === undefined
          || piThinkingProfile?.levels.includes(option.value as PiThinkingLevel),
      )
    : [];
  const thinkingItems: ThinkingOptionItem[] = acpThinkingItems.map((option) => ({
    value: option.value,
    label: dpccPiModelId
      ? getPiThinkingDisplayLevel(dpccPiModelId, option.value)
      : acpThinkingOption
        ? compactAcpValueLabel(acpThinkingOption, option.name)
        : option.name,
    description: option.description ?? undefined,
  }));
  const selectedThinkingValue = acpThinkingOption?.currentValue ?? "";
  const activeModelLabel = selectedModelOptionLabel(
    acpModelItems,
    acpModelOption?.currentValue ?? "",
    acpCurrentLabel(acpModelOption),
  );
  const activeThinkingLabel = thinkingItems.find(
    (option) => option.value === selectedThinkingValue,
  )?.label ?? "";
  const canChangeThinking = !!acpThinkingOption && !!onACPConfigChange;
  const hasThinkingOptions = thinkingItems.length > 0 && canChangeThinking;
  const hasModelOptions = acpModelItems.length > 0 && !!acpModelOption && !!onACPConfigChange;
  const showThinkingPanel = hasModelOptions || hasThinkingOptions;
  const isLoading = !!acpConfigOptionsLoading && (acpConfigOptions?.length ?? 0) === 0;

  const handleThinkingSelect = (value: string) => {
    if (acpThinkingOption && onACPConfigChange) {
      onACPConfigChange(acpThinkingOption.id, value);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={`${TOOLBAR_BTN} min-w-0 max-w-[70%] shrink`}
          disabled={isProcessing}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
          ) : (
            <>
              {activeModelLabel && (
                <span className="min-w-0 truncate" title={activeModelLabel}>
                  {activeModelLabel}
                </span>
              )}
              {activeThinkingLabel && (
                <span className="shrink-0 text-muted-foreground/70">
                  · {activeThinkingLabel}
                </span>
              )}
            </>
          )}
          <ChevronDown className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="flex w-72 flex-col"
        style={{
          maxHeight: "min(32rem, var(--radix-dropdown-menu-content-available-height))",
          overflow: "hidden",
        }}
      >
        {isLoading && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("engine.loadingOptions")}
          </DropdownMenuItem>
        )}
        {!isLoading && hasModelOptions && (
          <DropdownMenuGroup className="flex min-h-24 flex-1 flex-col overflow-hidden">
            <DropdownMenuLabel className="shrink-0 text-[10px] font-medium text-muted-foreground">
              {t("engine.model")}
            </DropdownMenuLabel>
            <ModelOptionList
              items={acpModelItems}
              selectedId={acpModelOption?.currentValue ?? ""}
              onSelect={acpModelOption && onACPConfigChange
                ? (value) => onACPConfigChange(acpModelOption.id, value)
                : () => {}}
              keepOpenOnSelect
              constrainHeight={false}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            />
          </DropdownMenuGroup>
        )}
        {!isLoading && hasModelOptions && <DropdownMenuSeparator className="shrink-0" />}
        {!isLoading && showThinkingPanel && (
          <DropdownMenuGroup data-slot="thinking-option-panel" className="shrink-0">
            <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
              {acpThinkingOption?.name
                ? acpThinkingOption.name
                : t("engine.thinking")}
            </DropdownMenuLabel>
            <div className="max-h-60 overflow-x-hidden overflow-y-auto overscroll-contain">
              {hasThinkingOptions ? thinkingItems.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => handleThinkingSelect(option.value)}
                  className={option.value === selectedThinkingValue ? "bg-accent" : ""}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate capitalize" title={option.label}>
                      {option.label}
                    </div>
                    {option.description && (
                      <div className="line-clamp-2 text-[10px] text-muted-foreground">
                        {option.description}
                      </div>
                    )}
                  </div>
                </DropdownMenuItem>
              )) : (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {t("engine.noThinkingOptions")}
                </DropdownMenuItem>
              )}
            </div>
          </DropdownMenuGroup>
        )}
        {!isLoading && !hasModelOptions && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            {t("engine.noOptions")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
