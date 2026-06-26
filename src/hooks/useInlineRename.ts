import { useState, useCallback, useRef } from "react";

interface UseInlineRenameOptions {
  initialName: string;
  onRename: (newName: string) => void;
}

interface UseInlineRenameReturn {
  isEditing: boolean;
  editName: string;
  startEditing: () => void;
  setEditName: (name: string) => void;
  inputProps: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    autoFocus: boolean;
  };
}

/**
 * Manages inline rename editing state for sidebar items.
 *
 * Provides `inputProps` to spread onto an `<input>` element.
 * Saves on blur and Enter, cancels on Escape.
 * Trims whitespace before saving and skips if empty or unchanged.
 */
export function useInlineRename({
  initialName,
  onRename,
}: UseInlineRenameOptions): UseInlineRenameReturn {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(initialName);

  // Ref to guard against the blur handler firing after Enter already committed.
  // Without this, pressing Enter calls handleSave (which exits editing),
  // then the blur event fires on the now-unmounting input and calls handleSave
  // a second time with stale state.
  const committedRef = useRef(false);

  const handleSave = useCallback((nextName = editName) => {
    if (committedRef.current) return;
    committedRef.current = true;

    const trimmed = nextName.trim();
    if (trimmed && trimmed !== initialName) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editName, initialName, onRename]);

  const handleCancel = useCallback(() => {
    committedRef.current = true;
    setIsEditing(false);
  }, []);

  const startEditing = useCallback(() => {
    committedRef.current = false;
    setEditName(initialName);
    setIsEditing(true);
  }, [initialName]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value),
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave(e.currentTarget.value);
      }
      if (e.key === "Escape") handleCancel();
    },
    [handleSave, handleCancel],
  );

  return {
    isEditing,
    editName,
    startEditing,
    setEditName,
    inputProps: {
      value: editName,
      onChange: handleChange,
      onBlur: (e) => handleSave(e.currentTarget.value),
      onKeyDown: handleKeyDown,
      autoFocus: true,
    },
  };
}
