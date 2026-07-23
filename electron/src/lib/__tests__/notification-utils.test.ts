import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceSessionCompletionTracker,
  classifyPermissionNotification,
  consumeSuppressedSessionCompletion,
  createAppNotificationId,
  getPermissionNotificationKind,
  getVisibleNotificationSessionIds,
  resetNotificationStateForTesting,
  showNativeNotificationWithFallback,
  suppressNextSessionCompletion,
  shouldNotifyPermissionRequest,
} from "../../../../src/lib/notification-utils";
import {
  advanceSplitPaneNotificationTracking,
  publishSplitPaneNotificationSnapshot,
  removeSplitPaneNotificationSnapshot,
  resetSplitPaneNotificationsForTesting,
  subscribeSplitPaneNotifications,
  type SplitPaneNotificationSnapshot,
} from "../../../../src/lib/split-pane-notifications";

const notificationIpcMocks = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;

  class MockNotification {
    static behavior: "show" | "failed" = "show";
    static instances: MockNotification[] = [];
    static isSupported = vi.fn(() => true);

    private readonly listeners = new Map<string, Set<Listener>>();
    close = vi.fn(() => this.emit("close"));

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: Listener): this {
      const wrapped: Listener = (...args) => {
        this.listeners.get(event)?.delete(wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    emit(event: string, ...args: any[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener(...args);
      }
    }

    show(): void {
      queueMicrotask(() => {
        if (MockNotification.behavior === "failed") {
          this.emit("failed", {}, "toast unavailable");
        } else {
          this.emit("show");
        }
      });
    }

    constructor(readonly options: Record<string, unknown>) {
      MockNotification.instances.push(this);
    }
  }

  return {
    handlers: new Map<string, (...args: any[]) => any>(),
    MockNotification,
    reportError: vi.fn(),
  };
});

vi.mock("electron", () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      notificationIpcMocks.handlers.set(channel, handler);
    },
  },
  Notification: notificationIpcMocks.MockNotification,
}));

vi.mock("../error-utils", () => ({
  reportError: notificationIpcMocks.reportError,
}));

beforeEach(() => {
  resetNotificationStateForTesting();
  resetSplitPaneNotificationsForTesting();
});

function splitSnapshot(
  patch: Partial<SplitPaneNotificationSnapshot> = {},
): SplitPaneNotificationSnapshot {
  return {
    sessionId: "session-a",
    actor: "Codex",
    isProcessing: false,
    pendingPermission: null,
    completionEventId: "message-1",
    ...patch,
  };
}

describe("advanceSessionCompletionTracker", () => {
  it("marks a real completion in the same session", () => {
    expect(advanceSessionCompletionTracker(
      { sessionId: "session-a", isProcessing: true },
      { sessionId: "session-a", isProcessing: false },
    )).toEqual({
      completed: true,
      tracked: { sessionId: "session-a", isProcessing: false },
    });
  });

  it("resets tracking when switching from a busy session to a different idle session", () => {
    expect(advanceSessionCompletionTracker(
      { sessionId: "session-a", isProcessing: true },
      { sessionId: "session-b", isProcessing: false },
    )).toEqual({
      completed: false,
      tracked: { sessionId: "session-b", isProcessing: false },
    });
  });

  it("drops carried-over busy state on the first render after switching chats", () => {
    const firstRender = advanceSessionCompletionTracker(
      { sessionId: "session-a", isProcessing: true },
      { sessionId: "session-b", isProcessing: true },
    );

    expect(firstRender).toEqual({
      completed: false,
      tracked: { sessionId: "session-b", isProcessing: false },
    });

    expect(advanceSessionCompletionTracker(
      firstRender.tracked,
      { sessionId: "session-b", isProcessing: false },
    )).toEqual({
      completed: false,
      tracked: { sessionId: "session-b", isProcessing: false },
    });
  });
});

describe("shouldNotifyPermissionRequest", () => {
  it("fires once for a given session/request pair", () => {
    const seen = new Set<string>();

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(false);
  });

  it("suppresses replay when the same open request moves between foreground and background", () => {
    const seen = new Set<string>();

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(false);
  });

  it("allows different sessions or requests to notify independently", () => {
    const seen = new Set<string>();

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-1",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-a",
      requestId: "req-2",
    })).toBe(true);

    expect(shouldNotifyPermissionRequest(seen, {
      sessionId: "session-b",
      requestId: "req-1",
    })).toBe(true);
  });
});

describe("notification presentation", () => {
  it("maps permission tools to the native notification categories", () => {
    expect(classifyPermissionNotification("ExitPlanMode")).toBe("exitPlanMode");
    expect(classifyPermissionNotification("AskUserQuestion")).toBe("askUserQuestion");
    expect(classifyPermissionNotification("Bash")).toBe("permissions");

    expect(getPermissionNotificationKind("exitPlanMode")).toBe("approval");
    expect(getPermissionNotificationKind("askUserQuestion")).toBe("information");
    expect(getPermissionNotificationKind("permissions")).toBe("approval");
  });

  it("builds stable ids scoped to the session and event", () => {
    expect(createAppNotificationId("approval", "session-a", "req-1"))
      .toBe("approval:session-a:req-1");
    expect(createAppNotificationId("task-complete", null, "turn-1"))
      .toBe("task-complete:app:turn-1");
  });

  it("falls back when native delivery fails asynchronously", async () => {
    const fallback = vi.fn();

    await showNativeNotificationWithFallback(
      async () => ({ shown: false, reason: "show-failed" }),
      fallback,
    );

    expect(fallback).toHaveBeenCalledOnce();
  });

  it("falls back when invoking native delivery rejects", async () => {
    const fallback = vi.fn();

    await showNativeNotificationWithFallback(
      async () => {
        throw new Error("IPC unavailable");
      },
      fallback,
    );

    expect(fallback).toHaveBeenCalledOnce();
  });

  it("does not use the fallback after native delivery succeeds", async () => {
    const fallback = vi.fn();

    await showNativeNotificationWithFallback(
      async () => ({ shown: true }),
      fallback,
    );

    expect(fallback).not.toHaveBeenCalled();
  });

  it("deduplicates the active and visible split sessions for cleanup", () => {
    expect(getVisibleNotificationSessionIds(
      "session-a",
      ["session-a", "session-b", "session-b"],
    )).toEqual(["session-a", "session-b"]);
  });
});

