import { app, ipcMain, type WebContents } from "electron";
import { log } from "../lib/logger";
import { getSDK } from "../lib/sdk";
import { reportError } from "../lib/error-utils";
import { gitExec } from "../lib/git-exec";
import { getClaudeBinaryPath, getClaudeSdkProcessOptions } from "../lib/claude-binary";
import { prepareClaudeSpawnEnv, claudeSettingSources } from "../lib/claude-gateway-env";
import { resolveClaudeModelForRequest } from "../lib/claude-model-catalog";
import { applyClaudeMcpIsolation } from "../lib/claude-mcp-isolation";
import { normalizeSessionCwd } from "../lib/session-cwd";
import { startUtilityRequest } from "../lib/upstream-request-tracker";

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

interface OneShotSdkQueryOptions {
  timeoutMs?: number;
  model?: string;
  extraOptions?: Record<string, unknown>;
}

function startTrackedUtilityRequest(
  sender: WebContents,
  sessionId: string | undefined,
  engine: "claude" | "acp" | "codex",
  purpose: "title" | "commit",
) {
  if (!sessionId || sender.isDestroyed()) return undefined;
  return startUtilityRequest(
    (event) => {
      if (!sender.isDestroyed()) sender.send("usage:upstream-request", event);
    },
    sessionId,
    engine,
    purpose,
  );
}

/** Fire a one-shot SDK query and return the first-line result. */
async function oneShotSdkQuery(
  prompt: string,
  cwd: string,
  logLabel: string,
  options?: OneShotSdkQueryOptions,
): Promise<{ result?: string; error?: string }> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  // The effective upstream (gateway or DPCC default) may serve its own models.
  // Use that configured model so utility queries authenticate and resolve instead
  // of returning "not login" (B5b).
  const model = await resolveClaudeModelForRequest(options?.model ?? "haiku");
  const startedAt = Date.now();
  log(logLabel, `one-shot:start cwd=${cwd} model=${model} prompt_len=${prompt.length} timeout_ms=${timeoutMs}`);

  try {
    const query = await getSDK();
    const cliPath = await getClaudeBinaryPath();
    if (cliPath) {
      log("SDK_CLI_PATH", `${logLabel} path=${cliPath}`);
    } else {
      log("SDK_CLI_PATH", `${logLabel} unresolved; relying on SDK fallback`);
    }
    let eventCount = 0;
    let lastEventType = "none";
    let lastResultSubtype = "none";
    let assistantText = "";
    let lastStderr = "";
    let timedOut = false;
    const sdkProcessOptions = getClaudeSdkProcessOptions(cliPath);
    const spawnEnv = await prepareClaudeSpawnEnv({
      userDataPath: app.getPath("userData"),
      resourcesPath: process.resourcesPath,
    });

    const queryOptions: Record<string, unknown> = {
      ...options?.extraOptions,
      settingSources: claudeSettingSources(),
      cwd,
      model,
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      ...sdkProcessOptions,
      env: {
        ...spawnEnv,
        ...sdkProcessOptions.env,
      },
      stderr: (data: string) => {
        const trimmed = data.trim();
        if (!trimmed) return;
        lastStderr = trimmed;
        log(`${logLabel}_STDERR`, trimmed);
      },
    };
    applyClaudeMcpIsolation(queryOptions);

    const q = query({ prompt, options: queryOptions });

    const timeout = setTimeout(() => {
      timedOut = true;
      log(`${logLabel}_TIMEOUT`, `one-shot timed out after ${timeoutMs}ms`);
      try {
        q.close();
      } catch {
        // ignore cleanup errors
      }
    }, timeoutMs);

    try {
      for await (const msg of q) {
        eventCount += 1;
        const m = msg as Record<string, unknown>;
        if (typeof m.type === "string") {
          lastEventType = m.type;
        }

        if (m.type === "assistant") {
          const message = m.message;
          const content = (
            message &&
            typeof message === "object" &&
            "content" in message &&
            Array.isArray((message as { content?: unknown }).content)
          )
            ? (message as { content: unknown[] }).content
            : [];
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const maybeType = "type" in block ? (block as { type?: unknown }).type : undefined;
            const maybeText = "text" in block ? (block as { text?: unknown }).text : undefined;
            if (maybeType === "text" && typeof maybeText === "string") {
              assistantText += maybeText;
            }
          }
          continue;
        }

        if (m.type === "result") {
          if (typeof m.subtype === "string") {
            lastResultSubtype = m.subtype;
          }
          clearTimeout(timeout);

          const rawResult = typeof m.result === "string" ? m.result : "";
          const chosen = firstNonEmptyLine(rawResult) ?? firstNonEmptyLine(assistantText);
          if (!chosen) {
            const elapsed = Date.now() - startedAt;
            log(
              `${logLabel}_ERR`,
              `empty result subtype=${lastResultSubtype} elapsed_ms=${elapsed} events=${eventCount} last_event=${lastEventType} stderr="${lastStderr || "none"}"`,
            );
            return { error: "empty result" };
          }

          const elapsed = Date.now() - startedAt;
          log(logLabel, `Generated subtype=${lastResultSubtype} elapsed_ms=${elapsed} text="${chosen}"`);
          return { result: chosen };
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = reportError(`${logLabel}_QUERY_ERR`, err, { context: "one-shot-query" });
      const elapsed = Date.now() - startedAt;
      log(
        `${logLabel}_ERR`,
        `${errMsg} elapsed_ms=${elapsed} events=${eventCount} last_event=${lastEventType} stderr="${lastStderr || "none"}"`,
      );
      return { error: errMsg };
    }

    clearTimeout(timeout);
    const elapsed = Date.now() - startedAt;
    if (timedOut) {
      return { error: `Timed out after ${timeoutMs}ms` };
    }
    const fallback = firstNonEmptyLine(assistantText);
    if (fallback) {
      log(logLabel, `Generated fallback elapsed_ms=${elapsed} text="${fallback}"`);
      return { result: fallback };
    }
    log(
      `${logLabel}_ERR`,
      `No result received elapsed_ms=${elapsed} events=${eventCount} last_event=${lastEventType} last_result=${lastResultSubtype} stderr="${lastStderr || "none"}"`,
    );
    return { error: "No result received" };
  } catch (err) {
    const errMsg = reportError(`${logLabel}_SPAWN_ERR`, err, { context: "one-shot-spawn" });
    return { error: errMsg };
  }
}

