import { log } from "./logger";
import { reportError } from "./error-utils";
import {
  acpSessions,
  getAcpModelFromConfigOptions,
  getAcpSessionOperationCoordinator,
} from "../ipc/acp-sessions";
import { classifyAcpTurn, createAcpTurnObservation } from "@shared/lib/acp-turn";
import type { ACPConfigOption } from "@shared/types/acp";
import { capturePiAcpTurnSnapshot, readPiAcpTurnUsage } from "./pi-acp-turn-usage";
import {
  mergeUtilityRequestUsage,
  utilityRequestUsageFromAcp,
  type AcpPromptUsage,
  type UtilityRequestUsage,
} from "./upstream-request-tracker";

export interface AcpUtilityPromptResult {
  text: string;
  usage?: UtilityRequestUsage;
}

/**
 * Send a one-shot prompt through an existing ACP session's connection.
 * Creates an ephemeral utility session on the same agent process, sends the prompt,
 * accumulates text from agent_message_chunk events, and returns the result.
 * Permissions are auto-denied since utility sessions are text-only.
 */
export async function acpUtilityPrompt(
  internalId: string,
  prompt: string,
  timeoutMs = 15000,
  options?: { waitForFirstUserPrompt?: boolean },
): Promise<AcpUtilityPromptResult> {
  const entry = acpSessions.get(internalId);
  if (!entry) {
    throw new Error("ACP session not found");
  }

  return getAcpSessionOperationCoordinator(entry).runUtilityPrompt(async () => {
    const conn = entry.connection as unknown as {
      newSession: (params: { cwd: string; mcpServers: [] }) => Promise<{
        sessionId: string;
        configOptions?: ACPConfigOption[] | null;
      }>;
      prompt: (params: { sessionId: string; prompt: Array<{ type: string; text: string }> }) => Promise<{
        stopReason: string;
        usage?: AcpPromptUsage | null;
      }>;
      cancel: (params: { sessionId: string }) => Promise<unknown>;
    };

    // Create ephemeral utility session on the same connection (no extra process spawn)
    const utilitySession = await conn.newSession({ cwd: entry.cwd, mcpServers: [] });
    const utilitySessionId = utilitySession.sessionId;
    const utilityModel = getAcpModelFromConfigOptions(utilitySession.configOptions ?? undefined);
    log("ACP_UTILITY", `Created utility session ${utilitySessionId.slice(0, 12)} on connection ${internalId.slice(0, 8)}`);

    // Register so sessionUpdate callback knows to accumulate text, not forward to renderer
    if (!entry.utilitySessionIds) entry.utilitySessionIds = new Set();
    entry.utilitySessionIds.add(utilitySessionId);

    if (!entry.utilityTextBuffers) entry.utilityTextBuffers = new Map();
    entry.utilityTextBuffers.set(utilitySessionId, "");
    if (!entry.utilityObservations) entry.utilityObservations = new Map();
    entry.utilityObservations.set(utilitySessionId, createAcpTurnObservation());
    const piUsageSnapshot = entry.isOfficialPi
      ? await capturePiAcpTurnSnapshot(utilitySessionId)
      : undefined;

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      conn.cancel({ sessionId: utilitySessionId }).catch(() => {});
    }, timeoutMs);

    try {
      const response = await conn.prompt({
        sessionId: utilitySessionId,
        prompt: [{ type: "text", text: prompt }],
      });

      clearTimeout(timeoutHandle);

      if (timedOut) {
        throw new Error("ACP utility prompt timed out");
      }

      const outcome = classifyAcpTurn({
        stopReason: response.stopReason,
        isPi: entry.isOfficialPi,
        adapterVersion: entry.adapterVersion,
        observation: entry.utilityObservations.get(utilitySessionId),
        stderrError: entry.lastStderrError,
      });
      if (outcome.status !== "completed") {
        const error = new Error(
          outcome.status === "failed"
            ? outcome.error?.message ?? "ACP utility prompt failed"
            : "ACP utility prompt was cancelled",
        );
        Object.assign(error, {
          code: outcome.status === "failed" ? outcome.error?.code : "acp_utility_cancelled",
        });
        throw error;
      }

      const result = entry.utilityTextBuffers.get(utilitySessionId) ?? "";
      const usage = mergeUtilityRequestUsage(
        utilityRequestUsageFromAcp(response.usage, utilityModel),
        piUsageSnapshot ? await readPiAcpTurnUsage(piUsageSnapshot) : undefined,
      );
      log("ACP_UTILITY", `Utility session ${utilitySessionId.slice(0, 12)} result len=${result.length}`);
      return { text: result, ...(usage ? { usage } : {}) };
    } catch (err) {
      clearTimeout(timeoutHandle);
      reportError("ACP_UTILITY_ERR", err, { internalId });
      throw err;
    } finally {
      entry.utilitySessionIds?.delete(utilitySessionId);
      entry.utilityTextBuffers?.delete(utilitySessionId);
      entry.utilityObservations?.delete(utilitySessionId);
    }
  }, options?.waitForFirstUserPrompt === true);
}
