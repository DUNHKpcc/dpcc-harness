import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { describe, expect, it, vi } from "vitest";
import { CodexRpcClient } from "@shared/lib/codex-rpc";
import { formatCodexResumeError } from "../codex-resume-error";

describe("CodexRpcClient", () => {
  it("uses the injected process killer on destroy", () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { destroyed: false, write: vi.fn() },
      exitCode: null,
      killed: false,
      kill: vi.fn(),
      pid: 123,
    });
    const child = proc as unknown as ChildProcess;
    const killProcess = vi.fn();

    const client = new CodexRpcClient(child, {
      log: vi.fn(),
      reportError: vi.fn(() => "error"),
      killProcess,
    });

    client.destroy();

    expect(killProcess).toHaveBeenCalledWith(child);
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

describe("formatCodexResumeError", () => {
  it("returns actionable guidance when the local Codex rollout is missing", () => {
    const message = formatCodexResumeError(
      new Error("Codex RPC error [-32600]: no rollout found for thread id 019f3b14-c1c6-7230-9b8f-7d14bed8be01"),
      "019f3b14-c1c6-7230-9b8f-7d14bed8be01",
    );

    expect(message).toContain("Codex local history for this chat is missing");
    expect(message).toContain("019f3b14-c1c6-7230-9b8f-7d14bed8be01");
    expect(message).not.toContain("Codex RPC error");
  });

  it("preserves non-rollout resume errors for diagnostics", () => {
    const message = formatCodexResumeError(new Error("network unavailable"), "thread-123");

    expect(message).toBe("network unavailable");
  });
});
