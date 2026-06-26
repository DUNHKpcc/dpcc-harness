import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { describe, expect, it, vi } from "vitest";
import { CodexRpcClient } from "@shared/lib/codex-rpc";

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
