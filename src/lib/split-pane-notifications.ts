import type { PermissionRequest } from "@/types";

export interface SplitPaneNotificationSnapshot {
  sessionId: string;
  actor: string;
  isProcessing: boolean;
  pendingPermission: PermissionRequest | null;
  completionEventId: string;
}

export type SplitPaneNotificationEvent =
  | { type: "update"; snapshot: SplitPaneNotificationSnapshot }
  | { type: "remove"; sessionId: string };

export interface SplitPaneNotificationTrackingState {
  isProcessing: boolean;
  permissionRequestId: string | null;
}

export interface SplitPaneNotificationTransition {
  completed: boolean;
  permissionRequested: boolean;
  clearedPermissionRequestId: string | null;
  tracked: SplitPaneNotificationTrackingState;
}

type SplitPaneNotificationListener = (event: SplitPaneNotificationEvent) => void;

const snapshots = new Map<string, SplitPaneNotificationSnapshot>();
const listeners = new Set<SplitPaneNotificationListener>();

export function publishSplitPaneNotificationSnapshot(
  snapshot: SplitPaneNotificationSnapshot,
): void {
  snapshots.set(snapshot.sessionId, snapshot);
  for (const listener of listeners) {
    listener({ type: "update", snapshot });
  }
}

export function removeSplitPaneNotificationSnapshot(sessionId: string): void {
  if (!snapshots.delete(sessionId)) return;
  for (const listener of listeners) {
    listener({ type: "remove", sessionId });
  }
}

export function subscribeSplitPaneNotifications(
  listener: SplitPaneNotificationListener,
): () => void {
  listeners.add(listener);
  for (const snapshot of snapshots.values()) {
    listener({ type: "update", snapshot });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function advanceSplitPaneNotificationTracking(
  previous: SplitPaneNotificationTrackingState | undefined,
  snapshot: SplitPaneNotificationSnapshot,
): SplitPaneNotificationTransition {
  const requestId = snapshot.pendingPermission?.requestId ?? null;
  if (!previous) {
    return {
      completed: false,
      permissionRequested: requestId !== null,
      clearedPermissionRequestId: null,
      tracked: {
        isProcessing: snapshot.isProcessing,
        permissionRequestId: requestId,
      },
    };
  }

  return {
    completed: previous.isProcessing && !snapshot.isProcessing,
    permissionRequested: requestId !== null && requestId !== previous.permissionRequestId,
    clearedPermissionRequestId: previous.permissionRequestId !== null
      && previous.permissionRequestId !== requestId
      ? previous.permissionRequestId
      : null,
    tracked: {
      isProcessing: snapshot.isProcessing,
      permissionRequestId: requestId,
    },
  };
}

export function resetSplitPaneNotificationsForTesting(): void {
  snapshots.clear();
  listeners.clear();
}
