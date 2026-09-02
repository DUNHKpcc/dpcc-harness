import { memo, useMemo } from "react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import type {
  ACPConfigSelectGroup,
  ACPConfigSelectOption,
} from "@/types";
import { cn } from "@/lib/utils";
import { ModelLabel } from "@/components/ModelIcon";

export interface ModelOptionItem {
  id: string;
  label: string;
  description?: string | null;
  groupId?: string;
  groupLabel?: string;
}

interface ModelOptionGroup {
  id: string;
  label?: string;
  items: ModelOptionItem[];
}

function providerLabel(providerId: string): string {
  return providerId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toQualifiedModelItem(option: ACPConfigSelectOption): ModelOptionItem {
  const separator = option.value.indexOf("/");
  if (separator <= 0 || separator === option.value.length - 1) {
    return {
      id: option.value,
      label: option.name || option.value,
      description: option.description,
    };
  }

  const providerId = option.value.slice(0, separator);
  const modelId = option.value.slice(separator + 1);
  const qualifiedPrefix = `${providerId}/`;
  let label = option.name.startsWith(qualifiedPrefix)
    ? option.name.slice(qualifiedPrefix.length)
    : option.name;
  let groupLabel = providerLabel(providerId);

  // Managed Pi providers repeat their display name at the end of every model.
  // Keep that information once as the group heading instead of in every row.
  if (providerId.startsWith("pcc-agent-")) {
    const providerSuffix = /^(.*?)\s+\((.+)\)$/.exec(label);
    if (providerSuffix) {
      label = providerSuffix[1].trim();
      groupLabel = providerSuffix[2].trim();
    }
  }

  return {
    id: option.value,
    label: label || modelId,
    description: option.description,
    groupId: providerId,
    groupLabel,
  };
}

export function toAcpModelOptionItems(
  options: ACPConfigSelectOption[] | ACPConfigSelectGroup[],
): ModelOptionItem[] {
  if (options.length === 0) return [];
  if ("value" in options[0]) {
    return (options as ACPConfigSelectOption[]).map(toQualifiedModelItem);
  }

  return (options as ACPConfigSelectGroup[]).flatMap((group) =>
    group.options.map((option) => ({
      ...toQualifiedModelItem(option),
      groupId: group.group,
      groupLabel: group.name,
    })),
  );
}

function groupModelOptionItems(items: ModelOptionItem[]): ModelOptionGroup[] {
  const groups = new Map<string, ModelOptionGroup>();
  for (const item of items) {
    const id = item.groupId ?? "__ungrouped";
    const existing = groups.get(id);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(id, {
        id,
        label: item.groupLabel,
        items: [item],
      });
    }
  }
  return Array.from(groups.values());
}

export function selectedModelOptionLabel(
  items: ModelOptionItem[],
  selectedId: string,
  fallback = selectedId,
): string {
  return items.find((item) => item.id === selectedId)?.label ?? fallback;
}

interface ModelOptionListProps {
  items: ModelOptionItem[];
  selectedId: string;
  onSelect: (modelId: string) => void;
  keepOpenOnSelect?: boolean;
  constrainHeight?: boolean;
  className?: string;
}

/** Shared, height-constrained model list for ACP agents. */
export const ModelOptionList = memo(function ModelOptionList({
  items,
  selectedId,
  onSelect,
  keepOpenOnSelect = false,
  constrainHeight = true,
  className,
}: ModelOptionListProps) {
  const groups = useMemo(() => groupModelOptionItems(items), [items]);

  return (
    <div
      data-slot="model-option-list"
      className={cn(
        constrainHeight
          ? "max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain py-0.5"
          : "py-0.5",
        className,
      )}
      style={constrainHeight ? { scrollbarGutter: "stable" } : undefined}
    >
      {groups.map((group) => (
        <DropdownMenuGroup key={group.id}>
          {group.label && (
            <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
          )}
          {group.items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={(event) => {
                if (keepOpenOnSelect) event.preventDefault();
                onSelect(item.id);
              }}
              className={item.id === selectedId ? "bg-accent" : ""}
            >
              <div className="min-w-0 flex-1">
                <ModelLabel
                  model={item.id}
                  label={item.label}
                  iconSize={14}
                  className="w-full"
                />
                {item.description && (
                  <div className="line-clamp-2 text-[10px] text-muted-foreground">
                    {item.description}
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ))}
    </div>
  );
});
