import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockEventMap {
  [event: string]: Array<(...args: unknown[]) => void>;
}

interface SafeSendCall {
  channel: string;
  payload?: unknown;
}

interface TestWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MainState {
  requestSingleInstanceLockReturn: boolean;
  appWhenReady: Promise<void>;
  appQuitCalls: number;
  appEventHandlers: MockEventMap;
  ipcMainEventHandlers: MockEventMap;
  browserWindows: FakeBrowserWindow[];
  menuTemplates: unknown[];
  tray: FakeTray | null;
  safeSendCalls: SafeSendCall[];
  sessionsForTray: unknown[];
  activateNotification?: (sessionId?: string) => void;
  notificationsListened: boolean;
  appSettings: {
    macBackgroundEffect: string;
    windowBounds: TestWindowBounds | null;
    windowMaximized: boolean;
  };
  settingsPatches: Array<Record<string, unknown>>;
  screenWorkArea: TestWindowBounds;
  browserWindowOptions: Array<Record<string, unknown>>;
}

const state = vi.hoisted<MainState>(() => ({
  requestSingleInstanceLockReturn: true,
  appWhenReady: Promise.resolve(),
  appQuitCalls: 0,
  appEventHandlers: {},
  ipcMainEventHandlers: {},
  browserWindows: [],
  menuTemplates: [],
  tray: null,
  safeSendCalls: [],
  sessionsForTray: [],
  notificationsListened: false,
  appSettings: {
    macBackgroundEffect: "liquid-glass",
    windowBounds: null,
    windowMaximized: false,
  },
  settingsPatches: [],
  screenWorkArea: { x: 0, y: 0, width: 2560, height: 1440 },
  browserWindowOptions: [],
}));

function resetState(): void {
  state.requestSingleInstanceLockReturn = true;
  state.appWhenReady = Promise.resolve();
  state.appQuitCalls = 0;
  state.appEventHandlers = {};
  state.ipcMainEventHandlers = {};
  state.browserWindows = [];
  state.menuTemplates = [];
  state.tray = null;
  state.safeSendCalls = [];
  state.sessionsForTray = [];
  state.activateNotification = undefined;
  state.notificationsListened = false;
  state.appSettings = {
    macBackgroundEffect: "liquid-glass",
    windowBounds: null,
    windowMaximized: false,
  };
  state.settingsPatches = [];
  state.screenWorkArea = { x: 0, y: 0, width: 2560, height: 1440 };
  state.browserWindowOptions = [];
}

declare global {
  var __PCC_DIAGNOSTIC_BUILD__: boolean;
}

class FakeWebContents {
  private loading = false;
  private onEvents: MockEventMap = {};
  private onceEvents: MockEventMap = {};
  private listeners: { [event: string]: Array<(...args: unknown[]) => void> } = {};
  id = 123;
  private url = "";

  constructor(private readonly window: FakeBrowserWindow) {}

  isDestroyed(): boolean {
    return this.window.isDestroyed();
  }

  isLoadingMainFrame(): boolean {
    return this.loading;
  }

  setLoading(value: boolean): void {
    this.loading = value;
  }

  setWindowOpenHandler() {
    // no-op in tests
  }

  on(event: string, cb: (...args: unknown[]) => void): this {
    this.listeners[event] = this.listeners[event] ?? [];
    this.listeners[event].push(cb);
    return this;
  }

  once(event: string, cb: (...args: unknown[]) => void): this {
    this.onceEvents[event] = this.onceEvents[event] ?? [];
    this.onceEvents[event].push(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners[event] ?? []) {
      cb(...args);
    }
    const once = this.onceEvents[event];
    if (once) {
      for (const cb of once) {
        cb(...args);
      }
      delete this.onceEvents[event];
    }
  }

  getURL(): string {
    return this.url;
  }

  setURL(url: string): void {
    this.url = url;
  }

  loadURL(url: string): void {
    this.url = url;
  }

  loadFile(url: string): void {
    this.url = url;
  }
}

