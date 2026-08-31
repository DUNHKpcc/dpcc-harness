import { useState, useRef, useMemo, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import type { InstalledAgent, SlashCommand } from "@/types";
import { getSlashCommandReplacement } from "./input-bar-utils";
import { ComposerSuggestionList } from "./ComposerSuggestionList";
import {
  commandMatchesQuery,
  getCommandPresentation,
} from "./command-presentation";

// ── Hook: slash command autocomplete state ──

export interface UseCommandAutocompleteOptions {
  availableSlashCommands: SlashCommand[];
  editableRef: React.RefObject<HTMLDivElement | null>;
  commandAgent?: InstalledAgent | null;
}

export function useCommandAutocomplete({
  availableSlashCommands,
  editableRef,
  commandAgent,
}: UseCommandAutocompleteOptions) {
  const { t } = useTranslation("input");
  const [showCommands, setShowCommands] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Memoized filtered results. No hard cap -- the dropdown scrolls within
  // its max-height, so showing the full command list is fine and avoids
  // hiding commands that exist beyond an arbitrary cutoff.
  const cmdResults = useMemo(() => {
    if (!showCommands || availableSlashCommands.length === 0) return [];
    const q = commandQuery.trim();
    if (!q) return availableSlashCommands;
    return availableSlashCommands.filter((cmd) =>
      commandMatchesQuery(cmd, q, commandAgent, t),
    );
  }, [showCommands, availableSlashCommands, commandQuery, commandAgent, t]);

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
  commandAgent?: InstalledAgent | null;
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
  commandAgent,
  onSelect,
  onHover,
}: CommandPickerProps) {
  const { t } = useTranslation("input");

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
        const presentation = getCommandPresentation(cmd, commandAgent, t);

        if (presentation.isLocalizedBasicCommand && presentation.icon) {
          const CommandIcon = presentation.icon;
          return (
            <>
              <CommandIcon
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.8}
              />
              <div
                className="grid min-w-0 flex-1 grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] items-center gap-4"
                data-command-name={commandName}
              >
                <span className="truncate font-medium">
                  {presentation.label}
                </span>
                <span
                  className="truncate text-right text-xs text-muted-foreground"
                  title={presentation.description}
                >
                  {presentation.description}
                </span>
                <span className="sr-only">
                  /{commandName}
                  {presentation.argumentHint ? ` ${presentation.argumentHint}` : ""}
                </span>
              </div>
            </>
          );
        }

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
                  {presentation.description}
                </div>
              )}
            </div>
          </>
        );
      }}
    </ComposerSuggestionList>
  );
});
