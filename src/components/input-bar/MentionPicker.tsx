import { memo } from "react";
import { File, Folder } from "lucide-react";
import type { MentionEntry } from "./useMentionAutocomplete";
import { ComposerSuggestionList } from "./ComposerSuggestionList";

export interface MentionPickerProps {
  results: MentionEntry[];
  mentionIndex: number;
  mentionListRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (entry: MentionEntry) => void;
  onHover: (index: number) => void;
}

/** Autocomplete dropdown for @-mention file/folder references. */
export const MentionPicker = memo(function MentionPicker({
  results,
  mentionIndex,
  mentionListRef,
  onSelect,
  onHover,
}: MentionPickerProps) {
  return (
    <ComposerSuggestionList
      items={results}
      activeIndex={mentionIndex}
      listRef={mentionListRef}
      getItemKey={(entry) => entry.path}
      onSelect={onSelect}
      onHover={onHover}
    >
      {(entry) => (
        <>
          {entry.isDir ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          ) : (
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-xs">{entry.path}</span>
        </>
      )}
    </ComposerSuggestionList>
  );
});
