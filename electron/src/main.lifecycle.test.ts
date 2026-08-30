import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountOverview } from "@shared/types/account";
import type { AccountAuthSnapshot } from "@shared/types/account-auth";

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

const baselineSignalListeners = new Map<NodeJS.Signals, Set<NodeJS.SignalsListener>>([
  ["SIGINT", new Set(process.listeners("SIGINT"))],
  ["SIGTERM", new Set(process.listeners("SIGTERM"))],
]);

function removeMainModuleSignalListeners(): void {
  for (const [signal, baseline] of baselineSignalListeners) {
    for (const listener of process.listeners(signal)) {
      if (!baseline.has(listener)) process.removeListener(signal, listener);
    }
  }
}

interface MainState {
  requestSingleInstanceLockReturn: boolean;
  appWhenReady: Promise<void>;
  appQuitCalls: number;
  dialogCalls: number;
  dialogResponses: number[];
  acpActiveTurnCount: number;
  appEventHandlers: MockEventMap;
  ipcMainEventHandlers: MockEventMap;
  browserWindows: FakeBrowserWindow[];
  menuTemplates: unknown[];
  tray: FakeTray | null;
  safeSendCalls: SafeSendCall[];
  sessionsForTray: unknown[];
  activateNotification?: (sessionId?: string) => void;
  activateAccountWindow?: () => void;
  prepareForUpdateInstall?: () => Promise<boolean>;
  notificationsListened: boolean;
  appSettings: {
    macBackgroundEffect: string;
    windowBounds: TestWindowBounds | null;
    windowMaximized: boolean;
  };
  settingsPatches: Array<Record<string, unknown>>;
  screenWorkArea: TestWindowBounds;
  browserWindowOptions: Array<Record<string, unknown>>;
  appIsPackaged: boolean;
  loginItemOpenAtLogin: boolean;
  wasOpenedAtLogin: boolean;
  terminalRecords: Map<string, { exited: boolean; pty: unknown }>;
  trayTemplateImage: boolean;
  trayTemplateBitmapCreated: boolean;
  accountAuthSnapshot: AccountAuthSnapshot;
  accountOverview: AccountOverview;
}

function signedOutAccountSnapshot(): AccountAuthSnapshot {
  return {
    status: "signed_out",
    issuer: "https://api.dpccgaming.xyz",
    clientId: "pcc-agent",
    deviceName: "Test Mac",
    account: null,
    expiresAt: null,
    scopes: [],
    legacyManual: false,
  };
}

function connectedAccountSnapshot(
  displayName = "DPCC User",
  maskedEmail = "d***@example.com",
  expiresAt = Date.now() + 86_400_000,
): AccountAuthSnapshot {
  return {
    status: "connected",
    issuer: "https://api.dpccgaming.xyz",
    clientId: "pcc-agent",
    deviceName: "Test Mac",
    account: { displayName, maskedEmail },
    expiresAt,
    scopes: [],
    legacyManual: false,
  };
}

function unavailableAccountOverview(): AccountOverview {
  return {
    balance: { error: "not_configured" },
    subscription: { error: "not_configured" },
  };
}

const state = vi.hoisted<MainState>(() => ({
  requestSingleInstanceLockReturn: true,
  appWhenReady: Promise.resolve(),
  appQuitCalls: 0,
  dialogCalls: 0,
  dialogResponses: [],
  acpActiveTurnCount: 0,
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
  appIsPackaged: false,
  loginItemOpenAtLogin: false,
  wasOpenedAtLogin: false,
  terminalRecords: new Map(),
  trayTemplateImage: false,
  trayTemplateBitmapCreated: false,
  accountAuthSnapshot: signedOutAccountSnapshot(),
  accountOverview: unavailableAccountOverview(),
}));