class FakeBrowserWindow {
  public webContents: FakeWebContents;
  private destroyed = false;
  private minimized = false;
  private visible = false;
  private focused = false;
  private maximized = false;
  private normalBounds: TestWindowBounds;
  private eventMap: MockEventMap = {};

  public showCalls = 0;
  public hideCalls = 0;
  public restoreCalls = 0;
  public focusCalls = 0;
  public maximizeCalls = 0;

  constructor(options: Record<string, unknown> = {}) {
    this.webContents = new FakeWebContents(this);
    state.browserWindowOptions.push(options);
    this.normalBounds = {
      x: typeof options.x === "number" ? options.x : 100,
      y: typeof options.y === "number" ? options.y : 100,
      width: typeof options.width === "number" ? options.width : 1200,
      height: typeof options.height === "number" ? options.height : 800,
    };
    state.browserWindows.push(this);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  on(event: string, cb: (...args: unknown[]) => void): this {
    this.eventMap[event] = this.eventMap[event] ?? [];
    this.eventMap[event].push(cb);
    return this;
  }

  once(event: string, cb: (...args: unknown[]) => void): this {
    this.eventMap[event] = this.eventMap[event] ?? [];
    this.eventMap[event].push(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.eventMap[event] ?? []) {
      cb(...args);
    }
  }

  show(): void {
    this.visible = true;
    this.showCalls += 1;
  }

  loadURL(): void {}

  loadFile(): void {}

  hide(): void {
    this.visible = false;
    this.hideCalls += 1;
  }

  restore(): void {
    this.minimized = false;
    this.visible = true;
    this.restoreCalls += 1;
  }

  focus(): void {
    this.focused = true;
    this.focusCalls += 1;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getNormalBounds(): TestWindowBounds {
    return { ...this.normalBounds };
  }

  setNormalBounds(bounds: TestWindowBounds): void {
    this.normalBounds = { ...bounds };
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  maximize(): void {
    this.maximized = true;
    this.maximizeCalls += 1;
  }

  setPosition() {}
  close() {}
  setVibrancy() {}
  setBackgroundColor() {}
  setTitleBarOverlay() {}
  setMinimumSize() {}
  getMinimumSize(): [number, number] {
    return [300, 300];
  }

  getSize(): [number, number] {
    return [1000, 800];
  }

  setSize(width: number, height: number): void {
    this.webContents.emit("resize", width, height);
  }
}

class FakeTray {
  public doubleClickHandlers = 0;
  public rightClickHandlers = 0;
  private events: MockEventMap = {};

  constructor() {
    state.tray = this;
  }

  setToolTip(): void {}

  on(event: string, cb: (...args: unknown[]) => void): this {
    this.events[event] = this.events[event] ?? [];
    this.events[event].push(cb);
    if (event === "double-click") this.doubleClickHandlers += 1;
    if (event === "right-click") this.rightClickHandlers += 1;
    return this;
  }

  popUpContextMenu(menu: { template?: unknown }): void {
    state.menuTemplates.push(menu);
  }

  destroy() {}

  isDestroyed() {
    return false;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.events[event] ?? []) {
      cb(...args);
    }
  }
}

vi.mock("electron", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("electron");
  const commandLine = { appendSwitch: vi.fn() };
  const appEventMap: MockEventMap = {};
  const electronMock = {
    app: {
      requestSingleInstanceLock: vi.fn(() => state.requestSingleInstanceLockReturn),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        appEventMap[event] = appEventMap[event] ?? [];
        appEventMap[event].push(handler);
        state.appEventHandlers[event] = appEventMap[event];
      }),
      off: vi.fn(),
      once: vi.fn(),
      commandLine,
      whenReady: vi.fn(() => state.appWhenReady),
      isPackaged: false,
      getPreferredSystemLanguages: vi.fn(() => ["en-US"]),
      getSystemLocale: vi.fn(() => "en-US"),
      getLocale: vi.fn(() => "en-US"),
      quit: vi.fn(() => {
        state.appQuitCalls += 1;
      }),
      relaunch: vi.fn(),
      isReady: vi.fn(() => true),
      exit: vi.fn(),
      setAsDefaultProtocolClient: vi.fn(),
      getPath: vi.fn(),
    },
    BrowserWindow: class extends FakeBrowserWindow {
      constructor(options?: Record<string, unknown>) {
        super(options);
      }
    },
    clipboard: { writeText: vi.fn() },
    globalShortcut: {
      register: vi.fn(() => true),
      unregisterAll: vi.fn(),
    },
    Menu: {
      setApplicationMenu: vi.fn(),
      buildFromTemplate: vi.fn((template: unknown[]) => {
        state.menuTemplates.push(template);
        return { template } as { template: unknown[] };
      }),
      sendActionToFirstResponder: vi.fn(),
    },
    nativeImage: {
      createEmpty: vi.fn(() => ({}) as unknown),
    },
    nativeTheme: {
      shouldUseDarkColors: false,
    },
    screen: {
      getDisplayMatching: vi.fn(() => ({ workArea: state.screenWorkArea })),
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
      },
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        state.ipcMainEventHandlers[event] = state.ipcMainEventHandlers[event] ?? [];
        state.ipcMainEventHandlers[event].push(handler);
      }),
      removeListener: vi.fn(),
    },
    systemPreferences: {
      getMediaAccessStatus: vi.fn(),
      askForMediaAccess: vi.fn(),
    },
    Tray: class extends FakeTray {
      constructor() {
        super();
      }
    },
    webContents: {
      fromId: vi.fn(),
    },
  };
  return {
    __esModule: true,
    ...actual,
    ...electronMock,
    default: electronMock,
  };
});

