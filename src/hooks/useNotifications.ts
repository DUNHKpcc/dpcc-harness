import { useEffect, useEffectEvent, useRef } from "react";
import type { ChatSession, PermissionRequest, NotificationSettings, NotificationTrigger, SessionInfo } from "@/types";
import type {
  AppNotificationKind,
  AppNotificationPayload,
} from "@shared/types/notifications";
import {
  advanceSessionCompletionTracker,
  classifyPermissionNotification,
  consumeSuppressedSessionCompletion,
  createAppNotificationId,
  getPermissionNotificationKind,
  getVisibleNotificationSessionIds,
  showNativeNotificationWithFallback,
  type PermissionNotificationEventType,
  shouldNotifyPermissionRequest,
} from "@/lib/notification-utils";
import { getSessionNotificationActor } from "@/lib/session-notifications";
import {
  advanceSplitPaneNotificationTracking,
  subscribeSplitPaneNotifications,
  type SplitPaneNotificationTrackingState,
} from "@/lib/split-pane-notifications";
import { isWindows } from "@/lib/utils";
import i18n from "@/i18n";

// ── Defaults (used when AppSettings hasn't loaded yet) ──

const FALLBACK: NotificationSettings = {
  exitPlanMode: { osNotification: "unfocused", sound: "always" },
  permissions: { osNotification: "unfocused", sound: "unfocused" },
  askUserQuestion: { osNotification: "unfocused", sound: "always" },
  sessionComplete: { osNotification: "unfocused", sound: "always" },
};

// ── Lazy-created and cached Audio element ──

let cachedAudio: HTMLAudioElement | null = null;

function getNotificationSoundUrl(): string {
  return new URL("./sounds/notification.wav", window.location.href).toString();
}

function getAudio(): HTMLAudioElement {
  if (!cachedAudio) {
    cachedAudio = new Audio(getNotificationSoundUrl());
    cachedAudio.volume = 0.6;
  }
  return cachedAudio;
}

// ── Helpers ──

/** Check if a trigger condition is met given current window focus state. */
function shouldFire(trigger: NotificationTrigger): boolean {
  if (trigger === "never") return false;
  if (trigger === "always") return true;
  // "unfocused" — fire whenever the renderer window itself is not focused.
  return !document.hasFocus();
}

function showWebNotification(
  payload: AppNotificationPayload,
  onClick?: () => void,
): void {
  const notification = new Notification(payload.title, {
    body: payload.body,
    silent: true,
  });
  notification.onclick = () => {
    window.focus();
    onClick?.();
    notification.close();
  };
}

/** Fire OS notification + sound based on event settings. */
function fireNotification(
  eventSettings: { osNotification: NotificationTrigger; sound: NotificationTrigger },
  payload: AppNotificationPayload,
  onClick?: () => void,
): void {
  if (shouldFire(eventSettings.osNotification)) {
    if (isWindows) {
      void showNativeNotificationWithFallback(
        () => window.claude.notifications.show(payload),
        () => showWebNotification(payload, onClick),
      );
    } else {
      showWebNotification(payload, onClick);
    }
  }

  if (shouldFire(eventSettings.sound)) {
    const audio = getAudio();
    audio.currentTime = 0; // reset in case a previous play is still going
    audio.play().catch(() => {
      // Autoplay may be blocked in some edge cases — ignore silently
    });
  }
}

/** Human-readable notification content for each event type. */
function getNotificationContent(
  eventType: PermissionNotificationEventType,
  request: PermissionRequest,
  actor: string,
): { title: string; body: string } {
  switch (eventType) {
    case "exitPlanMode":
      return {
        title: i18n.t("notifications.readyTitle"),
        body: i18n.t("notifications.readyBody", { actor }),
      };
    case "askUserQuestion":
      return {
        title: i18n.t("notifications.questionTitle", { actor }),
        body: i18n.t("notifications.questionFallback", { actor }),
      };
    case "permissions":
      return {
        title: i18n.t("notifications.permissionTitle"),
        body: i18n.t("notifications.permissionBody", {
          tool: request.toolName,
        }),
      };
  }
}

let notificationSequence = 0;

function nextNotificationEventId(prefix: string): string {
  notificationSequence += 1;
  return `${prefix}-${Date.now()}-${notificationSequence}`;
}

