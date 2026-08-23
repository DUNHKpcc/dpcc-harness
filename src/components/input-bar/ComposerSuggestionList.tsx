import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

interface ComposerSuggestionListProps<T> {
  items: readonly T[];
  activeIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  getItemKey: (item: T, index: number) => string;
  isItemDisabled?: (item: T) => boolean;
  onSelect: (item: T) => void;
  onHover: (index: number) => void;
  children: (item: T, index: number) => ReactNode;
}

/** Shared detached suggestion surface for composer autocomplete. */
export function ComposerSuggestionList<T>({
  items,
  activeIndex,
  listRef,
  getItemKey,
  isItemDisabled,
  onSelect,
  onHover,
  children,
}: ComposerSuggestionListProps<T>) {
  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      data-composer-suggestion-list="true"
      className="max-h-80 overflow-y-auto rounded-2xl border border-border/60 bg-popover p-1 shadow-lg backdrop-blur-xl"
    >
      {items.map((item, index) => {
        const isDisabled = isItemDisabled?.(item) ?? false;
        const isActive = index === activeIndex;

        return (
          <button
            key={getItemKey(item, index)}
            data-active={isActive}
            disabled={isDisabled}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm transition-colors",
              isDisabled
                ? "cursor-not-allowed opacity-50"
                : isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground hover:bg-muted/40",
            )}
            onMouseDown={(event) => {
              event.preventDefault();
              if (!isDisabled) onSelect(item);
            }}
            onMouseEnter={() => onHover(index)}
          >
            {children(item, index)}
          </button>
        );
      })}
    </div>
  );
}
