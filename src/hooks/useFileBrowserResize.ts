import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useDocumentMouseDrag } from "@/hooks/useDocumentMouseDrag";

const STORAGE_KEY = "harnss-file-browser-list-width";
const DEFAULT_LIST_WIDTH = 360;
const MIN_LIST_WIDTH = 280;
const MIN_PREVIEW_WIDTH = 240;

function getStoredWidth(): number {
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored >= MIN_LIST_WIDTH ? stored : DEFAULT_LIST_WIDTH;
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
        const maxWidth = Math.max(MIN_LIST_WIDTH, containerWidth - MIN_PREVIEW_WIDTH);
        const nextWidth = Math.max(
          MIN_LIST_WIDTH,
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
    } as CSSProperties,
  };
}
