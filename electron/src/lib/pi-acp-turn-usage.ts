import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { UtilityRequestUsage } from "./upstream-request-tracker";

interface PiAcpSessionMapEntry {
  sessionFile?: unknown;
}

interface PiAcpSessionMap {
  sessions?: Record<string, PiAcpSessionMapEntry>;
}

export interface PiAcpTurnSnapshot {
  acpSessionId: string;
  sessionMapPath: string;
  sessionFile?: string;
  offset: number;
  startedAt: number;
  startsAtLineBoundary: boolean;
}

interface PiUsageAccumulator {
  currentModel?: string;
  turnModel?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningOutputTokens: number;
  costUSD: number;
  hasUsage: boolean;
  sawEligibleEntry: boolean;
}

function defaultSessionMapPath(): string {
  return path.join(os.homedir(), ".pi", "pi-acp", "session-map.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function qualifiedModel(provider: unknown, model: unknown): string | undefined {
  const modelId = typeof model === "string" ? model.trim() : "";
  if (!modelId) return undefined;
  if (modelId.includes("/")) return modelId;
  const providerId = typeof provider === "string" ? provider.trim() : "";
  return providerId ? `${providerId}/${modelId}` : modelId;
}

function entryTimestamp(entry: Record<string, unknown>): number | undefined {
  if (typeof entry.timestamp !== "string") return undefined;
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function usageForEntry(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  if (
    entry.type === "message"
    && isRecord(entry.message)
    && entry.message.role === "assistant"
    && isRecord(entry.message.usage)
  ) {
    return entry.message.usage;
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && isRecord(entry.usage)) {
    return entry.usage;
  }
  return undefined;
}

function addUsage(accumulator: PiUsageAccumulator, usage: Record<string, unknown>): void {
  const input = nonNegativeNumber(usage.input);
  const output = nonNegativeNumber(usage.output);
  const cacheRead = nonNegativeNumber(usage.cacheRead);
  const cacheWrite = nonNegativeNumber(usage.cacheWrite);
  const reasoning = nonNegativeNumber(usage.reasoning);
  const cost = isRecord(usage.cost) ? nonNegativeNumber(usage.cost.total) : undefined;

  if (
    input === undefined
    && output === undefined
    && cacheRead === undefined
    && cacheWrite === undefined
    && reasoning === undefined
    && cost === undefined
  ) {
    return;
  }

  accumulator.hasUsage = true;
  accumulator.inputTokens += input ?? 0;
  accumulator.outputTokens += output ?? 0;
  accumulator.cacheReadTokens += cacheRead ?? 0;
  accumulator.cacheCreationTokens += cacheWrite ?? 0;
  accumulator.reasoningOutputTokens += reasoning ?? 0;
  accumulator.costUSD += cost ?? 0;
}

function addEntry(
  accumulator: PiUsageAccumulator,
  entry: Record<string, unknown>,
  minimumTimestamp?: number,
): void {
  const timestamp = entryTimestamp(entry);
  const eligible = minimumTimestamp === undefined
    || (timestamp !== undefined && timestamp >= minimumTimestamp);

  if (entry.type === "model_change") {
    const model = qualifiedModel(entry.provider, entry.modelId);
    if (model) {
      accumulator.currentModel = model;
      if (eligible) accumulator.turnModel = model;
    }
  }

  if (!eligible) return;
  accumulator.sawEligibleEntry = true;

  if (entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant") {
    const model = qualifiedModel(entry.message.provider, entry.message.model)
      ?? accumulator.currentModel;
    if (model) {
      accumulator.currentModel = model;
      accumulator.turnModel = model;
    }
  }

  const usage = usageForEntry(entry);
  if (usage) addUsage(accumulator, usage);
}

function createAccumulator(): PiUsageAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningOutputTokens: 0,
    costUSD: 0,
    hasUsage: false,
    sawEligibleEntry: false,
  };
}