function createPayload(
  kind: AppNotificationKind,
  sessionId: string | null,
  eventId: string,
  title: string,
  body: string,
): AppNotificationPayload {
  return {
    id: createAppNotificationId(kind, sessionId, eventId),
    kind,
    title,
    body,
    ...(sessionId ? { sessionId } : {}),
  };
}

// ── Hook ──

interface UseNotificationsOptions {
  pendingPermission: PermissionRequest | null;
  notificationSettings: NotificationSettings | null;
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  sessionInfo: SessionInfo | null;
  /** Whether the agent is currently processing (used to detect session completion) */
  isProcessing: boolean;
  visibleSessionIds?: readonly string[];
  onOpenSession?: (sessionId: string) => void;
}

interface BackgroundSessionCompleteDetail {
  sessionId: string;
  sessionTitle: string;
  actor: string;
}

interface BackgroundPermissionDetail {
  sessionId: string;
  sessionTitle: string;
  actor: string;
  permission: PermissionRequest;
}

interface BackgroundPermissionClearedDetail {
  sessionId: string;
}

export function useNotifications({
  pendingPermission,
  notificationSettings,
  activeSessionId,
  activeSession,
  sessionInfo,
  isProcessing,
  visibleSessionIds = [],
  onOpenSession,
}: UseNotificationsOptions): void {
  const settings = notificationSettings ?? FALLBACK;
  const activeActor = getSessionNotificationActor(activeSession, sessionInfo);
  const openSession = useEffectEvent((sessionId: string) => {
    onOpenSession?.(sessionId);
  });

  useEffect(() => {
    return window.claude.notifications.onActivated(({ sessionId }) => {
      if (sessionId) openSession(sessionId);
    });
  }, [openSession]);

  useEffect(() => {
    if (!isWindows) return;
    const dismissVisibleSessionNotifications = () => {
      if (document.hasFocus()) {
        for (const sessionId of getVisibleNotificationSessionIds(
          activeSessionId,
          visibleSessionIds,
        )) {
          void window.claude.notifications.dismissSession(sessionId);
        }
      }
    };

    dismissVisibleSessionNotifications();
    window.addEventListener("focus", dismissVisibleSessionNotifications);
    return () => {
      window.removeEventListener("focus", dismissVisibleSessionNotifications);
    };
  }, [activeSessionId, visibleSessionIds]);

  // ── Permission-based notifications ──

  // Track every request we've already surfaced so foreground/background
  // re-presentation of the same open permission doesn't replay the sound.
  const seenPermissionKeys = useRef(new Set<string>());
  const permissionNotifications = useRef(new Map<
    string,
    { requestId: string; notificationId: string }
  >());

  const dismissPermissionNotification = useEffectEvent((
    sessionId: string,
    expectedRequestId?: string,
  ) => {
    const active = permissionNotifications.current.get(sessionId);
    if (!active || (expectedRequestId && active.requestId !== expectedRequestId)) return;
    permissionNotifications.current.delete(sessionId);
    if (isWindows) {
      void window.claude.notifications.dismiss(active.notificationId);
    }
  });

  const presentPermissionNotification = useEffectEvent((
    sessionId: string,
    permission: PermissionRequest,
    actor: string,
  ) => {
    const previous = permissionNotifications.current.get(sessionId);
    if (previous && previous.requestId !== permission.requestId) {
      dismissPermissionNotification(sessionId, previous.requestId);
    }
    if (!shouldNotifyPermissionRequest(seenPermissionKeys.current, {
      sessionId,
      requestId: permission.requestId,
    })) {
      return;
    }

    const eventType = classifyPermissionNotification(permission.toolName);
    const { title, body } = getNotificationContent(eventType, permission, actor);
    const kind = getPermissionNotificationKind(eventType);
    const payload = createPayload(
      kind,
      sessionId,
      permission.requestId,
      title,
      body,
    );
    permissionNotifications.current.set(sessionId, {
      requestId: permission.requestId,
      notificationId: payload.id,
    });
    fireNotification(
      settings[eventType],
      payload,
      () => openSession(sessionId),
    );
  });

  useEffect(() => {
    if (!activeSessionId) return;
    if (!pendingPermission) {
      dismissPermissionNotification(activeSessionId);
      return;
    }
    presentPermissionNotification(activeSessionId, pendingPermission, activeActor);
  }, [
    activeActor,
    activeSessionId,
    dismissPermissionNotification,
    pendingPermission,
    presentPermissionNotification,
  ]);

  // ── Session completion notification ──

  const presentCompletionNotification = useEffectEvent((
    sessionId: string,
    actor: string,
    eventId: string,
  ) => {
    if (consumeSuppressedSessionCompletion(sessionId)) return;
    fireNotification(
      settings.sessionComplete,
      createPayload(
        "task-complete",
        sessionId,
        eventId,
        i18n.t("notifications.taskCompleteTitle"),
        i18n.t("notifications.taskCompleteBody", { actor }),
      ),
      () => openSession(sessionId),
    );
  });

  // Track the active session alongside processing so chat switches do not look
  // like a completed turn for the newly selected session.
  const prevSessionState = useRef({ sessionId: activeSessionId, isProcessing });

  useEffect(() => {
    const current = { sessionId: activeSessionId, isProcessing };
    const { completed, tracked } = advanceSessionCompletionTracker(
      prevSessionState.current,
      current,
    );
    prevSessionState.current = tracked;

    if (completed && current.sessionId) {
      presentCompletionNotification(
        current.sessionId,
        activeActor,
        nextNotificationEventId("completed"),
      );
    }
  }, [
    activeActor,
    activeSessionId,
    isProcessing,
    presentCompletionNotification,
  ]);

  // ── Background session notifications ──
  useEffect(() => {
    const onBackgroundComplete = (evt: Event) => {
      const detail = (evt as CustomEvent<BackgroundSessionCompleteDetail>).detail;
      if (!detail) return;
      presentCompletionNotification(
        detail.sessionId,
        detail.actor,
        nextNotificationEventId("background-completed"),
      );
    };

    const onBackgroundPermission = (evt: Event) => {
      const detail = (evt as CustomEvent<BackgroundPermissionDetail>).detail;
      if (!detail?.permission) return;
      presentPermissionNotification(detail.sessionId, detail.permission, detail.actor);
    };

    const onBackgroundPermissionCleared = (evt: Event) => {
      const detail = (evt as CustomEvent<BackgroundPermissionClearedDetail>).detail;
      if (!detail?.sessionId) return;
      dismissPermissionNotification(detail.sessionId);
      if (isWindows) {
        void window.claude.notifications.dismissSession(
          detail.sessionId,
          ["approval", "information"],
        );
      }
    };

    window.addEventListener("pcc-agent:background-session-complete", onBackgroundComplete as EventListener);
    window.addEventListener("pcc-agent:background-permission-request", onBackgroundPermission as EventListener);
    window.addEventListener("pcc-agent:background-permission-cleared", onBackgroundPermissionCleared as EventListener);
    return () => {
      window.removeEventListener("pcc-agent:background-session-complete", onBackgroundComplete as EventListener);
      window.removeEventListener("pcc-agent:background-permission-request", onBackgroundPermission as EventListener);
      window.removeEventListener("pcc-agent:background-permission-cleared", onBackgroundPermissionCleared as EventListener);
    };
  }, [
    dismissPermissionNotification,
    presentCompletionNotification,
    presentPermissionNotification,
  ]);

  // ── Visible secondary split-pane notifications ──
  const splitTracking = useRef(new Map<string, SplitPaneNotificationTrackingState>());
  useEffect(() => subscribeSplitPaneNotifications((event) => {
    if (event.type === "remove") {
      splitTracking.current.delete(event.sessionId);
      return;
    }

    const { snapshot } = event;
    const transition = advanceSplitPaneNotificationTracking(
      splitTracking.current.get(snapshot.sessionId),
      snapshot,
    );
    splitTracking.current.set(snapshot.sessionId, transition.tracked);

    if (transition.clearedPermissionRequestId) {
      dismissPermissionNotification(
        snapshot.sessionId,
        transition.clearedPermissionRequestId,
      );
    }
    if (transition.permissionRequested && snapshot.pendingPermission) {
      presentPermissionNotification(
        snapshot.sessionId,
        snapshot.pendingPermission,
        snapshot.actor,
      );
    }
    if (transition.completed) {
      presentCompletionNotification(
        snapshot.sessionId,
        snapshot.actor,
        snapshot.completionEventId,
      );
    }
  }), [
    dismissPermissionNotification,
    presentCompletionNotification,
    presentPermissionNotification,
  ]);
}
