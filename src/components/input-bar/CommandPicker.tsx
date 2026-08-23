import { useState, useRef, useMemo, useCallback, memo } from "react";
import type { SlashCommand } from "@/types";
import { getSlashCommandReplacement } from "./input-bar-utils";
import { ComposerSuggestionList } from "./ComposerSuggestionList";

// ── Hook: slash command autocomplete state ──

export interface UseCommandAutocompleteOptions {
  availableSlashCommands: SlashCommand[];
  editableRef: React.RefObject<HTMLDivElement | null>;
}

export function useCommandAutocomplete({
  availableSlashCommands,
  editableRef,
}: UseCommandAutocompleteOptions) {
  const [showCommands, setShowCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Memoized filtered results. No hard cap -- the dropdown scrolls within
  // its max-height, so showing the full command list is fine and avoids
  // hiding commands that exist beyond an arbitrary cutoff.
  const cmdResults = useMemo(() => {
    if (!showCommands || availableSlashCommands.length === 0) return [];
    const q = commandQuery.toLowerCase();
    if (!q) return availableSlashCommands;
    return availableSlashCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    );
  }, [showCommands, availableSlashCommands, commandQuery]);

  const selectCommand = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.disabled) return false;
      setShowCommands(false);
      const el = editableRef.current;
      if (!el) return;

      el.textContent = getSlashCommandReplacement(cmd);

      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.focus();

      // Signal content changed (caller should update hasContent)
      return true;
    },
    [editableRef],
  );

  /** Detect slash command trigger from the editable's full text content. */
  const detectCommandTrigger = useCallback(
    (fullText: string) => {
      const slashMatch = fullText.trimStart().match(/^\/(\S*)$/);
      if (slashMatch && availableSlashCommands.length > 0) {
        setShowCommands(true);
        setCommandQuery(slashMatch[1]);
        setCommandIndex(0);
      } else if (showCommands) {
        setShowCommands(false);
      }
    },
    [showCommands, availableSlashCommands],
  );

  return {
    showCommands,
    setShowCommands,
    commandIndex,
    setCommandIndex,
    cmdResults,
    commandListRef,
    selectCommand,
    detectCommandTrigger,
  };
}

// ── Component: slash command picker dropdown ──

export interface CommandPickerProps {
  cmdResults: SlashCommand[];
  commandIndex: number;
  commandListRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
}

function CommandGlyph({
  iconUrl,
  usesDollarPrefix,
}: {
  iconUrl?: string;
  usesDollarPrefix: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (iconUrl && !imageFailed) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-4 w-4 shrink-0 rounded"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
      {usesDollarPrefix ? "$" : "/"}
    </span>
  );
}

/** Autocomplete dropdown for slash commands. */
export const CommandPicker = memo(function CommandPicker({
  cmdResults,
  commandIndex,
  commandListRef,
  onSelect,
  onHover,
}: CommandPickerProps) {
  return (
    <ComposerSuggestionList
      items={cmdResults}
      activeIndex={commandIndex}
      listRef={commandListRef}
      getItemKey={(cmd) => {
        const commandName = cmd.source === "codex-app"
          ? (cmd.appSlug ?? cmd.name)
          : cmd.name;
        return `${cmd.source}-${commandName}`;
      }}
      isItemDisabled={(cmd) => !!cmd.disabled}
      onSelect={onSelect}
      onHover={onHover}
    >
      {(cmd) => {
        const commandName = cmd.source === "codex-app" ? (cmd.appSlug ?? cmd.name) : cmd.name;
        const usesDollarPrefix = cmd.source === "codex-skill" || cmd.source === "codex-app";
        return (
          <>
            <CommandGlyph
              iconUrl={cmd.iconUrl}
              usesDollarPrefix={usesDollarPrefix}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-medium">
                  {usesDollarPrefix ? "$" : "/"}
                  {commandName}
                </span>
                {cmd.argumentHint && (
                  <span className="text-xs text-muted-foreground">
                    {cmd.argumentHint}
                  </span>
                )}
              </div>
              {cmd.description && (
                <div className="truncate text-xs text-muted-foreground">
                  {cmd.description}
                </div>
              )}
            </div>
          </>
        );
      }}
    </ComposerSuggestionList>
  );
});