function resultFromAccumulator(accumulator: PiUsageAccumulator): UtilityRequestUsage | undefined {
  if (!accumulator.sawEligibleEntry || (!accumulator.hasUsage && !accumulator.turnModel)) {
    return undefined;
  }

  return {
    ...(accumulator.turnModel ? { model: accumulator.turnModel } : {}),
    ...(accumulator.hasUsage
      ? {
          inputTokens: accumulator.inputTokens,
          outputTokens: accumulator.outputTokens,
          cacheReadTokens: accumulator.cacheReadTokens,
          cacheCreationTokens: accumulator.cacheCreationTokens,
          reasoningOutputTokens: accumulator.reasoningOutputTokens,
          costUSD: accumulator.costUSD,
        }
      : {}),
  };
}

function parseLine(
  accumulator: PiUsageAccumulator,
  line: string,
  minimumTimestamp?: number,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) addEntry(accumulator, parsed, minimumTimestamp);
  } catch {
    // Ignore a partial or malformed JSONL record. Pi writes the next record independently.
  }
}

export function parsePiAcpTurnUsage(
  jsonl: string,
  minimumTimestamp?: number,
): UtilityRequestUsage | undefined {
  const accumulator = createAccumulator();
  for (const line of jsonl.split(/\r?\n/)) {
    parseLine(accumulator, line, minimumTimestamp);
  }
  return resultFromAccumulator(accumulator);
}

async function resolveSessionFile(sessionMapPath: string, acpSessionId: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(sessionMapPath, "utf8")) as PiAcpSessionMap;
    const sessionFile = parsed.sessions?.[acpSessionId]?.sessionFile;
    return typeof sessionFile === "string" && sessionFile.trim()
      ? sessionFile
      : undefined;
  } catch {
    return undefined;
  }
}

async function endsAtLineBoundary(filePath: string, size: number): Promise<boolean> {
  if (size === 0) return true;
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, "r");
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, size - 1);
    return byte[0] === 0x0a || byte[0] === 0x0d;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function capturePiAcpTurnSnapshot(
  acpSessionId: string,
  options?: { sessionMapPath?: string; now?: () => number },
): Promise<PiAcpTurnSnapshot> {
  const sessionMapPath = options?.sessionMapPath ?? defaultSessionMapPath();
  const startedAt = (options?.now ?? Date.now)();
  const sessionFile = await resolveSessionFile(sessionMapPath, acpSessionId);
  if (!sessionFile) {
    return {
      acpSessionId,
      sessionMapPath,
      offset: 0,
      startedAt,
      startsAtLineBoundary: true,
    };
  }

  try {
    const stat = await fs.promises.stat(sessionFile);
    return {
      acpSessionId,
      sessionMapPath,
      sessionFile,
      offset: stat.size,
      startedAt,
      startsAtLineBoundary: await endsAtLineBoundary(sessionFile, stat.size),
    };
  } catch {
    return {
      acpSessionId,
      sessionMapPath,
      sessionFile,
      offset: 0,
      startedAt,
      startsAtLineBoundary: true,
    };
  }
}

export async function readPiAcpTurnUsage(
  snapshot: PiAcpTurnSnapshot,
): Promise<UtilityRequestUsage | undefined> {
  try {
    const resolvedFile = snapshot.sessionFile
      ?? await resolveSessionFile(snapshot.sessionMapPath, snapshot.acpSessionId);
    if (!resolvedFile) return undefined;

    const stat = await fs.promises.stat(resolvedFile);
    const sameFile = resolvedFile === snapshot.sessionFile;
    const canUseOffset = sameFile && stat.size >= snapshot.offset;
    const start = canUseOffset ? snapshot.offset : 0;
    // If the file appeared after the snapshot, was replaced, or could not be
    // stat'ed initially, timestamp filtering prevents older turns from leaking
    // into this request's usage.
    const minimumTimestamp = start === 0 ? snapshot.startedAt : undefined;
    if (stat.size <= start) return undefined;

    const stream = fs.createReadStream(resolvedFile, { encoding: "utf8", start });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const accumulator = createAccumulator();
    let isFirstLine = true;
    for await (const line of lines) {
      if (isFirstLine && start > 0 && !snapshot.startsAtLineBoundary) {
        isFirstLine = false;
        continue;
      }
      isFirstLine = false;
      parseLine(accumulator, line, minimumTimestamp);
    }
    return resultFromAccumulator(accumulator);
  } catch {
    return undefined;
  }
}
