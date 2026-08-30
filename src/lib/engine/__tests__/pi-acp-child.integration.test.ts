import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyAcpTurn,
  createAcpTurnObservation,
  observeAcpTurnUpdate,
} from "@shared/lib/acp-turn";

interface WorkspacePaths {
  root: string;
  home: string;
  agentDir: string;
  sessionDir: string;
  workspace: string;
}

interface PiAcpConnection {
  missing: boolean;
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<Record<string, unknown>>;
  notify: (method: string, params: unknown) => void;
  sessionUpdates: unknown[];
  childExit: () => { code: number | null; signal: string | null } | null;
  close: () => Promise<void>;
}

interface IntegrationHarness {
  createWorkspaceRoot: () => Promise<WorkspacePaths>;
  spawnPiAcp: (paths: WorkspacePaths, mode: string) => PiAcpConnection;
  buildClientCapabilities: () => Record<string, unknown>;
}

const workspaces: string[] = [];

function readStartupInfo(result: Record<string, unknown>): string | undefined {
  const meta = result._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const piAcp = (meta as Record<string, unknown>).piAcp;
  if (!piAcp || typeof piAcp !== "object" || Array.isArray(piAcp)) return undefined;
  const startupInfo = (piAcp as Record<string, unknown>).startupInfo;
  return typeof startupInfo === "string" && startupInfo ? startupInfo : undefined;
}

async function waitForStartupInfo(
  connection: PiAcpConnection,
  startupInfo: string | undefined,
) {
  if (!startupInfo) return;
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const received = connection.sessionUpdates.some((update) => {
      if (!update || typeof update !== "object" || Array.isArray(update)) return false;
      const content = (update as Record<string, unknown>).content;
      if (!content || typeof content !== "object" || Array.isArray(content)) return false;
      return (content as Record<string, unknown>).text === startupInfo;
    });
    if (received) return;

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("fixture_startup_info_timeout");
}

async function loadHarness(): Promise<IntegrationHarness> {
  // The JavaScript harness owns the real process boundary. This test owns the
  // Harnss outcome classification so fixture mode cannot dictate success.
  // @ts-expect-error The integration harness intentionally has no declaration file.
  return import("../../../../scripts/test-pi-acp-integration.mjs");
}

async function runScenario(mode: "normal" | "retry-only" | "retry-then-success") {
  const harness = await loadHarness();
  const paths = await harness.createWorkspaceRoot();
  workspaces.push(paths.root);
  await Promise.all([
    fsp.writeFile(
      path.join(paths.agentDir, "settings.json"),
      JSON.stringify({ quietStartup: false }, null, 2),
      "utf8",
    ),
    fsp.writeFile(path.join(paths.workspace, "AGENTS.md"), "# Fixture context\n", "utf8"),
  ]);
  const connection = harness.spawnPiAcp(paths, mode === "retry-only" ? "" : mode);
  if (connection.missing) throw new Error("pi_acp_missing");

  try {
    await connection.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "harnss-classifier-test", version: "1.0.0" },
      clientCapabilities: harness.buildClientCapabilities(),
    });
    const created = await connection.request("session/new", {
      cwd: paths.workspace,
      mcpServers: [],
    });
    expect(typeof created.sessionId).toBe("string");
    await waitForStartupInfo(connection, readStartupInfo(created));

    const promptText = mode === "retry-only"
      ? "fixture:retry-only classify the real adapter output"
      : `${mode} classifier fixture`;
    const updateStart = connection.sessionUpdates.length;
    const result = await connection.request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: promptText }],
    });

    const observation = createAcpTurnObservation();
    for (const update of connection.sessionUpdates.slice(updateStart)) {
      observeAcpTurnUpdate(observation, update, {
        isPi: true,
        adapterVersion: "0.0.33",
      });
    }
    return classifyAcpTurn({
      stopReason: result.stopReason,
      isPi: true,
      adapterVersion: "0.0.33",
      observation,
    });
  } finally {
    await connection.close();
  }
}

async function runCancelScenario() {
  const harness = await loadHarness();
  const paths = await harness.createWorkspaceRoot();
  workspaces.push(paths.root);
  const connection = harness.spawnPiAcp(paths, "hold");
  if (connection.missing) throw new Error("pi_acp_missing");

  try {
    await connection.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "harnss-cancel-test", version: "1.0.0" },
      clientCapabilities: harness.buildClientCapabilities(),
    });
    const created = await connection.request("session/new", {
      cwd: paths.workspace,
      mcpServers: [],
    });
    const prompt = connection.request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "fixture:hold cancel the real adapter turn" }],
    }, 5_000);
    const deadline = Date.now() + 5_000;
    while (!connection.sessionUpdates.some((update) => (
      typeof update === "object"
      && update !== null
      && (update as { sessionUpdate?: string }).sessionUpdate === "tool_call"
    ))) {
      if (Date.now() >= deadline) throw new Error("fixture_tool_timeout");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    connection.notify("session/cancel", { sessionId: created.sessionId });
    const result = await prompt;
    const outcome = classifyAcpTurn({
      stopReason: result.stopReason,
      isPi: true,
      adapterVersion: "0.0.33",
      observation: createAcpTurnObservation(),
    });
    await connection.close();
    return { outcome, childExit: connection.childExit() };
  } finally {
    await connection.close();
  }
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((root) => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe("real pi-acp child and Harnss classifier", () => {
  it("classifies normal output as completed", async () => {
    await expect(runScenario("normal")).resolves.toMatchObject({
      status: "completed",
      stopReason: "end_turn",
    });
  }, 60_000);

  it("classifies retry-only end_turn as failed", async () => {
    await expect(runScenario("retry-only")).resolves.toMatchObject({
      status: "failed",
      error: { code: "pi_retry_exhausted" },
    });
  }, 60_000);

  it("classifies retry followed by output as completed", async () => {
    await expect(runScenario("retry-then-success")).resolves.toMatchObject({
      status: "completed",
      stopReason: "end_turn",
    });
  }, 60_000);

  it("classifies real adapter cancellation and stops the child", async () => {
    await expect(runCancelScenario()).resolves.toMatchObject({
      outcome: { status: "cancelled", stopReason: "cancelled" },
      childExit: { code: 0 },
    });
  }, 60_000);
});