export function register(): void {
  ipcMain.handle("claude:generate-title", async (event, {
    message,
    cwd,
    engine,
    sessionId,
  }: {
    message: string;
    cwd?: string;
    engine?: "claude" | "acp" | "codex";
    sessionId?: string; // ACP/Codex internalId
  }) => {
    const truncatedMsg = message.length > 500 ? message.slice(0, 500) + "..." : message;
    const prompt = `Generate a very short title (3-7 words) for a chat that starts with this message. Reply with ONLY the title, no quotes, no punctuation at the end.\n\nMessage: ${truncatedMsg}`;

    log("TITLE_GEN", `engine=${engine ?? "claude"} session=${sessionId?.slice(0, 8) ?? "none"} msg="${truncatedMsg.slice(0, 80)}..."`);
    const finishRequest = startTrackedUtilityRequest(
      event.sender,
      sessionId,
      engine ?? "claude",
      "title",
    );
    const finish = (result: { title?: string; error?: string }) => {
      finishRequest?.(!!result.title);
      return result;
    };

    // ACP path: create utility session on existing agent connection
    if (engine === "acp" && sessionId) {
      try {
        const { acpUtilityPrompt } = await import("../lib/acp-utility-prompt");
        const raw = await acpUtilityPrompt(sessionId, prompt);
        const title = raw.split("\n")[0].trim();
        log("TITLE_GEN", `ACP generated: "${title}"`);
        return finish({ title: title || undefined, error: title ? undefined : "empty result" });
      } catch (err) {
        const msg = reportError("TITLE_GEN_ERR", err, { engine: "acp" });
        return finish({ error: msg });
      }
    }

    // Codex path: one-shot utility prompt using codex app-server
    if (engine === "codex") {
      try {
        const { getCodexSessionModel } = await import("./codex-sessions");
        const preferredModel = sessionId ? getCodexSessionModel(sessionId) : undefined;
        const { codexUtilityPrompt } = await import("../lib/codex-utility-prompt");
        const raw = await codexUtilityPrompt(prompt, normalizeSessionCwd(cwd), "TITLE_GEN", {
          timeoutMs: 20000,
          model: preferredModel,
        });
        const title = firstNonEmptyLine(raw) ?? "";
        log("TITLE_GEN", `Codex generated: "${title}"`);
        return finish({ title: title || undefined, error: title ? undefined : "empty result" });
      } catch (err) {
        const msg = reportError("TITLE_GEN_ERR", err, { engine: "codex" });
        return finish({ error: msg });
      }
    }

    // Claude SDK path (default)
    log("TITLE_GEN", `Spawning SDK for: "${truncatedMsg.slice(0, 80)}..." cwd=${cwd}`);
    const { result, error } = await oneShotSdkQuery(prompt, normalizeSessionCwd(cwd), "TITLE_GEN", {
      timeoutMs: 20000,
      model: "haiku",
    });
    return finish({ title: result, error });
  });

  ipcMain.handle("git:generate-commit-message", async (event, {
    cwd,
    engine,
    sessionId,
  }: {
    cwd: string;
    engine?: "claude" | "acp" | "codex";
    sessionId?: string; // ACP/Codex internalId
  }) => {
    let finishRequest: ((success: boolean) => void) | undefined;
    try {
      let diff = "";
      let diffSource: "staged" | "working" | "status" | "none" = "none";
      try {
        diff = (await gitExec(["diff", "--staged"], cwd)).trim();
        if (diff) diffSource = "staged";
      } catch {
        diff = "";
      }
      if (!diff) {
        try {
          diff = (await gitExec(["diff"], cwd)).trim();
          if (diff) diffSource = "working";
        } catch {
          diff = "";
        }
      }
      if (!diff) {
        try {
          diff = (await gitExec(["status", "--short"], cwd)).trim();
          if (diff) diffSource = "status";
        } catch {
          diff = "";
        }
      }
      if (!diff) return { error: "No changes to describe" };

      const maxChars = 500000;
      const truncated = diff.length > maxChars ? diff.slice(0, maxChars) + "\n... (truncated)" : diff;

      const prompt = `Generate a commit message for the following diff. Follow any CLAUDE.md instructions for commit message format and style. Reply with ONLY the commit message, nothing else.\n\n${truncated}`;
      finishRequest = startTrackedUtilityRequest(
        event.sender,
        sessionId,
        engine ?? "claude",
        "commit",
      );
      const finish = (result: { message?: string; error?: string }) => {
        finishRequest?.(!!result.message);
        return result;
      };

      log(
        "COMMIT_MSG_GEN",
        `engine=${engine ?? "claude"} diff_chars=${diff.length} diff_source=${diffSource} cwd=${cwd}`,
      );

      // ACP path: create utility session on existing agent connection
      if (engine === "acp" && sessionId) {
        try {
          const { acpUtilityPrompt } = await import("../lib/acp-utility-prompt");
          const raw = await acpUtilityPrompt(sessionId, prompt);
          const message = firstNonEmptyLine(raw) ?? "";
          log("COMMIT_MSG_GEN", `ACP generated: "${message}"`);
          return finish({ message: message || undefined, error: message ? undefined : "empty result" });
        } catch (err) {
          const msg = reportError("COMMIT_MSG_GEN_ERR", err, { engine: "acp" });
          return finish({ error: msg });
        }
      }

      // Codex path: run a one-shot utility prompt on codex app-server
      if (engine === "codex") {
        try {
          const { getCodexSessionModel } = await import("./codex-sessions");
          const preferredModel = sessionId ? getCodexSessionModel(sessionId) : undefined;
          const { codexUtilityPrompt } = await import("../lib/codex-utility-prompt");
          const raw = await codexUtilityPrompt(prompt, cwd, "COMMIT_MSG_GEN", {
            timeoutMs: 60000,
            model: preferredModel,
          });
          const message = firstNonEmptyLine(raw) ?? "";
          log("COMMIT_MSG_GEN", `Codex generated: "${message}"`);
          return finish({ message: message || undefined, error: message ? undefined : "empty result" });
        } catch (err) {
          const msg = reportError("COMMIT_MSG_GEN_ERR", err, { engine: "codex" });
          return finish({ error: msg });
        }
      }

      // Claude SDK path (default)
      const { result, error } = await oneShotSdkQuery(prompt, cwd, "COMMIT_MSG_GEN", {
        timeoutMs: 60000,
        model: "haiku",
        extraOptions: {
          systemPrompt: { type: "preset", preset: "claude_code" },
        },
      });
      return finish({ message: result, error });
    } catch (err) {
      finishRequest?.(false);
      const errMsg = reportError("COMMIT_MSG_GEN_ERR", err, { context: "spawn" });
      return { error: errMsg };
    }
  });
}
