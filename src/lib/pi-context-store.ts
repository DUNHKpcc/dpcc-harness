import { useCallback, useSyncExternalStore } from "react";
import type { PiContextSnapshot } from "@/types/pi-context";
import {
  appendPiContextSnapshot,
  parsePiContextSnapshot,
  parsePiContextBridgeMessage,
} from "./pi-context-bridge";

const snapshotsBySession = new Map<string, PiContextSnapshot[]>();
const listeners = new Set<() => void>();
const EMPTY_SNAPSHOTS: readonly PiContextSnapshot[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

export function getPiContextSnapshots(sessionId: string | null | undefined): readonly PiContextSnapshot[] {
  if (!sessionId) return EMPTY_SNAPSHOTS;
  return snapshotsBySession.get(sessionId) ?? EMPTY_SNAPSHOTS;
}

export function recordPiContextSnapshot(sessionId: string, snapshot: PiContextSnapshot): void {
  const previous = snapshotsBySession.get(sessionId) ?? EMPTY_SNAPSHOTS;
  const next = appendPiContextSnapshot(previous, snapshot);
  snapshotsBySession.set(sessionId, next);
  notify();
}

export function recordPiContextBridgeMessage(
  sessionId: string | null | undefined,
  text: string,
): PiContextSnapshot | null {
  const snapshot = parsePiContextBridgeMessage(text);
  if (!snapshot || !sessionId) return snapshot;
  recordPiContextSnapshot(sessionId, snapshot);
  return snapshot;
}

export function replacePiContextSnapshots(sessionId: string, values: readonly unknown[]): void {
  let next: PiContextSnapshot[] = [];
  for (const value of values) {
    const source = typeof value === "object" && value !== null
      && (value as { source?: unknown }).source === "legacy"
      ? "legacy"
      : "pi-extension";
    const snapshot = parsePiContextSnapshot(value, source);
    if (snapshot) next = appendPiContextSnapshot(next, snapshot);
  }
  if (next.length === 0) {
    snapshotsBySession.delete(sessionId);
  } else {
    snapshotsBySession.set(sessionId, next);
  }
  notify();
}

export function clearPiContextSnapshots(sessionId: string): void {
  if (!snapshotsBySession.delete(sessionId)) return;
  notify();
}

export function subscribePiContextSnapshots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePiContextSnapshots(
  sessionId: string | null | undefined,
): readonly PiContextSnapshot[] {
  const getSnapshot = useCallback(() => getPiContextSnapshots(sessionId), [sessionId]);
  return useSyncExternalStore(subscribePiContextSnapshots, getSnapshot, getSnapshot);
}
