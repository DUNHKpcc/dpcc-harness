import { useCallback, useRef, useState } from "react";
import {
  APP_SIDEBAR_WIDTH,
  MAX_APP_SIDEBAR_WIDTH,
  MIN_APP_SIDEBAR_WIDTH,
} from "@/lib/layout/constants";
import { useDocumentMouseDrag } from "./useDocumentMouseDrag";

const WIDTH_STORAGE_KEY = "sidebar-width";

function readStoredWidth(): number {
  const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
  if (!raw) return APP_SIDEBAR_WIDTH;
  const n = Number(raw);
  if (!Number.isFinite(n)) return APP_SIDEBAR_WIDTH;
  return Math.max(MIN_APP_SIDEBAR_WIDTH, Math.min(MAX_APP_SIDEBAR_WIDTH, n));
}

export function useSidebar() {
  const [isOpen, setIsOpen] = useState(() => {
    return localStorage.getItem("sidebar-open") !== "false";
  });
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const bindDocumentMouseDrag = useDocumentMouseDrag();

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-open", String(next));
      return next;
    });
  }, []);

  const widthRef = useRef(width);
  widthRef.current = width;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(
        MIN_APP_SIDEBAR_WIDTH,
        Math.min(MAX_APP_SIDEBAR_WIDTH, startWidth + delta),
      );
      setWidth(next);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
    };

    bindDocumentMouseDrag(onMouseMove, onMouseUp);
  }, [bindDocumentMouseDrag]);

  return { isOpen, toggle, setIsOpen, width, isResizing, handleResizeStart };
}
