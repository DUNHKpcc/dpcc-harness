import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  resolveEffectiveCodexModels: vi.fn(),
  destroy: vi.fn(),
  rpcInstances: [] as Array<{ isAlive: boolean }>,
  requests: [] as Array<{ method: string; params?: Record<string, unknown> }>,
  findCodexRolloutPath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0" },
  BrowserWindow: class {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<any>) => {
      mocks.handlers.set(channel, handler);
    },
    on: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ pid: 1234 })),
}));

vi.mock("../lib/codex-rpc", () => ({
  CodexRpcClient: class {
    isAlive = true;

    constructor() {
      mocks.rpcInstances.push(this);
    }

    request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      mocks.requests.push({ method, params });
      if (method === "initialize") return {};
      if (method === "account/read") return { requiresOpenaiAuth: false, account: null };
      if (method === "model/list") {
        return {
          data: [{
            id: "native-model",
            model: "native-model",
            upgrade: null,
            displayName: "Native Model",
            description: "",
            hidden: false,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "none",
            inputModalities: ["text"],
            supportsPersonality: false,
            isDefault: true,
          }],
        };
      }
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      if (method === "thread/resume") {
        return { thread: { id: "thread-resumed", path: params?.path ?? null } };
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    notify = vi.fn();
    onNotification = vi.fn();
    onServerRequest = vi.fn();
    onStderr = vi.fn();
    onExit = vi.fn();
    destroy = vi.fn(() => {
      this.isAlive = false;
      mocks.destroy();
    });
  },
}));

vi.mock("../lib/codex-binary", () => ({
  getCodexBinaryPath: vi.fn(async () => "/tmp/codex"),
  getCodexBinaryStatus: vi.fn(async () => ({ installed: true })),
  getCodexVersion: vi.fn(async () => "1.0.0"),
  getCodexBinaryInfo: vi.fn(async () => ({})),
  downloadCodexUpdate: vi.fn(async () => ({})),
}));

vi.mock("../lib/codex-model-catalog", () => ({
  resolveEffectiveCodexModels: mocks.resolveEffectiveCodexModels,
}));

vi.mock("../lib/codex-upstream", () => ({
  codexUpstreamThreadParams: vi.fn(() => ({})),
}));

vi.mock("../lib/codex-home-isolation", () => ({
  buildCodexAppServerEnv: vi.fn(() => ({ CODEX_HOME: "/tmp/current-codex-home" })),
  findCodexRolloutPath: mocks.findCodexRolloutPath,
  getCodexRolloutSearchHomes: vi.fn(() => ["/tmp/current-codex-home", "/tmp/legacy-codex-home"]),
}));
vi.mock("../lib/app-settings", () => ({ getAppSetting: vi.fn(() => "PccAgent") }));
vi.mock("../lib/logger", () => ({ log: vi.fn() }));
vi.mock("../lib/safe-send", () => ({ safeSend: vi.fn() }));
vi.mock("../lib/error-utils", () => ({ reportError: vi.fn((_code: string, error: unknown) => String(error)) }));
vi.mock("../lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("../lib/macos-dock-focus", () => ({ reclaimMacDockFocus: vi.fn() }));
vi.mock("../lib/session-cwd", () => ({ normalizeSessionCwd: (cwd: string) => cwd }));
vi.mock("../lib/codex-resume-error", () => ({ formatCodexResumeError: (error: string) => error }));

describe("Codex model IPC catalog", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.resolveEffectiveCodexModels.mockReset();
    mocks.requests.length = 0;
    mocks.findCodexRolloutPath.mockReset();
    mocks.resolveEffectiveCodexModels.mockImplementation(async (models: Array<{ id: string }>) => (
      models.map((model) => ({ ...model, id: `upstream-${model.id}`, model: `upstream-${model.id}` }))
    ));
  });

  afterEach(async () => {
    const { stopAll } = await import("./codex-sessions");
    stopAll();
  });

  it("uses the effective upstream catalog for start, active-session listing, and short-lived listing", async () => {
    const { register, stopAll } = await import("./codex-sessions");
    register(() => null);
    const start = mocks.handlers.get("codex:start");
    const listModels = mocks.handlers.get("codex:list-models");

    const started = await start?.({}, { cwd: "/tmp/project", model: "upstream-native-model" });
    expect(started).toMatchObject({
      selectedModel: "upstream-native-model",
      models: [expect.objectContaining({ id: "upstream-native-model" })],
    });

    await expect(listModels?.({})).resolves.toMatchObject({
      models: [expect.objectContaining({ id: "upstream-native-model" })],
    });

    stopAll();
    await expect(listModels?.({})).resolves.toMatchObject({
      models: [expect.objectContaining({ id: "upstream-native-model" })],
    });
    expect(mocks.resolveEffectiveCodexModels).toHaveBeenCalledTimes(3);
    expect(mocks.destroy).toHaveBeenCalled();
  });

  it("resumes an older thread through its discovered rollout path", async () => {
    const rolloutPath = "/tmp/legacy-codex-home/sessions/rollout-thread-legacy.jsonl";
    mocks.findCodexRolloutPath.mockReturnValue(rolloutPath);
    const { register } = await import("./codex-sessions");
    register(() => null);
    const resume = mocks.handlers.get("codex:resume");

    const result = await resume?.({}, {
      cwd: "/tmp/project",
      threadId: "thread-legacy",
      rolloutPath: "/tmp/stale-rollout.jsonl",
    });

    expect(mocks.findCodexRolloutPath).toHaveBeenCalledWith(
      "thread-legacy",
      "/tmp/stale-rollout.jsonl",
      ["/tmp/current-codex-home", "/tmp/legacy-codex-home"],
    );
    expect(mocks.requests).toContainEqual({
      method: "thread/resume",
      params: expect.objectContaining({
        threadId: "thread-legacy",
        path: rolloutPath,
      }),
    });
    expect(result).toMatchObject({
      sessionId: expect.any(String),
      threadId: "thread-resumed",
      rolloutPath,
    });
  });
});
