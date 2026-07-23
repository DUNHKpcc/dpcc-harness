import { BrowserWindow, ipcMain, Notification } from "electron";
import {
  isAppNotificationKind,
  type AppNotificationDismissResult,
  type AppNotificationKind,
  type AppNotificationPayload,
  type AppNotificationShowResult,
} from "@shared/types/notifications";
import { reportError } from "../lib/error-utils";

const MAX_ACTIVE_NOTIFICATIONS = 64;
const SHOW_RESULT_TIMEOUT_MS = 5_000;

interface ActiveNotification {
  notification: Notification;
  sessionId?: string;
  kind: AppNotificationKind;
}

const activeNotifications = new Map<string, ActiveNotification>();

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

export function normalizeNotificationPayload(
  value: unknown,
): AppNotificationPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AppNotificationPayload>;
  const id = normalizeText(candidate.id, 200);
  const title = normalizeText(candidate.title, 120);
  const body = normalizeText(candidate.body, 500);
  const sessionId = candidate.sessionId === undefined
    ? undefined
    : normalizeText(candidate.sessionId, 200);

  if (
    !id
    || !title
    || !body
    || !isAppNotificationKind(candidate.kind)
    || (candidate.sessionId !== undefined && !sessionId)
  ) {
    return null;
  }

  return {
    id,
    kind: candidate.kind,
    title,
    body,
    ...(sessionId ? { sessionId } : {}),
  };
}

function closeNotification(id: string): void {
  const active = activeNotifications.get(id);
  if (!active) return;
  activeNotifications.delete(id);
  active.notification.close();
}

function retainNotification(id: string, active: ActiveNotification): void {
  closeNotification(id);
  activeNotifications.set(id, active);

  while (activeNotifications.size > MAX_ACTIVE_NOTIFICATIONS) {
    const oldestId = activeNotifications.keys().next().value as string | undefined;
    if (!oldestId) break;
    closeNotification(oldestId);
  }
}

export function register(
  getMainWindow: () => BrowserWindow | null,
  activateNotification: (sessionId?: string) => void,
): void {
  ipcMain.handle(
    "notifications:show",
    async (event, value: unknown): Promise<AppNotificationShowResult> => {
      if (event.sender.id !== getMainWindow()?.webContents.id) {
        return { shown: false, reason: "unauthorized" };
      }
      if (process.platform !== "win32") {
        return { shown: false, reason: "not-windows" };
      }
      if (!Notification.isSupported()) {
        return { shown: false, reason: "not-supported" };
      }

      const payload = normalizeNotificationPayload(value);
      if (!payload) {
        return { shown: false, reason: "invalid-payload" };
      }

      const notification = new Notification({
        title: payload.title,
        body: payload.body,
        silent: true,
        timeoutType: "default",
      });

      notification.on("click", () => {
        activeNotifications.delete(payload.id);
        notification.close();
        activateNotification(payload.sessionId);
      });
      notification.on("close", () => {
        activeNotifications.delete(payload.id);
      });

      retainNotification(payload.id, {
        notification,
        sessionId: payload.sessionId,
        kind: payload.kind,
      });

      return await new Promise<AppNotificationShowResult>((resolve) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const finish = (result: AppNotificationShowResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };
        timeout = setTimeout(() => {
          closeNotification(payload.id);
          finish({ shown: false, reason: "show-timeout" });
        }, SHOW_RESULT_TIMEOUT_MS);

        notification.once("show", () => {
          finish({ shown: true });
        });
        notification.once("failed", (_event, error) => {
          activeNotifications.delete(payload.id);
          reportError("WINDOWS_NOTIFICATION", new Error(error), {
            notificationId: payload.id,
            kind: payload.kind,
          });
          finish({ shown: false, reason: "show-failed" });
        });

        try {
          notification.show();
        } catch (error) {
          activeNotifications.delete(payload.id);
          reportError("WINDOWS_NOTIFICATION", error, {
            notificationId: payload.id,
            kind: payload.kind,
          });
          finish({ shown: false, reason: "show-failed" });
        }
      });
    },
  );

  ipcMain.handle(
    "notifications:dismiss",
    (event, id: unknown): AppNotificationDismissResult => {
      if (event.sender.id !== getMainWindow()?.webContents.id) {
        return { ok: false, error: "Unauthorized notification request" };
      }
      const normalizedId = normalizeText(id, 200);
      if (normalizedId) closeNotification(normalizedId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "notifications:dismiss-session",
    (event, value: unknown): AppNotificationDismissResult => {
      if (event.sender.id !== getMainWindow()?.webContents.id) {
        return { ok: false, error: "Unauthorized notification request" };
      }
      if (!value || typeof value !== "object") return { ok: true };
      const candidate = value as { sessionId?: unknown; kinds?: unknown };
      const normalizedSessionId = normalizeText(candidate.sessionId, 200);
      const kinds = Array.isArray(candidate.kinds)
        ? new Set(candidate.kinds.filter(isAppNotificationKind))
        : null;
      if (!normalizedSessionId) return { ok: true };

      for (const [id, active] of activeNotifications) {
        if (
          active.sessionId === normalizedSessionId
          && (!kinds || kinds.has(active.kind))
        ) {
          closeNotification(id);
        }
      }
      return { ok: true };
    },
  );
}

export function dispose(): void {
  for (const id of [...activeNotifications.keys()]) {
    closeNotification(id);
  }
}
