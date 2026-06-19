import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({
  log: vi.fn(),
}));
vi.mock("../posthog", () => ({
  captureException: vi.fn(),
}));

import { createClaudeCodexBridgeController } from "../claude-codex-bridge-controller";

describe("createClaudeCodexBridgeController", () => {
  const controllers: Array<ReturnType<typeof createClaudeCodexBridgeController>> = [];

  afterEach(async () => {
    await Promise.all(controllers.map((controller) => controller.stop()));
    controllers.length = 0;
  });

  it("rejects delegate requests without the bridge token", async () => {
    const controller = createClaudeCodexBridgeController({ notifyRenderer: vi.fn() });
    controllers.push(controller);
    await controller.start();

    const response = await fetch(`${controller.endpoint}/delegate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "implement this" }),
    });

    expect(response.status).toBe(401);
  });

  it("notifies the renderer and resolves with renderer completion", async () => {
    let requestId = "";
    const controller = createClaudeCodexBridgeController({
      notifyRenderer: vi.fn((request) => {
        requestId = request.id;
        queueMicrotask(() => {
          controller.completeDelegation({
            id: request.id,
            ok: true,
            content: "Codex completed the delegated work.",
            codexSessionId: "codex-session-1",
          });
        });
      }),
    });
    controllers.push(controller);
    await controller.start();

    const response = await fetch(`${controller.endpoint}/delegate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${controller.token}`,
      },
      body: JSON.stringify({ prompt: "implement this", cwd: "/repo" }),
    });

    expect(response.status).toBe(200);
    expect(requestId).toMatch(/^delegation-/);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      content: "Codex completed the delegated work.",
      codexSessionId: "codex-session-1",
    });
  });
});
