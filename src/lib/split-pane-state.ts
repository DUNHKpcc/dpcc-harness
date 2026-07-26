import type {
  ACPConfigOption,
  ACPPermissionEvent,
  ContextUsage,
  PermissionRequest,
  SessionInfo,
  SlashCommand,
  UIMessage,
  UpstreamRequestRecord,
} from "@/types";

export interface SplitPaneStateSnapshot {
  sessionId: string;
  messages: UIMessage[];
  isProcessing: boolean;
  isConnected: boolean;
  isCompacting: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  upstreamRequestCount: number;
  requestLog: UpstreamRequestRecord[];
  contextUsage: ContextUsage | null;
  pendingPermission: PermissionRequest | null;
  rawAcpPermission: ACPPermissionEvent | null;
  configOptions: ACPConfigOption[];
  slashCommands: SlashCommand[];
}

type SplitPaneStateEvent =
  | { type: "update"; snapshot: SplitPaneStateSnapshot }
  | { type: "remove"; snapshot: SplitPaneStateSnapshot };

const snapshots = new Map<string, SplitPaneStateSnapshot>();
const listeners = new Set<(event: SplitPaneStateEvent) => void>();
const routingReadySessionIds = new Map<string, number>();
const snapshotOwners = new Map<string, number>();

export function markSplitPaneRoutingReady(sessionId: string): void {
  routingReadySessionIds.set(
    sessionId,
    (routingReadySessionIds.get(sessionId) ?? 0) + 1,
  );
}

export function markSplitPaneRoutingNotReady(sessionId: string): void {
  const remaining = (routingReadySessionIds.get(sessionId) ?? 0) - 1;
  if (remaining > 0) {
    routingReadySessionIds.set(sessionId, remaining);
  } else {
    routingReadySessionIds.delete(sessionId);
  }
}

export function isSplitPaneRoutingReady(sessionId: string): boolean {
  return (routingReadySessionIds.get(sessionId) ?? 0) > 0;
}

export function retainSplitPaneStateSnapshot(sessionId: string): void {
  snapshotOwners.set(sessionId, (snapshotOwners.get(sessionId) ?? 0) + 1);
}

export function releaseSplitPaneStateSnapshot(sessionId: string): void {
  const remaining = (snapshotOwners.get(sessionId) ?? 0) - 1;
  if (remaining > 0) {
    snapshotOwners.set(sessionId, remaining);
    return;
  }
  snapshotOwners.delete(sessionId);
  removeSplitPaneStateSnapshot(sessionId);
}

export function publishSplitPaneStateSnapshot(snapshot: SplitPaneStateSnapshot): void {
  snapshots.set(snapshot.sessionId, snapshot);
  for (const listener of listeners) {
    listener({ type: "update", snapshot });
  }
}

export function removeSplitPaneStateSnapshot(sessionId: string): void {
  const snapshot = snapshots.get(sessionId);
  if (!snapshot) return;
  snapshots.delete(sessionId);
  for (const listener of listeners) {
    listener({ type: "remove", snapshot });
  }
}

export function getSplitPaneStateSnapshot(
  sessionId: string,
): SplitPaneStateSnapshot | null {
  return snapshots.get(sessionId) ?? null;
}

export function subscribeSplitPaneState(
  listener: (event: SplitPaneStateEvent) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