describe("session completion suppression", () => {
  it("consumes one suppressed completion per session", () => {
    suppressNextSessionCompletion("session-a");

    expect(consumeSuppressedSessionCompletion("session-a")).toBe(true);
    expect(consumeSuppressedSessionCompletion("session-a")).toBe(false);
  });

  it("tracks repeated suppressions independently", () => {
    suppressNextSessionCompletion("session-a");
    suppressNextSessionCompletion("session-a");

    expect(consumeSuppressedSessionCompletion("session-a")).toBe(true);
    expect(consumeSuppressedSessionCompletion("session-a")).toBe(true);
    expect(consumeSuppressedSessionCompletion("session-a")).toBe(false);
  });
});

describe("split pane notification regression", () => {
  it("notifies only on a busy-to-idle transition", () => {
    const busy = advanceSplitPaneNotificationTracking(
      undefined,
      splitSnapshot({ isProcessing: true }),
    );
    const complete = advanceSplitPaneNotificationTracking(
      busy.tracked,
      splitSnapshot({ isProcessing: false, completionEventId: "message-2" }),
    );
    const stillIdle = advanceSplitPaneNotificationTracking(
      complete.tracked,
      splitSnapshot({ isProcessing: false, completionEventId: "message-2" }),
    );

    expect(busy.completed).toBe(false);
    expect(complete.completed).toBe(true);
    expect(stillIdle.completed).toBe(false);
  });

  it("does not report completion when a busy pane unmounts and remounts idle", () => {
    const listener = vi.fn();
    subscribeSplitPaneNotifications(listener);
    publishSplitPaneNotificationSnapshot(splitSnapshot({ isProcessing: true }));
    removeSplitPaneNotificationSnapshot("session-a");

    const remounted = advanceSplitPaneNotificationTracking(
      undefined,
      splitSnapshot({ isProcessing: false }),
    );

    expect(listener).toHaveBeenLastCalledWith({
      type: "remove",
      sessionId: "session-a",
    });
    expect(remounted.completed).toBe(false);
  });

  it("surfaces a split permission once and records its resolution", () => {
    const permission = {
      requestId: "request-1",
      toolName: "AskUserQuestion",
      toolInput: {},
      toolUseId: "tool-1",
    };
    const initial = advanceSplitPaneNotificationTracking(
      undefined,
      splitSnapshot({ pendingPermission: permission }),
    );
    const unchanged = advanceSplitPaneNotificationTracking(
      initial.tracked,
      splitSnapshot({ pendingPermission: permission }),
    );
    const cleared = advanceSplitPaneNotificationTracking(
      unchanged.tracked,
      splitSnapshot({ pendingPermission: null }),
    );

    expect(initial.permissionRequested).toBe(true);
    expect(unchanged.permissionRequested).toBe(false);
    expect(cleared.clearedPermissionRequestId).toBe("request-1");
  });
});

describe("Windows notification IPC regression", () => {
  const originalPlatform = process.platform;
  const mainWindow = { webContents: { id: 42 } };
  const event = { sender: { id: 42 } };
  const payload = {
    id: "approval:session-a:request-1",
    kind: "approval" as const,
    title: "Approval required",
    body: "Review Bash in PccAgent.",
    sessionId: "session-a",
  };

  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    notificationIpcMocks.handlers.clear();
    notificationIpcMocks.MockNotification.instances.length = 0;
    notificationIpcMocks.MockNotification.behavior = "show";
    notificationIpcMocks.reportError.mockReset();
  });

  afterEach(async () => {
    const { dispose } = await import("../../ipc/notifications");
    dispose();
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("reports asynchronous native delivery failure so the renderer can fall back", async () => {
    const { register } = await import("../../ipc/notifications");
    notificationIpcMocks.MockNotification.behavior = "failed";
    register(
      () => mainWindow as unknown as import("electron").BrowserWindow,
      vi.fn(),
    );

    const show = notificationIpcMocks.handlers.get("notifications:show");
    await expect(show?.(event, payload)).resolves.toEqual({
      shown: false,
      reason: "show-failed",
    });
    expect(notificationIpcMocks.reportError).toHaveBeenCalledOnce();
  });

  it("activates the associated session after confirmed native delivery", async () => {
    const { register } = await import("../../ipc/notifications");
    const activate = vi.fn();
    register(
      () => mainWindow as unknown as import("electron").BrowserWindow,
      activate,
    );

    const show = notificationIpcMocks.handlers.get("notifications:show");
    await expect(show?.(event, payload)).resolves.toEqual({ shown: true });
    notificationIpcMocks.MockNotification.instances[0]?.emit("click");

    expect(activate).toHaveBeenCalledWith("session-a");
  });

  it("rejects notification requests from another renderer", async () => {
    const { register } = await import("../../ipc/notifications");
    register(
      () => mainWindow as unknown as import("electron").BrowserWindow,
      vi.fn(),
    );

    const show = notificationIpcMocks.handlers.get("notifications:show");
    await expect(show?.({ sender: { id: 7 } }, payload)).resolves.toEqual({
      shown: false,
      reason: "unauthorized",
    });
  });
});
