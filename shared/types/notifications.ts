export const APP_NOTIFICATION_KINDS = [
  "approval",
  "information",
  "task-complete",
] as const;

export type AppNotificationKind = typeof APP_NOTIFICATION_KINDS[number];

export function isAppNotificationKind(value: unknown): value is AppNotificationKind {
  return typeof value === "string"
    && (APP_NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export interface AppNotificationPayload {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  sessionId?: string;
}

export interface AppNotificationActivation {
  sessionId?: string;
}

export type AppNotificationShowFailureReason =
  | "invalid-payload"
  | "not-supported"
  | "not-windows"
  | "unauthorized"
  | "show-failed"
  | "show-timeout";

export type AppNotificationShowResult =
  | { shown: true }
  | { shown: false; reason: AppNotificationShowFailureReason };

export type AppNotificationDismissResult =
  | { ok: true }
  | { ok: false; error: string };

export interface AppNotificationBridge {
  show: (payload: AppNotificationPayload) => Promise<AppNotificationShowResult>;
  dismiss: (id: string) => Promise<AppNotificationDismissResult>;
  dismissSession: (
    sessionId: string,
    kinds?: readonly AppNotificationKind[],
  ) => Promise<AppNotificationDismissResult>;
  onActivated: (
    callback: (activation: AppNotificationActivation) => void,
  ) => () => void;
}
