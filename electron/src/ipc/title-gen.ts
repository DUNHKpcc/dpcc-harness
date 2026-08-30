import { ipcMain, type WebContents } from "electron";
import path from "node:path";
import { log } from "../lib/logger";
import { reportError } from "../lib/error-utils";
import { gitExec } from "../lib/git-exec";
import {
  startUtilityRequest,
  type UtilityRequestUsage,
} from "../lib/upstream-request-tracker";
import type { AcpUtilityPromptResult } from "../lib/acp-utility-prompt";

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function lastNonEmptyLine(text: string): string | undefined {
  const lines = text.split(/\r?\n/g);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function localTitle(message: string): string {
  const normalized = (firstNonEmptyLine(message) ?? "New chat")
    .replace(/\s+/g, " ")
    .replace(/[.!?。！？]+$/g, "")
    .trim();
  if (normalized.length <= 48) return normalized || "New chat";
  return `${normalized.slice(0, 45).trimEnd()}...`;
}

function localCommitMessage(status: string): string {
  const paths = status
    .split(/\r?\n/g)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((filePath) => filePath.includes(" -> ") ? filePath.split(" -> ").at(-1)! : filePath);
  if (paths.length === 1) return `chore: update ${path.basename(paths[0])}`;
  return "chore: update project files";
}

function startTrackedAcpUtilityRequest(
  sender: WebContents,
  sessionId: string | undefined,
  purpose: "title" | "commit",
) {
  if (!sessionId || sender.isDestroyed()) return undefined;
  return startUtilityRequest(
    (event) => {
      if (!sender.isDestroyed()) sender.send("usage:upstream-request", event);
    },
    sessionId,
    "acp",
    purpose,
  );
}

async function runAcpUtility(
  sessionId: string,
  prompt: string,
  timeoutMs: number,
  waitForFirstUserPrompt = false,
): Promise<AcpUtilityPromptResult> {
  const { acpUtilityPrompt } = await import("../lib/acp-utility-prompt");
  return acpUtilityPrompt(sessionId, prompt, timeoutMs, { waitForFirstUserPrompt });
}

export function register(): void {
  ipcMain.handle("session:generate-title", async (event, {
    message,
    engine,
    sessionId,
  }: {
    message: string;
    cwd?: string;
    engine?: "claude" | "acp" | "codex";
    sessionId?: string;
  }) => {
    const truncated = message.length > 500 ? `${message.slice(0, 500)}...` : message;
    const fallback = localTitle(truncated);
    if (engine !== "acp" || !sessionId) {
      log("TITLE_GEN", `Using local fallback for non-runtime session engine=${engine ?? "none"}`);
      return { title: fallback };
    }

    const prompt = `Generate a very short title (3-7 words) for a chat that starts with this message. Reply with only the title.\n\nMessage: ${truncated}`;
    const finishRequest = startTrackedAcpUtilityRequest(event.sender, sessionId, "title");
    let utilityUsage: UtilityRequestUsage | undefined;
    try {
      const result = await runAcpUtility(sessionId, prompt, 15_000, true);
      utilityUsage = result.usage;
      const title = lastNonEmptyLine(result.text);
      if (!title) throw Object.assign(new Error("ACP utility prompt returned an empty title"), { code: "acp_utility_empty" });
      finishRequest?.(true, utilityUsage);
      return { title };
    } catch (error) {
      finishRequest?.(false, utilityUsage);
      reportError("TITLE_GEN_ERR", error, { engine: "acp", fallback: true });
      return { title: fallback };
    }
  });

  ipcMain.handle("git:generate-commit-message", async (event, {
    cwd,
    engine,
    sessionId,
  }: {
    cwd: string;
    engine?: "claude" | "acp" | "codex";
    sessionId?: string;
  }) => {
    try {
      let diff = "";
      let status = "";
      try { diff = (await gitExec(["diff", "--staged"], cwd)).trim(); } catch { /* fallback below */ }
      if (!diff) {
        try { diff = (await gitExec(["diff"], cwd)).trim(); } catch { /* fallback below */ }
      }
      try { status = (await gitExec(["status", "--short"], cwd)).trim(); } catch { /* handled below */ }
      if (!diff && !status) return { error: "No changes to describe" };

      const fallback = localCommitMessage(status);
      if (engine !== "acp" || !sessionId) {
        log("COMMIT_MSG_GEN", `Using local fallback for non-runtime session engine=${engine ?? "none"}`);
        return { message: fallback };
      }

      const truncated = diff.length > 500_000 ? `${diff.slice(0, 500_000)}\n... (truncated)` : diff || status;
      const prompt = `Generate a concise commit message for the following changes. Follow repository instructions and reply with only the commit message.\n\n${truncated}`;
      const finishRequest = startTrackedAcpUtilityRequest(event.sender, sessionId, "commit");
      let utilityUsage: UtilityRequestUsage | undefined;
      try {
        const result = await runAcpUtility(sessionId, prompt, 60_000);
        utilityUsage = result.usage;
        const message = lastNonEmptyLine(result.text);
        if (!message) throw Object.assign(new Error("ACP utility prompt returned an empty commit message"), { code: "acp_utility_empty" });
        finishRequest?.(true, utilityUsage);
        return { message };
      } catch (error) {
        finishRequest?.(false, utilityUsage);
        reportError("COMMIT_MSG_GEN_ERR", error, { engine: "acp", fallback: true });
        return { message: fallback };
      }
    } catch (error) {
      const message = reportError("COMMIT_MSG_GEN_ERR", error, { context: "prepare" });
      return { error: message };
    }
  });
}
