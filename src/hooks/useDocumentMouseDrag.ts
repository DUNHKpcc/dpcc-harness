import { useCallback, useEffect, useRef } from "react";

export function useDocumentMouseDrag() {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  return useCallback((onMove: (event: MouseEvent) => void, onUp: (event: MouseEvent) => void) => {
    cleanupRef.current?.();

    function cleanup() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", handleUp);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    }

    function handleUp(event: MouseEvent) {
      cleanup();
      onUp(event);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", handleUp);
    cleanupRef.current = cleanup;
  }, []);
}