function resetState(): void {
  state.requestSingleInstanceLockReturn = true;
  state.appWhenReady = Promise.resolve();
  state.appQuitCalls = 0;
  state.dialogCalls = 0;
  state.dialogResponses = [];
  state.acpActiveTurnCount = 0;
  state.appEventHandlers = {};
  state.ipcMainEventHandlers = {};
  state.browserWindows = [];
  state.menuTemplates = [];
  state.tray = null;
  state.safeSendCalls = [];
  state.sessionsForTray = [];
  state.activateNotification = undefined;
  state.activateAccountWindow = undefined;
  state.prepareForUpdateInstall = undefined;
  state.notificationsListened = false;
  state.appSettings = {
    macBackgroundEffect: "liquid-glass",
    windowBounds: null,
    windowMaximized: false,
  };
  state.settingsPatches = [];
  state.screenWorkArea = { x: 0, y: 0, width: 2560, height: 1440 };
  state.browserWindowOptions = [];
  state.appIsPackaged = false;
  state.loginItemOpenAtLogin = false;
  state.wasOpenedAtLogin = false;
  state.terminalRecords.clear();
  state.trayTemplateImage = false;
  state.trayTemplateBitmapCreated = false;
  state.accountAuthSnapshot = signedOutAccountSnapshot();
  state.accountOverview = unavailableAccountOverview();
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
  private alwaysOnTop = false;
  private normalBounds: TestWindowBounds;
  private eventMap: MockEventMap = {};

  public showCalls = 0;
  public hideCalls = 0;
  public restoreCalls = 0;
  public focusCalls = 0;
  public maximizeCalls = 0;
  public moveTopCalls = 0;
  public alwaysOnTopCalls: boolean[] = [];

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

  isAlwaysOnTop(): boolean {
    return this.alwaysOnTop;
  }

  setAlwaysOnTop(value: boolean): void {
    this.alwaysOnTop = value;
    this.alwaysOnTopCalls.push(value);
  }

  moveTop(): void {
    this.moveTopCalls += 1;
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

class FakeMenu {
  private readonly events: MockEventMap = {};
  public closePopupCalls = 0;

  constructor(public readonly template: unknown[]) {}

  once(event: string, cb: (...args: unknown[]) => void): this {
    this.events[event] = this.events[event] ?? [];
    this.events[event].push(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.events[event] ?? [];
    delete this.events[event];
    for (const cb of listeners) cb(...args);
  }

  closePopup(): void {
    this.closePopupCalls += 1;
    this.emit("menu-will-close", {});
  }
}

class FakeTray {
  public clickHandlers = 0;
  public doubleClickHandlers = 0;
  public rightClickHandlers = 0;
  public popUpContextMenuCalls = 0;
  private destroyed = false;
  private events: MockEventMap = {};

  constructor() {
    state.tray = this;
  }

  setToolTip(): void {}

  on(event: string, cb: (...args: unknown[]) => void): this {
    this.events[event] = this.events[event] ?? [];
    this.events[event].push(cb);
    if (event === "click") this.clickHandlers += 1;
    if (event === "double-click") this.doubleClickHandlers += 1;
    if (event === "right-click") this.rightClickHandlers += 1;
    return this;
  }

  popUpContextMenu(menu: { template?: unknown }): void {
    this.popUpContextMenuCalls += 1;
    state.menuTemplates.push(menu);
  }

  destroy(): void {
    this.destroyed = true;
  }

  isDestroyed() {
    return this.destroyed;
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
  const electronMock = {
    app: {
      requestSingleInstanceLock: vi.fn(() => state.requestSingleInstanceLockReturn),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        state.appEventHandlers[event] = state.appEventHandlers[event] ?? [];
        state.appEventHandlers[event].push(handler);
      }),
      off: vi.fn(),
      once: vi.fn(),
      commandLine,
      whenReady: vi.fn(() => state.appWhenReady),
      get isPackaged() {
        return state.appIsPackaged;
      },
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
      getLoginItemSettings: vi.fn(() => ({
        openAtLogin: state.loginItemOpenAtLogin,
        wasOpenedAtLogin: state.wasOpenedAtLogin,
      })),
      setLoginItemSettings: vi.fn((settings: { openAtLogin?: boolean }) => {
        state.loginItemOpenAtLogin = settings.openAtLogin === true;
      }),
    },
    BrowserWindow: class extends FakeBrowserWindow {
      constructor(options?: Record<string, unknown>) {
        super(options);
      }
    },
    clipboard: { writeText: vi.fn() },
    dialog: {
      showMessageBox: vi.fn(async () => {
        state.dialogCalls += 1;
        return { response: state.dialogResponses.shift() ?? 1 };
      }),
    },
    globalShortcut: {
      register: vi.fn(() => true),
      unregisterAll: vi.fn(),
    },
    Menu: {
      setApplicationMenu: vi.fn(),
      buildFromTemplate: vi.fn((template: unknown[]) => {
        state.menuTemplates.push(template);
        return new FakeMenu(template);
      }),
      sendActionToFirstResponder: vi.fn(),
    },
    nativeImage: {
      createEmpty: vi.fn(() => ({}) as unknown),
      createFromPath: vi.fn(() => {
        const bitmap = Buffer.alloc(32 * 32 * 4);
        for (let pixel = 0; pixel < 32 * 32; pixel += 1) bitmap[pixel * 4 + 3] = 255;
        for (let y = 10; y < 22; y += 1) {
          for (let x = 12; x < 20; x += 1) {
            const pixel = (y * 32 + x) * 4;
            bitmap[pixel] = 255;
            bitmap[pixel + 1] = 255;
            bitmap[pixel + 2] = 255;
          }
        }
        return {
          getSize: () => ({ width: 32, height: 32 }),
          toBitmap: () => bitmap,
          setTemplateImage: (value: boolean) => {
            state.trayTemplateImage = value;
          },
        } as unknown;
      }),
      createFromBitmap: vi.fn(() => {
        state.trayTemplateBitmapCreated = true;
        return {
          setTemplateImage: (value: boolean) => {
            state.trayTemplateImage = value;
          },
        } as unknown;
      }),
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
      constructor(_image?: unknown) {
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
  initAutoUpdater: vi.fn((
    _getMainWindow: unknown,
    _diagnosticBuild: boolean,
    prepareForInstall: () => Promise<boolean>,
  ) => {
    state.prepareForUpdateInstall = prepareForInstall;
  }),
  getIsInstallingUpdate: vi.fn(() => false),
}));

vi.mock("./lib/prerelease-check", () => ({
  initPreReleaseCheck: vi.fn(),
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

vi.mock("./ipc/title-gen", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/terminal", () => ({
  register: vi.fn(),
  terminals: state.terminalRecords,
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
  getActiveTurnCount: vi.fn(() => state.acpActiveTurnCount),
}));

vi.mock("./ipc/mcp", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/settings", () => ({
  register: vi.fn(),
}));

vi.mock("./ipc/account", () => ({
  register: vi.fn(),
  getOverview: vi.fn(async () => state.accountOverview),
}));

vi.mock("./ipc/account-auth", () => ({
  register: vi.fn((_getMainWindow: unknown, activateWindow: () => void) => {
    state.activateAccountWindow = activateWindow;
  }),
  initialize: vi.fn(),
  dispose: vi.fn(),
  getSnapshot: vi.fn(() => state.accountAuthSnapshot),
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
  platform?: NodeJS.Platform;
  requestSingleInstanceLockReturn?: boolean;
  sessionsForTray?: unknown[];
  windowBounds?: TestWindowBounds | null;
  windowMaximized?: boolean;
  screenWorkArea?: TestWindowBounds;
  appIsPackaged?: boolean;
  loginItemOpenAtLogin?: boolean;
  wasOpenedAtLogin?: boolean;
  accountAuthSnapshot?: AccountAuthSnapshot;
  accountOverview?: AccountOverview;
} = {}): Promise<void> {
  globalThis.__PCC_DIAGNOSTIC_BUILD__ = false;
  resetState();
  state.requestSingleInstanceLockReturn = options.requestSingleInstanceLockReturn ?? true;
  state.sessionsForTray = options.sessionsForTray ?? [];
  state.appSettings.windowBounds = options.windowBounds ?? null;
  state.appSettings.windowMaximized = options.windowMaximized ?? false;
  state.screenWorkArea = options.screenWorkArea ?? state.screenWorkArea;
  state.appIsPackaged = options.appIsPackaged ?? false;
  state.loginItemOpenAtLogin = options.loginItemOpenAtLogin ?? false;
  state.wasOpenedAtLogin = options.wasOpenedAtLogin ?? false;
  state.accountAuthSnapshot = options.accountAuthSnapshot ?? signedOutAccountSnapshot();
  state.accountOverview = options.accountOverview ?? unavailableAccountOverview();
  vi.clearAllMocks();
  vi.resetModules();
  Object.defineProperty(process, "platform", { value: options.platform ?? "win32" });
  Object.defineProperty(process, "getSystemVersion", {
    value: () => "15.0.0",
    configurable: true,
  });
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
  handlers[0]({ sender: { id: state.browserWindows[0]?.webContents.id } });
}

describe("main lifecycle / tray navigation", () => {
  beforeEach(() => {
    removeMainModuleSignalListeners();
    resetState();
  });

  afterEach(() => {
    removeMainModuleSignalListeners();
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

  it("reclaims the foreground window after Windows account authorization", async () => {
    vi.useFakeTimers();
    try {
      await loadMainModule();
      const window = state.browserWindows[0];
      expect(window).toBeTruthy();
      expect(state.activateAccountWindow).toBeTypeOf("function");

      (window as unknown as { minimized: boolean; visible: boolean }).minimized = true;
      (window as unknown as { minimized: boolean; visible: boolean }).visible = false;

      state.activateAccountWindow?.();

      expect(window?.isVisible()).toBe(true);
      expect(window?.isMinimized()).toBe(false);
      expect(window?.alwaysOnTopCalls).toEqual([true]);
      expect(window?.moveTopCalls).toBe(1);
      expect(window?.focusCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(100);

      expect(window?.alwaysOnTopCalls).toEqual([true, false]);
      expect(window?.moveTopCalls).toBe(2);
      expect(window?.focusCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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

  it("restores a saved compact window without applying the all-panels bootstrap width", async () => {
    await loadMainModule({
      platform: "darwin",
      windowBounds: { x: 220, y: 140, width: 840, height: 700 },
    });

    expect(state.browserWindowOptions[0]).toMatchObject({
      x: 220,
      y: 140,
      width: 840,
      height: 700,
      minWidth: 600,
    });
  }, 15_000);

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

  it("flushes the latest macOS window bounds before quitting", async () => {
    vi.useFakeTimers();
    try {
      await loadMainModule({ platform: "darwin" });
      const window = state.browserWindows[0];
      window?.setNormalBounds({ x: 260, y: 180, width: 980, height: 760 });
      window?.emit("resize");

      expect(state.settingsPatches).toHaveLength(0);
      const quitEvent = { preventDefault: vi.fn() };
      state.appEventHandlers["before-quit"]?.[0]?.(quitEvent);

      expect(state.settingsPatches).toEqual([{
        windowBounds: { x: 260, y: 180, width: 980, height: 760 },
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

  it("keeps running work alive when the macOS close button hides the window", async () => {
    await loadMainModule({ platform: "darwin" });
    state.acpActiveTurnCount = 1;
    const window = state.browserWindows[0];
    expect(window).toBeTruthy();
    window?.emit("ready-to-show");

    const event = { preventDefault: vi.fn() };
    window?.emit("close", event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(window?.hideCalls).toBe(1);
    expect(window?.isVisible()).toBe(false);
    expect(state.dialogCalls).toBe(0);
    expect(state.appQuitCalls).toBe(0);
  });

  it("restores the hidden macOS window when the Dock activates the app", async () => {
    await loadMainModule({ platform: "darwin" });
    const window = state.browserWindows[0];
    window?.emit("ready-to-show");
    window?.emit("close", { preventDefault: vi.fn() });
    expect(window?.isVisible()).toBe(false);

    const activate = state.appEventHandlers.activate?.[0];
    expect(activate).toBeTypeOf("function");
    activate?.();

    expect(window?.isVisible()).toBe(true);
    expect(window?.focusCalls).toBeGreaterThan(0);
  });

  it("recreates the macOS window from the Dock after it was destroyed", async () => {
    await loadMainModule({ platform: "darwin" });
    const window = state.browserWindows[0];
    window?.emit("closed");

    state.appEventHandlers.activate?.[0]?.();

    expect(state.browserWindows).toHaveLength(2);
  });

  it("requires confirmation before quitting with an active Agent task", async () => {
    await loadMainModule({ platform: "darwin" });
    state.acpActiveTurnCount = 1;
    const beforeQuit = state.appEventHandlers["before-quit"]?.[0];
    expect(beforeQuit).toBeTypeOf("function");

    state.dialogResponses.push(1);
    const cancelledEvent = { preventDefault: vi.fn() };
    beforeQuit?.(cancelledEvent);
    await flushImmediate();

    expect(cancelledEvent.preventDefault).toHaveBeenCalled();
    expect(state.dialogCalls).toBe(1);
    expect(state.appQuitCalls).toBe(0);

    state.dialogResponses.push(0);
    const confirmedEvent = { preventDefault: vi.fn() };
    beforeQuit?.(confirmedEvent);
    await flushImmediate();

    expect(confirmedEvent.preventDefault).toHaveBeenCalled();
    expect(state.dialogCalls).toBe(2);
    expect(state.appQuitCalls).toBe(1);
  });

  it("confirms and flushes persistence before a macOS update install", async () => {
    await loadMainModule({ platform: "darwin" });
    state.acpActiveTurnCount = 1;
    state.dialogResponses.push(0);
    expect(state.prepareForUpdateInstall).toBeTypeOf("function");

    const preparation = state.prepareForUpdateInstall!();
    await flushImmediate();

    const flushCall = state.safeSendCalls.find((call) => call.channel === "app:before-close");
    expect(flushCall).toBeTruthy();
    const flushHandler = state.ipcMainEventHandlers["app:persistence-flushed"]?.[0];
    expect(flushHandler).toBeTypeOf("function");
    flushHandler?.({ sender: { id: 123 } }, flushCall?.payload, true);

    await expect(preparation).resolves.toBe(true);
    expect(state.dialogCalls).toBe(1);
  });

  it("cancels a macOS update install before persistence shutdown", async () => {
    await loadMainModule({ platform: "darwin" });
    state.acpActiveTurnCount = 1;
    state.dialogResponses.push(1);

    await expect(state.prepareForUpdateInstall?.()).resolves.toBe(false);

    expect(state.dialogCalls).toBe(1);
    expect(state.safeSendCalls.some((call) => call.channel === "app:before-close")).toBe(false);
  });

  it("cleans up Agent processes from the macOS will-quit path", async () => {
    await loadMainModule({ platform: "darwin" });
    const acpSessions = await import("./ipc/acp-sessions");
    const wechat = await import("./ipc/wechat");

    state.appEventHandlers["will-quit"]?.[0]?.();

    expect(acpSessions.stopAll).toHaveBeenCalled();
    expect(wechat.stopBridge).toHaveBeenCalled();
  });

  it("uses a native macOS menu instead of creating a custom popover window", async () => {
    await loadMainModule({ platform: "darwin" });
    await Promise.resolve();

    const tray = state.tray;
    expect(tray).toBeTruthy();
    expect(tray?.clickHandlers).toBe(1);
    expect(tray?.rightClickHandlers).toBe(1);
    expect(tray?.doubleClickHandlers).toBe(0);
    expect(state.trayTemplateImage).toBe(true);
    expect(state.trayTemplateBitmapCreated).toBe(true);
    expect(state.browserWindows).toHaveLength(1);

    tray?.emit("click");
    await Promise.resolve();

    const nativeMenu = state.menuTemplates[state.menuTemplates.length - 1] as {
      template: Array<{ label?: string; type?: string }>;
    };
    expect(state.browserWindows).toHaveLength(1);
    expect(nativeMenu.template).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "header", label: "Account" }),
      expect.objectContaining({ type: "header", label: "Running" }),
      expect.objectContaining({ type: "header", label: "Recent" }),
      expect.objectContaining({ type: "checkbox", label: "Open at Login" }),
      expect.objectContaining({ label: "Quit PccAgent" }),
    ]));
  });

  it("closes the native macOS menu on a second tray click without reopening it", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-14T21:30:00+08:00"));
      await loadMainModule({ platform: "darwin" });
      const tray = state.tray;

      tray?.emit("click");
      const firstMenu = state.menuTemplates[state.menuTemplates.length - 1] as FakeMenu;
      expect(tray?.popUpContextMenuCalls).toBe(1);

      tray?.emit("click");
      expect(firstMenu.closePopupCalls).toBe(1);
      expect(tray?.popUpContextMenuCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(201);
      tray?.emit("click");
      expect(tray?.popUpContextMenuCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reopen when macOS closes the menu before delivering the tray click", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-14T21:30:00+08:00"));
      await loadMainModule({ platform: "darwin" });
      const tray = state.tray;

      tray?.emit("click");
      const firstMenu = state.menuTemplates[state.menuTemplates.length - 1] as FakeMenu;
      firstMenu.emit("menu-will-close", {});
      tray?.emit("click");

      expect(tray?.popUpContextMenuCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders account, subscription, quota, runtime and recent sessions as native menu rows", async () => {
    await loadMainModule({
      platform: "darwin",
      sessionsForTray: [
        {
          id: "recent-1",
          projectId: "project-1",
          title: "Recent work",
          engine: "codex",
          lastMessageAt: 1234,
        },
      ],
      accountAuthSnapshot: connectedAccountSnapshot(),
      accountOverview: {
        balance: { totalUsd: 100, usedUsd: 25, remainingUsd: 75, unlimited: false },
        subscription: {
          state: "active",
          expiresAt: Date.now() + 86_400_000,
          items: [{
            id: 1,
            planId: 2,
            name: "Pro",
            totalUsd: 100,
            usedUsd: 25,
            remainingUsd: 75,
            unlimited: false,
            expiresAt: Date.now() + 86_400_000,
          }],
        },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    state.acpActiveTurnCount = 2;
    state.terminalRecords.set("terminal-1", { exited: false, pty: {} });
    state.terminalRecords.set("terminal-2", { exited: true, pty: {} });
    state.tray?.emit("click");

    const nativeMenu = state.menuTemplates[state.menuTemplates.length - 1] as {
      template: Array<{ label?: string; sublabel?: string }>;
    };
    expect(nativeMenu.template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "DPCC User", sublabel: "d***@example.com" }),
      expect.objectContaining({ label: "2 Agent, 1 Terminal" }),
      expect.objectContaining({ label: "Recent work" }),
      expect.objectContaining({ label: "Subscription: Pro", sublabel: "Active" }),
      expect.objectContaining({
        label: "Quota: $75.00 available",
        sublabel: "━━━━━━━━━───  75%",
      }),
    ]));
  });

  it("does not show an overview cached for a previous authorization", async () => {
    await loadMainModule({
      platform: "darwin",
      accountAuthSnapshot: connectedAccountSnapshot("First User", "f***@example.com", 1000),
      accountOverview: {
        balance: { totalUsd: 100, usedUsd: 25, remainingUsd: 75, unlimited: false },
        subscription: { state: "none", expiresAt: null, items: [] },
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    state.accountAuthSnapshot = connectedAccountSnapshot(
      "Second User",
      "s***@example.com",
      2000,
    );
    state.tray?.emit("click");

    const nativeMenu = state.menuTemplates[state.menuTemplates.length - 1] as {
      template: Array<{ label?: string; sublabel?: string }>;
    };
    expect(nativeMenu.template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Second User", sublabel: "s***@example.com" }),
      expect.objectContaining({ label: "Quota: Unavailable" }),
    ]));
    expect(nativeMenu.template).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Quota: $75.00 available" }),
    ]));
  });

  it("queues native menu actions until the main renderer listeners are ready", async () => {
    await loadMainModule({ platform: "darwin" });
    state.tray?.emit("click");
    const nativeMenu = state.menuTemplates[state.menuTemplates.length - 1] as {
      template: Array<{ label?: string; click?: () => void }>;
    };
    const newChat = nativeMenu.template.find((item) => item.label === "New Chat");
    expect(newChat).toBeTruthy();
    state.safeSendCalls = [];

    newChat?.click?.();
    await flushImmediate();
    expect(state.safeSendCalls.some((call) => call.channel === "menu-bar:new-chat")).toBe(false);

    markWindowActivationReady();
    await Promise.resolve();
    expect(state.safeSendCalls).toContainEqual({
      channel: "menu-bar:new-chat",
      payload: undefined,
    });
  });

  it("updates the packaged macOS login item through the native checkbox", async () => {
    await loadMainModule({
      platform: "darwin",
      appIsPackaged: true,
      loginItemOpenAtLogin: false,
    });
    state.tray?.emit("click");
    const nativeMenu = state.menuTemplates[state.menuTemplates.length - 1] as {
      template: Array<{
        label?: string;
        type?: string;
        checked?: boolean;
        click?: (item: { checked: boolean }) => void;
      }>;
    };
    const loginItem = nativeMenu.template.find((item) => item.type === "checkbox");
    expect(loginItem).toMatchObject({ label: "Open at Login", checked: false });
    loginItem?.click?.({ checked: true });
    expect(state.loginItemOpenAtLogin).toBe(true);
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