vi.mock("./lib/logger", () => ({
  log: vi.fn(),
  closeLogStream: vi.fn(),
}));

vi.mock("./lib/error-utils", () => ({
  reportError: vi.fn(() => "ERR"),
}));

vi.mock("./lib/migration", () => ({
  migrateFromOpenAcpUi: vi.fn(),
}));

vi.mock("./lib/glass", () => ({
  glassEnabled: false,
  applyGlass: vi.fn(),
  setGlassTint: vi.fn(() => -1),
}));

vi.mock("./lib/app-settings", () => ({
  getAppSettings: vi.fn(() => state.appSettings),
  setAppSettings: vi.fn((patch: Record<string, unknown>) => {
    state.settingsPatches.push(patch);
    if ("windowBounds" in patch) {
      state.appSettings.windowBounds = patch.windowBounds as TestWindowBounds | null;
    }
    if ("windowMaximized" in patch) {
      state.appSettings.windowMaximized = patch.windowMaximized === true;
    }
    return state.appSettings;
  }),
}));

vi.mock("./lib/updater", () => ({
  initAutoUpdater: vi.fn(),
  getIsInstallingUpdate: vi.fn(() => false),
}));

vi.mock("./lib/prerelease-check", () => ({
  initPreReleaseCheck: vi.fn(),
}));

vi.mock("./lib/claude-codex-bridge-controller", () => ({
  createClaudeCodexBridgeController: vi.fn(() => ({
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
  })),
  setClaudeCodexBridgeController: vi.fn(),
}));

vi.mock("./lib/safe-send", () => ({
  safeSend: vi.fn((_getter: unknown, channel: string, payload?: unknown) => {
    state.safeSendCalls.push({ channel, payload });
  }),
}));

vi.mock("./lib/process-tree", () => ({
  killProcessTree: vi.fn(),
}));

