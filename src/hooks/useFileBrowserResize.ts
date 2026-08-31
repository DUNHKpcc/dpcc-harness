import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useDocumentMouseDrag } from "@/hooks/useDocumentMouseDrag";
import {
  FILE_BROWSER_LIST_MIN_WIDTH,
  FILE_BROWSER_PREVIEW_MIN_WIDTH,
  FILE_BROWSER_RESIZE_HANDLE_WIDTH,
} from "@/lib/layout/constants";

const STORAGE_KEY = "harnss-file-browser-list-width";
const DEFAULT_LIST_WIDTH = 360;

function getStoredWidth(): number {
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored >= FILE_BROWSER_LIST_MIN_WIDTH
    ? stored
    : DEFAULT_LIST_WIDTH;
}

export function useFileBrowserResize() {
  const [listWidth, setListWidth] = useState(getStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const listWidthRef = useRef(listWidth);
  const bindDocumentMouseDrag = useDocumentMouseDrag();

  listWidthRef.current = listWidth;

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = listWidthRef.current;
    setIsResizing(true);

    bindDocumentMouseDrag(
      (moveEvent) => {
        const containerWidth = contentRef.current?.clientWidth ?? window.innerWidth;
        const maxWidth = Math.max(
          FILE_BROWSER_LIST_MIN_WIDTH,
          containerWidth - FILE_BROWSER_PREVIEW_MIN_WIDTH - FILE_BROWSER_RESIZE_HANDLE_WIDTH,
        );
        const nextWidth = Math.max(
          FILE_BROWSER_LIST_MIN_WIDTH,
          Math.min(maxWidth, startWidth - (moveEvent.clientX - startX)),
        );
        listWidthRef.current = nextWidth;
        setListWidth(nextWidth);
      },
      () => {
        setIsResizing(false);
        window.localStorage.setItem(STORAGE_KEY, String(Math.round(listWidthRef.current)));
      },
    );
  }, [bindDocumentMouseDrag]);

  return {
    contentRef,
    isResizing,
    handleResizeStart,
    contentStyle: {
      "--file-browser-list-width": `${listWidth}px`,
      "--file-browser-list-min-width": `${FILE_BROWSER_LIST_MIN_WIDTH}px`,
      "--file-browser-preview-min-width": `${FILE_BROWSER_PREVIEW_MIN_WIDTH}px`,
      "--file-browser-resize-handle-width": `${FILE_BROWSER_RESIZE_HANDLE_WIDTH}px`,
    } as CSSProperties,
  };
}
