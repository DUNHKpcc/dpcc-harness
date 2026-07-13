import { afterEach, describe, expect, it } from "vitest";
import type { RegistryAgent } from "@/types";
import { bgAgentStore } from "../agent-store";
import {
  getPreferredRegistryBinaryTarget,
  getRegistryAgentSetupUrl,
} from "../agent-store-utils";

const lifecycleSessionId = "agent-store-lifecycle-test";

afterEach(() => {
  bgAgentStore.clearSession(lifecycleSessionId);
});

function makeRegistryAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: "cursor",
    name: "Cursor",
    version: "0.1.0",
    description: "Test agent",
    authors: ["ACP"],
    license: "MIT",
    distribution: {
      binary: {
        "darwin-aarch64": {
          archive: "https://example.com/darwin-arm64.tar.gz",
          cmd: "./cursor-agent",
          args: ["acp"],
        },
        "darwin-x86_64": {
          archive: "https://example.com/darwin-x64.tar.gz",
          cmd: "./cursor-agent",
          args: ["acp"],
        },
      },
    },
    ...overrides,
  };
}

describe("getPreferredRegistryBinaryTarget", () => {
  it("returns the first matching platform target", () => {
    const agent = makeRegistryAgent();

    expect(getPreferredRegistryBinaryTarget(agent, ["darwin-aarch64"])).toEqual({
      archive: "https://example.com/darwin-arm64.tar.gz",
      cmd: "./cursor-agent",
      args: ["acp"],
    });
  });

  it("returns null when no platform target matches", () => {
    const agent = makeRegistryAgent();

    expect(getPreferredRegistryBinaryTarget(agent, ["linux-x86_64"])).toBeNull();
  });
});

describe("getRegistryAgentSetupUrl", () => {
  it("prefers the platform archive over the repository URL", () => {
    const agent = makeRegistryAgent({
      repository: "https://github.com/example/cursor-agent",
    });

    expect(getRegistryAgentSetupUrl(agent, ["darwin-aarch64"])).toBe(
      "https://example.com/darwin-arm64.tar.gz",
    );
  });

  it("falls back to the repository when no platform archive exists", () => {
    const agent = makeRegistryAgent({
      repository: "https://github.com/example/cursor-agent",
    });

    expect(getRegistryAgentSetupUrl(agent, ["linux-x86_64"])).toBe(
      "https://github.com/example/cursor-agent",
    );
  });

  it("returns null when neither archive nor repository is available", () => {
    const agent = makeRegistryAgent({
      repository: undefined,
    });

    expect(getRegistryAgentSetupUrl(agent, ["linux-x86_64"])).toBeNull();
  });
});

describe("BackgroundAgentStore task lifecycle", () => {
  it("uses the membership snapshot to clear an agent whose completion edge was missed", () => {
    bgAgentStore.handleTaskStarted(lifecycleSessionId, {
      type: "system",
      subtype: "task_started",
      task_id: "task-1",
      tool_use_id: "tool-1",
      description: "Inspect the project",
    });

    bgAgentStore.reconcileBackgroundTasks(lifecycleSessionId, {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "task-1", task_type: "agent", description: "Inspect the project" }],
    });
    expect(bgAgentStore.getAgents(lifecycleSessionId)).toMatchObject([
      { taskId: "task-1", status: "running", isPending: false },
    ]);

    const completed = bgAgentStore.reconcileBackgroundTasks(lifecycleSessionId, {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [],
    });

    expect(completed).toEqual([
      { taskId: "task-1", toolUseId: "tool-1", status: "completed" },
    ]);
    expect(bgAgentStore.getAgents(lifecycleSessionId)).toMatchObject([
      { taskId: "task-1", status: "completed" },
    ]);
  });

  it("matches a terminal XML notification by task id when tool_use_id is absent", () => {
    bgAgentStore.reconcileBackgroundTasks(lifecycleSessionId, {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "task-xml", task_type: "agent", description: "Run checks" }],
    });

    const completion = bgAgentStore.handleUserMessage(lifecycleSessionId, [
      "<task-notification>",
      "<task-id>task-xml</task-id>",
      "<status>completed</status>",
      "<summary>Checks passed</summary>",
      "<total_tokens>42</total_tokens>",
      "<tool_uses>2</tool_uses>",
      "<duration_ms>500</duration_ms>",
      "</task-notification>",
    ].join(""));

    expect(completion).toMatchObject({ taskId: "task-xml", status: "completed" });
    expect(bgAgentStore.getAgents(lifecycleSessionId)).toMatchObject([
      { taskId: "task-xml", status: "completed", result: "Checks passed" },
    ]);
  });
});