vi.mock("./lib/open-external", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("../../src/lib/layout/constants", () => ({
  getBootstrapMinWindowWidth: vi.fn(() => 960),
}));

vi.mock("./lib/devtools-policy", () => ({
  canOpenAppDevTools: vi.fn(() => false),
  shouldDisableApplicationMenu: vi.fn(() => false),
  shouldEnableRemoteDevTools: vi.fn(() => false),
  shouldEnableRendererDevTools: vi.fn(() => false),
  shouldRegisterDevToolsShortcuts: vi.fn(() => false),
}));

vi.mock("./lib/package-smoke-check", () => ({
  isPackageSmokeCheckRequested: vi.fn(() => false),
  runPackageSmokeCheck: vi.fn(),
}));

vi.mock("electron-context-menu", () => ({
  default: vi.fn(),
}));

vi.mock("./ipc/spaces", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/projects", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/sessions", () => ({
  listRecentSessions: vi.fn(async () => state.sessionsForTray),
  register: vi.fn(),
}));

vi.mock("./ipc/folders", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/cc-import", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/cc-config", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/files", () => ({
  register: vi.fn(),
  readMultiple: vi.fn(),
}));

vi.mock("./ipc/claude-sessions", () => ({
  register: vi.fn(),
  stopAll: vi.fn(),
}));

vi.mock("./ipc/title-gen", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/terminal", () => ({
  register: vi.fn(),
  terminals: new Map(),
}));

vi.mock("./ipc/git", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/agent-registry", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/acp-sessions", () => ({
  register: vi.fn(),
  stopAll: vi.fn(),
}));

vi.mock("./ipc/codex-sessions", () => ({
  register: vi.fn(),
  stopAll: vi.fn(),
}));

vi.mock("./ipc/mcp", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/settings", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/account", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/account-auth", () => ({
  register: vi.fn(),
  initialize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("./ipc/jira", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/wechat", () => ({
  register: vi.fn(),
  autoStart: vi.fn(),
  stopBridge: vi.fn(),
}));

vi.mock("./ipc/notifications", () => ({
  register: vi.fn((_getMainWindow: unknown, onActivate: (sessionId?: string) => void) => {
    state.notificationsListened = true;
    state.activateNotification = onActivate;
  }),
  dispose: vi.fn(),
}));

async function loadMainModule(options: {
  requestSingleInstanceLockReturn?: boolean;
  sessionsForTray?: unknown[];
  windowBounds?: TestWindowBounds | null;
  windowMaximized?: boolean;
  screenWorkArea?: TestWindowBounds;
} = {}): Promise<void> {
  globalThis.__PCC_DIAGNOSTIC_BUILD__ = false;
  resetState();
  state.requestSingleInstanceLockReturn = options.requestSingleInstanceLockReturn ?? true;
  state.sessionsForTray = options.sessionsForTray ?? [];
  state.appSettings.windowBounds = options.windowBounds ?? null;
  state.appSettings.windowMaximized = options.windowMaximized ?? false;
  state.screenWorkArea = options.screenWorkArea ?? state.screenWorkArea;
  vi.clearAllMocks();
  vi.resetModules();
  Object.defineProperty(process, "platform", { value: "win32" });
  Object.defineProperty(process, "resourcesPath", { value: "/tmp/resources", configurable: true });
  await import("./main");
  await Promise.resolve();
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function markWindowActivationReady(): void {
  const handlers = state.ipcMainEventHandlers["app:window-activation-ready"] ?? [];
  expect(handlers).toHaveLength(1);
  handlers[0]({ sender: { id: 123 } });
}

describe("main lifecycle / tray navigation", () => {
  beforeEach(() => {
    resetState();
  });

  it("restores, shows and focuses existing window when second instance starts", async () => {
    await loadMainModule();
    const window = state.browserWindows[0];
    expect(window).toBeTruthy();

    (window as unknown as { minimized: boolean; visible: boolean }).minimized = true;
    (window as unknown as { minimized: boolean; visible: boolean }).visible = false;

    const handlers = state.appEventHandlers["second-instance"] ?? [];
    expect(handlers).toHaveLength(1);
    handlers[0]({}, ["PccAgent.exe"]);
    await flushImmediate();

    expect(window?.isVisible()).toBe(true);
    expect(window?.isMinimized()).toBe(false);
    expect(window?.restoreCalls).toBeGreaterThanOrEqual(1);
    expect(window?.focusCalls).toBe(1);
  });

  it("does not initialize a window when the single-instance lock is unavailable", async () => {
    await loadMainModule({ requestSingleInstanceLockReturn: false });

    expect(state.appQuitCalls).toBe(1);
    expect(state.browserWindows).toHaveLength(0);
  });

  it("restores the saved window bounds and maximized state", async () => {
    await loadMainModule({
      windowBounds: { x: 180, y: 120, width: 1400, height: 900 },
      windowMaximized: true,
    });

    expect(state.browserWindowOptions[0]).toMatchObject({
      x: 180,
      y: 120,
      width: 1400,
      height: 900,
    });
    expect(state.browserWindows[0]?.maximizeCalls).toBe(1);
  });

  it("clamps restored bounds into the current display work area", async () => {
    await loadMainModule({
      windowBounds: { x: 5000, y: 3000, width: 1800, height: 1000 },
      screenWorkArea: { x: 0, y: 0, width: 1366, height: 768 },
    });

    expect(state.browserWindowOptions[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1366,
      height: 768,
    });
  });

  it("debounces persistence of the latest normal window bounds", async () => {
    vi.useFakeTimers();
    try {
      await loadMainModule();
      const window = state.browserWindows[0];
      window?.setNormalBounds({ x: 240, y: 160, width: 1500, height: 920 });

      window?.emit("move");
      window?.emit("resize");
      expect(state.settingsPatches).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(250);

      expect(state.settingsPatches).toEqual([{
        windowBounds: { x: 240, y: 160, width: 1500, height: 920 },
        windowMaximized: false,
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a minimized Windows window in the native taskbar", async () => {
    await loadMainModule();
    const window = state.browserWindows[0];
    expect(window).toBeTruthy();

    window?.emit("minimize");

    expect(window?.hideCalls).toBe(0);
  });

  it("hides instead of closing on Windows when user closes the window", async () => {
    await loadMainModule();
    const window = state.browserWindows[0];
    expect(window).toBeTruthy();

    const event = { preventDefault: vi.fn() };
    window?.emit("close", event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(window?.hideCalls).toBeGreaterThan(0);
    expect(state.appQuitCalls).toBe(0);
  });

  it("defers tray session navigation until the main frame finishes loading", async () => {
    await loadMainModule({
      sessionsForTray: [
        {
          id: "s1",
          projectId: "p1",
          title: "My session",
          engine: "claude",
          lastMessageAt: 100,
        },
      ],
    });

    const tray = state.tray;
    expect(tray).toBeTruthy();
    tray?.emit("right-click");
    await Promise.resolve();

    const menuTemplate = (state.menuTemplates[state.menuTemplates.length - 1] as {
      template: { label?: string; click?: () => void }[];
    }).template;
    const sessionItem = menuTemplate.find(
      (entry) => typeof entry.label === "string" && entry.label.includes("My session"),
    );
    expect(sessionItem).toBeTruthy();

    state.safeSendCalls = [];
    sessionItem?.click?.();
    await flushImmediate();
    expect(state.safeSendCalls).toHaveLength(0);

    markWindowActivationReady();
    await Promise.resolve();
    expect(state.safeSendCalls).toHaveLength(1);
    expect(state.safeSendCalls[0].channel).toBe("tray:open-session");
    expect(state.safeSendCalls[0].payload).toEqual({
      projectId: "p1",
      sessionId: "s1",
    });
  });

  it("defers notification activation until renderer listeners are ready", async () => {
    await loadMainModule();
    expect(state.notificationsListened).toBe(true);
    expect(state.activateNotification).toBeTypeOf("function");

    state.activateNotification?.("session-1");

    expect(state.safeSendCalls).toHaveLength(0);
    markWindowActivationReady();
    await Promise.resolve();

    expect(state.safeSendCalls).toHaveLength(1);
    expect(state.safeSendCalls[0].channel).toBe("notifications:activated");
    expect(state.safeSendCalls[0].payload).toEqual({
      sessionId: "session-1",
    });
  });
});
