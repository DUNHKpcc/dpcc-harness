/**
 * Single-chat tool workspace state management.
 *
 * Thin wrapper around `useToolIslands` that adds:
 * - per-session tool visibility persistence
 * - global tool placement and size persistence
 * - Chat-absorbs-width fraction strategy (tools keep size, chat shrinks)
 * - Migration from legacy settings
 * - State sanitization on load
 */

import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { ToolId } from "@/types/tools";
import {
  MAX_BOTTOM_TOOLS_HEIGHT,
  MIN_BOTTOM_TOOLS_HEIGHT,
  clampWidthFractions,
  equalWidthFractions,
} from "@/lib/layout/constants";
import {
  buildDefaultMainToolWidthFractions,
  getTopToolAreaWidthPx,
  projectMainToolWidthChange,
  resolveCurrentToolAreaFraction,
  scaleTopRowFractionsToToolArea,
} from "@/lib/workspace/main-tool-widths";
import { isPanelTool, makeToolColumnItemId } from "@/lib/workspace/tool-island-utils";
import { getChatPaneMinWidthPx } from "@/lib/layout/workspace-constraints";
import type {
  PanelToolId,
  ToolColumn,
  ToolIsland,
  ToolIslandDock,
  ToolIslandMemory,
} from "@/types";
import {
  type ToolIslandsState,
  type TopRowChange,
  type UseToolIslandsConfig,
  useToolIslands,
} from "./useToolIslands";

// ── Re-exports ──

export type { PanelToolId } from "@/types";
export type { TopRowItem as MainTopRowItem } from "@/types";

// ── Constants ──

const MAIN_SOURCE_SESSION = "__main__";

// ── Sanitization ──

function sanitizeColumnSplitRatios(splitRatios: number[], islandCount: number): number[] {
  if (islandCount <= 0) return [];
  if (splitRatios.length !== islandCount) return equalWidthFractions(islandCount);
  return clampWidthFractions(splitRatios);
}

function sanitizeTopRowWidthFractions(widthFractions: number[], toolColumnCount: number): number[] {
  if (toolColumnCount <= 0) return [1];
  if (widthFractions.length !== toolColumnCount + 1) return buildDefaultMainToolWidthFractions(toolColumnCount);
  return clampWidthFractions(widthFractions);
}

function stripToolColumnItemId(itemId: string): string {
  return itemId.startsWith("tool-column:") ? itemId.slice(12) : itemId;
}

function sanitizeWorkspaceState(state: ToolIslandsState): ToolIslandsState {
  const seenToolIds = new Set<string>();
  const nextTopRowItemIds: string[] = [];
  const nextTopToolColumnsById: Record<string, ToolColumn> = {};
  const nextToolIslandsById: Record<string, ToolIsland> = {};
  const nextToolMemories: Record<string, ToolIslandMemory> = {};
  for (const [toolId, memory] of Object.entries(state.toolMemories)) {
    if (isPanelTool(toolId)) {
      nextToolMemories[toolId] = memory;
    }
  }

  let topIndex = 0;
  for (const itemId of state.topRowItemIds) {
    const columnId = stripToolColumnItemId(itemId);
    const column = state.topToolColumnsById[columnId];
    if (!column) continue;

    const nextIslandIds: string[] = [];
    for (let stackIndex = 0; stackIndex < column.islandIds.length; stackIndex++) {
      const islandId = column.islandIds[stackIndex]!;
      const island = state.toolIslandsById[islandId];
      if (!island || seenToolIds.has(island.toolId)) continue;
      seenToolIds.add(island.toolId);
      nextToolIslandsById[islandId] = { ...island, dock: "top" };
      nextIslandIds.push(islandId);
      const memory = state.toolMemories[island.toolId];
      nextToolMemories[island.toolId] = {
        ...memory,
        islandId,
        persistKey: memory?.persistKey ?? island.persistKey,
        lastDock: memory?.lastDock ?? "top",
        lastTopIndex: topIndex,
        lastBottomIndex: memory?.lastBottomIndex ?? null,
        lastTopColumnId: columnId,
        lastTopStackIndex: stackIndex,
      };
    }

    if (nextIslandIds.length === 0) continue;
    nextTopRowItemIds.push(makeToolColumnItemId(columnId));
    nextTopToolColumnsById[columnId] = {
      ...column,
      islandIds: nextIslandIds,
      splitRatios: sanitizeColumnSplitRatios(column.splitRatios, nextIslandIds.length),
    };
    topIndex += 1;
  }

  const nextBottomToolIslandIds: string[] = [];
  let bottomIndex = 0;
  for (const islandId of state.bottomToolIslandIds) {
    const island = state.toolIslandsById[islandId];
    if (!island || seenToolIds.has(island.toolId)) continue;
    seenToolIds.add(island.toolId);
    nextToolIslandsById[islandId] = { ...island, dock: "bottom" };
    nextBottomToolIslandIds.push(islandId);
    const memory = state.toolMemories[island.toolId];
    nextToolMemories[island.toolId] = {
      ...memory,
      islandId,
      persistKey: memory?.persistKey ?? island.persistKey,
      lastDock: memory?.lastDock ?? "bottom",
      lastTopIndex: memory?.lastTopIndex ?? null,
      lastBottomIndex: bottomIndex,
      lastTopColumnId: memory?.lastTopColumnId ?? null,
      lastTopStackIndex: memory?.lastTopStackIndex ?? null,
    };
    bottomIndex += 1;
  }

  return {
    topRowItemIds: nextTopRowItemIds,
    topToolColumnsById: nextTopToolColumnsById,
    widthFractions: sanitizeTopRowWidthFractions(state.widthFractions, nextTopRowItemIds.length),
    preferredTopAreaWidthPx: state.preferredTopAreaWidthPx ?? null,
    toolIslandsById: nextToolIslandsById,
    toolMemories: nextToolMemories,
    bottomToolIslandIds: nextBottomToolIslandIds,
    bottomHeight: Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, state.bottomHeight)),
    bottomWidthFractions: nextBottomToolIslandIds.length > 0 && state.bottomWidthFractions.length === nextBottomToolIslandIds.length
      ? clampWidthFractions(state.bottomWidthFractions)
      : equalWidthFractions(nextBottomToolIslandIds.length),
  };
}

// ── Persistence ──

const GLOBAL_TOOL_LAYOUT_STORAGE_KEY = "pcc-agent-main-tool-layout-v1";
const SESSION_TOOL_VISIBILITY_STORAGE_KEY = "pcc-agent-main-tool-session-visibility-v1";
const LEGACY_TOOL_LAYOUT_KEY_PATTERN = /^pcc-agent-.*-main-tool-workspace-v1$/;

interface LegacySerializedState {
  version: 1;
  topRowItemIds: string[];
  topToolColumnsById: Record<string, ToolColumn>;
  widthFractions: number[];
  preferredTopAreaWidthPx?: number | null;
  toolIslandsById: Record<string, { id: string; toolId: PanelToolId; dock: ToolIslandDock; persistKey: string }>;
  toolMemoriesByToolId: Partial<Record<PanelToolId, ToolIslandMemory>>;
  bottomToolIslandIds: string[];
  bottomHeight: number;
  bottomWidthFractions: number[];
}

interface GlobalToolLayoutStorage {
  version: 1;
  preferredTopAreaWidthPx: number | null;
  bottomHeight: number;
  toolMemoriesByToolId: Partial<Record<PanelToolId, ToolIslandMemory>>;
}

interface SessionToolVisibilityStorage {
  version: 1;
  sessions: Record<string, PanelToolId[]>;
}

interface MigrationInput {
  activeToolIds: ReadonlySet<ToolId>;
  toolOrder: ToolId[];
  bottomTools: ReadonlySet<ToolId>;
  bottomHeight: number;
  bottomWidthFractions: number[];
}

interface InitialWorkspacePersistence {
  layout: GlobalToolLayoutStorage;
  defaultOpenToolIds: PanelToolId[];
}

function makeLegacyStorageKey(projectId: string | null): string {
  return `pcc-agent-${projectId ?? "__none__"}-main-tool-workspace-v1`;
}

function makeSessionStorageId(projectId: string | null, sessionId: string | null): string | null {
  if (!sessionId) return null;
  return sessionId === "__draft__" ? `__draft__:${projectId ?? "__none__"}` : sessionId;
}

function isDraftSessionStorageId(sessionStorageId: string | null): boolean {
  return sessionStorageId?.startsWith("__draft__:") ?? false;
}

function toPanelToolId(value: string): PanelToolId | null {
  return isPanelTool(value as ToolId) ? value as PanelToolId : null;
}

function readLegacyWorkspaceState(projectId: string | null): ToolIslandsState | null {
  const raw = localStorage.getItem(makeLegacyStorageKey(projectId));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LegacySerializedState;
      if (
        parsed
        && parsed.version === 1
        && Array.isArray(parsed.topRowItemIds)
        && parsed.topToolColumnsById
        && typeof parsed.topToolColumnsById === "object"
        && Array.isArray(parsed.widthFractions)
        && parsed.toolIslandsById
        && typeof parsed.toolIslandsById === "object"
        && parsed.toolMemoriesByToolId
        && typeof parsed.toolMemoriesByToolId === "object"
        && Array.isArray(parsed.bottomToolIslandIds)
        && Array.isArray(parsed.bottomWidthFractions)
      ) {
        // Convert legacy format: add sourceSessionId to islands, rename memory key
        const toolIslandsById: Record<string, ToolIsland> = {};
        for (const [id, island] of Object.entries(parsed.toolIslandsById)) {
          if (toPanelToolId(island.toolId)) {
            toolIslandsById[id] = { ...island, sourceSessionId: MAIN_SOURCE_SESSION };
          }
        }
        const toolMemories: Record<string, ToolIslandMemory> = {};
        for (const [toolId, memory] of Object.entries(parsed.toolMemoriesByToolId)) {
          const panelToolId = toPanelToolId(toolId);
          if (panelToolId && memory) toolMemories[panelToolId] = memory;
        }
        return sanitizeWorkspaceState({
          topRowItemIds: parsed.topRowItemIds,
          topToolColumnsById: parsed.topToolColumnsById,
          widthFractions: parsed.widthFractions,
          preferredTopAreaWidthPx: parsed.preferredTopAreaWidthPx ?? null,
          toolIslandsById,
          toolMemories,
          bottomToolIslandIds: parsed.bottomToolIslandIds,
          bottomHeight: Number.isFinite(parsed.bottomHeight) ? parsed.bottomHeight : migrationDefaultBottomHeight,
          bottomWidthFractions: parsed.bottomWidthFractions,
        });
      }
    } catch {
      // fall through to migration
    }
  }
  return null;
}

const migrationDefaultBottomHeight = 250;

function migrateFromSettings(migration: MigrationInput): ToolIslandsState {
  const activePanelToolIds: PanelToolId[] = migration.toolOrder.filter(
    (toolId): toolId is PanelToolId => isPanelTool(toolId) && migration.activeToolIds.has(toolId),
  );
  const sideToolIds = activePanelToolIds.filter((toolId) => !migration.bottomTools.has(toolId));
  const bottomToolIds = activePanelToolIds.filter((toolId) => migration.bottomTools.has(toolId));

  const topRowItemIds: string[] = [];
  const topToolColumnsById: Record<string, ToolColumn> = {};
  const toolIslandsById: Record<string, ToolIsland> = {};
  const toolMemories: Record<string, ToolIslandMemory> = {};

  sideToolIds.forEach((toolId, index) => {
    const islandId = `main-tool:${toolId}`;
    const columnId = `main-col:${toolId}`;
    const persistKey = `main-tool:${toolId}`;
    toolIslandsById[islandId] = { id: islandId, toolId, sourceSessionId: MAIN_SOURCE_SESSION, dock: "top", persistKey };
    topToolColumnsById[columnId] = { id: columnId, islandIds: [islandId], splitRatios: [1] };
    topRowItemIds.push(makeToolColumnItemId(columnId));
    toolMemories[toolId] = {
      islandId,
      persistKey,
      lastDock: "top",
      lastTopIndex: index,
      lastBottomIndex: null,
      lastTopColumnId: columnId,
      lastTopStackIndex: 0,
      lastTopStackFraction: 1,
    };
  });

  const bottomToolIslandIds: string[] = [];
  bottomToolIds.forEach((toolId, index) => {
    const islandId = `main-tool:${toolId}`;
    const persistKey = `main-tool:${toolId}`;
    toolIslandsById[islandId] = { id: islandId, toolId, sourceSessionId: MAIN_SOURCE_SESSION, dock: "bottom", persistKey };
    toolMemories[toolId] = {
      islandId,
      persistKey,
      lastDock: "bottom",
      lastTopIndex: toolMemories[toolId]?.lastTopIndex ?? null,
      lastBottomIndex: index,
      lastTopColumnId: toolMemories[toolId]?.lastTopColumnId ?? null,
      lastTopStackIndex: toolMemories[toolId]?.lastTopStackIndex ?? null,
      lastBottomWidthFraction: bottomToolIds.length > 0 ? 1 / bottomToolIds.length : 1,
    };
    bottomToolIslandIds.push(islandId);
  });

  return {
    topRowItemIds,
    topToolColumnsById,
    widthFractions: buildDefaultMainToolWidthFractions(topRowItemIds.length),
    preferredTopAreaWidthPx: null,
    toolIslandsById,
    toolMemories,
    bottomToolIslandIds,
    bottomHeight: migration.bottomHeight,
    bottomWidthFractions: bottomToolIslandIds.length > 0
      ? equalWidthFractions(bottomToolIslandIds.length)
      : migration.bottomWidthFractions,
  };
}

function getOpenToolIds(state: ToolIslandsState): PanelToolId[] {
  const openToolIds: PanelToolId[] = [];
  const seen = new Set<PanelToolId>();
  const appendIsland = (islandId: string) => {
    const island = state.toolIslandsById[islandId];
    if (!island || seen.has(island.toolId)) return;
    seen.add(island.toolId);
    openToolIds.push(island.toolId);
  };

  for (const itemId of state.topRowItemIds) {
    const columnId = stripToolColumnItemId(itemId);
    for (const islandId of state.topToolColumnsById[columnId]?.islandIds ?? []) {
      appendIsland(islandId);
    }
  }
  for (const islandId of state.bottomToolIslandIds) {
    appendIsland(islandId);
  }
  return openToolIds;
}

function captureLayoutMemories(state: ToolIslandsState): Record<string, ToolIslandMemory> {
  const toolMemories = { ...state.toolMemories };

  for (let topIndex = 0; topIndex < state.topRowItemIds.length; topIndex++) {
    const columnId = stripToolColumnItemId(state.topRowItemIds[topIndex]!);
    const column = state.topToolColumnsById[columnId];
    if (!column) continue;
    for (let stackIndex = 0; stackIndex < column.islandIds.length; stackIndex++) {
      const island = state.toolIslandsById[column.islandIds[stackIndex]!];
      if (!island) continue;
      const memory = toolMemories[island.toolId];
      toolMemories[island.toolId] = {
        ...memory,
        islandId: island.id,
        persistKey: `main-tool:${island.toolId}`,
        lastDock: "top",
        lastTopIndex: topIndex,
        lastBottomIndex: memory?.lastBottomIndex ?? null,
        lastTopColumnId: columnId,
        lastTopStackIndex: stackIndex,
        lastWidthFraction: state.widthFractions[topIndex + 1] ?? memory?.lastWidthFraction,
        lastTopStackFraction: column.splitRatios[stackIndex] ?? memory?.lastTopStackFraction,
      };
    }
  }

  for (let bottomIndex = 0; bottomIndex < state.bottomToolIslandIds.length; bottomIndex++) {
    const island = state.toolIslandsById[state.bottomToolIslandIds[bottomIndex]!];
    if (!island) continue;
    const memory = toolMemories[island.toolId];
    toolMemories[island.toolId] = {
      ...memory,
      islandId: island.id,
      persistKey: `main-tool:${island.toolId}`,
      lastDock: "bottom",
      lastTopIndex: memory?.lastTopIndex ?? null,
      lastBottomIndex: bottomIndex,
      lastTopColumnId: memory?.lastTopColumnId ?? null,
      lastTopStackIndex: memory?.lastTopStackIndex ?? null,
      lastBottomWidthFraction: state.bottomWidthFractions[bottomIndex] ?? memory?.lastBottomWidthFraction,
    };
  }

  return toolMemories;
}

function captureGlobalToolLayout(state: ToolIslandsState): GlobalToolLayoutStorage {
  const toolMemoriesByToolId: Partial<Record<PanelToolId, ToolIslandMemory>> = {};
  for (const [toolId, memory] of Object.entries(captureLayoutMemories(state))) {
    const panelToolId = toPanelToolId(toolId);
    if (panelToolId) {
      toolMemoriesByToolId[panelToolId] = memory;
    }
  }
  return {
    version: 1,
    preferredTopAreaWidthPx: state.preferredTopAreaWidthPx ?? null,
    bottomHeight: Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, state.bottomHeight)),
    toolMemoriesByToolId,
  };
}

function readGlobalToolLayout(): GlobalToolLayoutStorage | null {
  const raw = localStorage.getItem(GLOBAL_TOOL_LAYOUT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GlobalToolLayoutStorage;
    if (
      !parsed
      || parsed.version !== 1
      || !parsed.toolMemoriesByToolId
      || typeof parsed.toolMemoriesByToolId !== "object"
    ) {
      return null;
    }
    const toolMemoriesByToolId: Partial<Record<PanelToolId, ToolIslandMemory>> = {};
    for (const [toolId, memory] of Object.entries(parsed.toolMemoriesByToolId)) {
      const panelToolId = toPanelToolId(toolId);
      if (panelToolId && memory && (memory.lastDock === "top" || memory.lastDock === "bottom")) {
        toolMemoriesByToolId[panelToolId] = memory;
      }
    }
    return {
      version: 1,
      preferredTopAreaWidthPx: Number.isFinite(parsed.preferredTopAreaWidthPx)
        ? Math.max(0, parsed.preferredTopAreaWidthPx as number)
        : null,
      bottomHeight: Number.isFinite(parsed.bottomHeight)
        ? Math.max(MIN_BOTTOM_TOOLS_HEIGHT, Math.min(MAX_BOTTOM_TOOLS_HEIGHT, parsed.bottomHeight))
        : migrationDefaultBottomHeight,
      toolMemoriesByToolId,
    };
  } catch {
    return null;
  }
}

function loadInitialWorkspacePersistence(
  projectId: string | null,
  migration: MigrationInput,
): InitialWorkspacePersistence {
  const migrationState = sanitizeWorkspaceState(migrateFromSettings(migration));
  const globalLayout = readGlobalToolLayout();
  if (globalLayout) {
    return { layout: globalLayout, defaultOpenToolIds: getOpenToolIds(migrationState) };
  }

  const legacyState = readLegacyWorkspaceState(projectId) ?? migrationState;
  return {
    layout: captureGlobalToolLayout(legacyState),
    defaultOpenToolIds: getOpenToolIds(legacyState),
  };
}

function readSessionToolVisibility(): SessionToolVisibilityStorage {
  const raw = localStorage.getItem(SESSION_TOOL_VISIBILITY_STORAGE_KEY);
  if (!raw) return { version: 1, sessions: {} };
  try {
    const parsed = JSON.parse(raw) as SessionToolVisibilityStorage;
    if (!parsed || parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") {
      return { version: 1, sessions: {} };
    }
    const sessions: Record<string, PanelToolId[]> = {};
    for (const [sessionId, toolIds] of Object.entries(parsed.sessions)) {
      if (!Array.isArray(toolIds)) continue;
      const seen = new Set<PanelToolId>();
      sessions[sessionId] = toolIds.flatMap((toolId) => {
        const panelToolId = typeof toolId === "string" ? toPanelToolId(toolId) : null;
        if (!panelToolId || seen.has(panelToolId)) return [];
        seen.add(panelToolId);
        return [panelToolId];
      });
    }
    return { version: 1, sessions };
  } catch {
    return { version: 1, sessions: {} };
  }
}

function getStoredSessionToolIds(sessionStorageId: string): PanelToolId[] | null {
  const storage = readSessionToolVisibility();
  return Object.prototype.hasOwnProperty.call(storage.sessions, sessionStorageId)
    ? storage.sessions[sessionStorageId] ?? []
    : null;
}

function sameToolIds(left: PanelToolId[], right: PanelToolId[]): boolean {
  return left.length === right.length && left.every((toolId, index) => toolId === right[index]);
}

function persistSessionToolIds(sessionStorageId: string, toolIds: PanelToolId[]): void {
  const storage = readSessionToolVisibility();
  if (sameToolIds(storage.sessions[sessionStorageId] ?? [], toolIds)
    && Object.prototype.hasOwnProperty.call(storage.sessions, sessionStorageId)) {
    return;
  }
  storage.sessions[sessionStorageId] = toolIds;
  try {
    localStorage.setItem(SESSION_TOOL_VISIBILITY_STORAGE_KEY, JSON.stringify(storage));
  } catch {
    // The UI remains usable when local persistence is unavailable.
  }
}

function removeSessionToolIds(sessionStorageId: string): void {
  const storage = readSessionToolVisibility();
  if (!Object.prototype.hasOwnProperty.call(storage.sessions, sessionStorageId)) return;
  delete storage.sessions[sessionStorageId];
  try {
    localStorage.setItem(SESSION_TOOL_VISIBILITY_STORAGE_KEY, JSON.stringify(storage));
  } catch {
    // The UI remains usable when local persistence is unavailable.
  }
}

function removeLegacyToolLayoutKeys(): void {
  const keysToRemove: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && LEGACY_TOOL_LAYOUT_KEY_PATTERN.test(key)) keysToRemove.push(key);
  }
  for (const key of keysToRemove) localStorage.removeItem(key);
}

function persistGlobalToolLayout(layout: GlobalToolLayoutStorage): void {
  try {
    localStorage.setItem(GLOBAL_TOOL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    removeLegacyToolLayoutKeys();
  } catch {
    // The UI remains usable when local persistence is unavailable.
  }
}

function normalizeRememberedFractions(values: Array<number | undefined>): number[] {
  if (values.length <= 0) return [];
  const validValues = values.filter((value): value is number => Number.isFinite(value) && (value ?? 0) > 0);
  const fallback = validValues.length > 0
    ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length
    : 1;
  return clampWidthFractions(values.map((value) => Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback));
}

interface RememberedToolEntry {
  toolId: PanelToolId;
  memory: ToolIslandMemory;
  fallbackIndex: number;
}

function materializeWorkspaceState(
  layout: GlobalToolLayoutStorage,
  requestedOpenToolIds: PanelToolId[],
): ToolIslandsState {
  const openToolIds: PanelToolId[] = [];
  const seen = new Set<PanelToolId>();
  for (const toolId of requestedOpenToolIds) {
    if (!seen.has(toolId)) {
      seen.add(toolId);
      openToolIds.push(toolId);
    }
  }

  const toolMemories: Record<string, ToolIslandMemory> = {};
  for (const [toolId, memory] of Object.entries(layout.toolMemoriesByToolId)) {
    const panelToolId = toPanelToolId(toolId);
    if (!panelToolId || !memory) continue;
    toolMemories[panelToolId] = {
      ...memory,
      islandId: `main-tool:${panelToolId}`,
      persistKey: `main-tool:${panelToolId}`,
    };
  }

  const entries: RememberedToolEntry[] = openToolIds.map((toolId, fallbackIndex) => {
    const memory = toolMemories[toolId];
    const nextMemory: ToolIslandMemory = {
      ...memory,
      islandId: `main-tool:${toolId}`,
      persistKey: `main-tool:${toolId}`,
      lastDock: memory?.lastDock ?? "top",
      lastTopIndex: memory?.lastTopIndex ?? null,
      lastBottomIndex: memory?.lastBottomIndex ?? null,
      lastTopColumnId: memory?.lastTopColumnId ?? null,
      lastTopStackIndex: memory?.lastTopStackIndex ?? null,
    };
    toolMemories[toolId] = nextMemory;
    return { toolId, memory: nextMemory, fallbackIndex };
  });

  const topGroups = new Map<string, RememberedToolEntry[]>();
  for (const entry of entries) {
    if (entry.memory.lastDock === "bottom") continue;
    const columnId = entry.memory.lastTopColumnId ?? `main-col:${entry.toolId}`;
    const group = topGroups.get(columnId) ?? [];
    group.push(entry);
    topGroups.set(columnId, group);
  }

  const orderedTopGroups = Array.from(topGroups.entries()).sort(([, left], [, right]) => {
    const leftIndex = Math.min(...left.map((entry) => entry.memory.lastTopIndex ?? entry.fallbackIndex));
    const rightIndex = Math.min(...right.map((entry) => entry.memory.lastTopIndex ?? entry.fallbackIndex));
    return leftIndex - rightIndex;
  });

  const topRowItemIds: string[] = [];
  const topToolColumnsById: Record<string, ToolColumn> = {};
  const toolIslandsById: Record<string, ToolIsland> = {};
  const rememberedColumnWidths: Array<number | undefined> = [];

  for (const [columnId, group] of orderedTopGroups) {
    group.sort((left, right) => (
      (left.memory.lastTopStackIndex ?? left.fallbackIndex)
      - (right.memory.lastTopStackIndex ?? right.fallbackIndex)
    ));
    const islandIds = group.map((entry) => {
      const islandId = `main-tool:${entry.toolId}`;
      toolIslandsById[islandId] = {
        id: islandId,
        toolId: entry.toolId,
        sourceSessionId: MAIN_SOURCE_SESSION,
        dock: "top",
        persistKey: `main-tool:${entry.toolId}`,
      };
      return islandId;
    });
    topToolColumnsById[columnId] = {
      id: columnId,
      islandIds,
      splitRatios: normalizeRememberedFractions(group.map((entry) => entry.memory.lastTopStackFraction)),
    };
    topRowItemIds.push(makeToolColumnItemId(columnId));
    rememberedColumnWidths.push(group.find((entry) => entry.memory.lastWidthFraction != null)?.memory.lastWidthFraction);
  }

  const bottomEntries = entries
    .filter((entry) => entry.memory.lastDock === "bottom")
    .sort((left, right) => (
      (left.memory.lastBottomIndex ?? left.fallbackIndex)
      - (right.memory.lastBottomIndex ?? right.fallbackIndex)
    ));
  const bottomToolIslandIds = bottomEntries.map((entry) => {
    const islandId = `main-tool:${entry.toolId}`;
    toolIslandsById[islandId] = {
      id: islandId,
      toolId: entry.toolId,
      sourceSessionId: MAIN_SOURCE_SESSION,
      dock: "bottom",
      persistKey: `main-tool:${entry.toolId}`,
    };
    return islandId;
  });

  const defaultTopWidths = buildDefaultMainToolWidthFractions(topRowItemIds.length);
  const toolAreaFraction = defaultTopWidths.slice(1).reduce((sum, fraction) => sum + fraction, 0);
  const rememberedColumnRatios = normalizeRememberedFractions(rememberedColumnWidths);
  const widthFractions = topRowItemIds.length > 0
    ? clampWidthFractions([
      1 - toolAreaFraction,
      ...rememberedColumnRatios.map((fraction) => fraction * toolAreaFraction),
    ])
    : [1];

  return {
    topRowItemIds,
    topToolColumnsById,
    widthFractions,
    preferredTopAreaWidthPx: layout.preferredTopAreaWidthPx,
    toolIslandsById,
    toolMemories,
    bottomToolIslandIds,
    bottomHeight: layout.bottomHeight,
    bottomWidthFractions: normalizeRememberedFractions(
      bottomEntries.map((entry) => entry.memory.lastBottomWidthFraction),
    ),
  };
}

function persistWorkspaceState(sessionStorageId: string, state: ToolIslandsState): void {
  persistGlobalToolLayout(captureGlobalToolLayout(state));
  persistSessionToolIds(sessionStorageId, getOpenToolIds(state));
}

// ── Config builder ──

function buildConfig(sessionStorageId: string | null, workspaceWidthRef: RefObject<number>): UseToolIslandsConfig {
  return {
    computeTopRowLayout: (change: TopRowChange, current) => {
      return projectMainToolWidthChange({
        preferredTopAreaWidthPx: current.preferredTopAreaWidthPx,
        widthFractions: current.widthFractions,
        workspaceWidth: workspaceWidthRef.current,
        minChatWidth: getChatPaneMinWidthPx("single"),
        change,
      });
    },

    getColumnWidthFraction: (state, topRowIndex) => {
      const toolAreaFraction = resolveCurrentToolAreaFraction(
        state.widthFractions,
        state.preferredTopAreaWidthPx,
        workspaceWidthRef.current,
        getChatPaneMinWidthPx("single"),
      );
      return scaleTopRowFractionsToToolArea(
        state.widthFractions,
        Math.max(0, state.widthFractions.length - 1),
        toolAreaFraction,
      )[topRowIndex + 1];
    },

    makeIslandId: (_toolId, _sessionId, existingId) => existingId ?? `main-tool:${_toolId}`,

    makePersistKey: (toolId) => `main-tool:${toolId}`,

    makeMemoryKey: (_sessionId, toolId) => toolId,

    makeColumnId: (toolId, _islandId, prevColumnId) => prevColumnId ?? `main-col:${toolId}`,

    findDefaultTopInsertIndex: () => 0,

    findExistingIsland: (islands, _sessionId, toolId) =>
      Object.values(islands).find((island) => island.toolId === toolId) ?? null,

    onStateChange: sessionStorageId
      ? (state) => persistWorkspaceState(sessionStorageId, state)
      : undefined,
  };
}

// ── Public interface ──

export interface MainToolWorkspaceState {
  topRowItems: Array<{ kind: "tool-column"; itemId: string; column: ToolColumn; islands: ToolIsland[] }>;
  bottomToolIslands: ToolIsland[];
  widthFractions: number[];
  preferredTopAreaWidthPx: number | null;
  bottomHeight: number;
  bottomWidthFractions: number[];
  setWidthFractions: (fractions: number[]) => void;
  setWidthFractionsDirect: (fractions: number[]) => void;
  setPreferredTopAreaWidthPx: (width: number | null) => void;
  setTopToolColumnSplitRatios: (columnId: string, ratios: number[]) => void;
  setBottomHeight: (height: number) => void;
  setBottomWidthFractions: (fractions: number[]) => void;
  openToolIsland: (toolId: PanelToolId, dock: ToolIslandDock, position?: number) => string | null;
  moveToolIsland: (islandId: string, dock: ToolIslandDock, position?: number) => void;
  openToolIslandInTopColumn: (toolId: PanelToolId, columnId: string, position?: number) => string | null;
  moveToolIslandToTopColumn: (islandId: string, columnId: string, position?: number) => void;
  closeToolIsland: (islandId: string) => void;
  getToolIsland: (toolId: PanelToolId) => ToolIsland | null;
  getRememberedDock: (toolId: PanelToolId) => ToolIslandDock | null;
  getRememberedWidthFraction: (toolId: PanelToolId) => number | null;
}

// ── Picker integration (encapsulates the "find target column" heuristic) ──

/**
 * Toggle a panel tool on or off via the tool picker.
 *
 * If open, closes it. If closed, opens it with smart column placement:
 * - Tools that were last in the bottom dock re-open in the top
 * - Tools that fit as a new column get their own column
 * - Otherwise, stack into the last existing column
 */
export function togglePanelTool(
  workspace: MainToolWorkspaceState,
  toolId: PanelToolId,
  canFitToolAsNewColumn: (toolId: PanelToolId) => boolean,
): void {
  const existing = workspace.getToolIsland(toolId);
  if (existing) {
    workspace.closeToolIsland(existing.id);
    return;
  }
  const rememberedDock = workspace.getRememberedDock(toolId);
  if (rememberedDock === "bottom") {
    workspace.openToolIsland(toolId, "top");
    return;
  }
  if (canFitToolAsNewColumn(toolId) || workspace.topRowItems.length === 0) {
    workspace.openToolIsland(toolId, "top");
    return;
  }
  const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
  if (lastColumnId) {
    workspace.openToolIslandInTopColumn(toolId, lastColumnId);
  } else {
    workspace.openToolIsland(toolId, "top");
  }
}

/**
 * Move a panel tool to the top (side) dock.
 *
 * If already in the top dock, this is a no-op.
 * If in the bottom dock or not open, moves/opens into a new column or stacks.
 */
export function moveToolToSide(
  workspace: MainToolWorkspaceState,
  toolId: PanelToolId,
  canFitToolAsNewColumn: (toolId: PanelToolId) => boolean,
): void {
  const existing = workspace.getToolIsland(toolId);
  if (existing) {
    if (existing.dock === "top") return;
    if (canFitToolAsNewColumn(toolId) || workspace.topRowItems.length === 0) {
      workspace.moveToolIsland(existing.id, "top");
      return;
    }
    const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
    if (lastColumnId) {
      workspace.moveToolIslandToTopColumn(existing.id, lastColumnId);
    }
    return;
  }
  if (canFitToolAsNewColumn(toolId) || workspace.topRowItems.length === 0) {
    workspace.openToolIsland(toolId, "top");
    return;
  }
  const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
  if (lastColumnId) {
    workspace.openToolIslandInTopColumn(toolId, lastColumnId);
  }
}

/**
 * Move a panel tool to the bottom dock.
 */
export function moveToolToBottom(
  workspace: MainToolWorkspaceState,
  toolId: PanelToolId,
): void {
  const existing = workspace.getToolIsland(toolId);
  if (existing) {
    workspace.moveToolIsland(existing.id, "bottom");
  } else {
    workspace.openToolIsland(toolId, "bottom");
  }
}

/**
 * Move a bottom-docked tool to the top row (checking column capacity first).
 */
export function moveBottomToolToTop(
  workspace: MainToolWorkspaceState,
  islandId: string,
  canFitToolAsNewColumn: (toolId: PanelToolId) => boolean,
): void {
  const island = workspace.bottomToolIslands.find((i) => i.id === islandId);
  if ((island && canFitToolAsNewColumn(island.toolId)) || workspace.topRowItems.length === 0) {
    workspace.moveToolIsland(islandId, "top");
    return;
  }
  const lastColumnId = workspace.topRowItems[workspace.topRowItems.length - 1]?.column.id;
  if (lastColumnId) {
    workspace.moveToolIslandToTopColumn(islandId, lastColumnId);
    return;
  }
  workspace.moveToolIsland(islandId, "top");
}

// ── Hook ──

export function useMainToolWorkspace(
  projectId: string | null,
  activeSessionId: string | null,
  migration: MigrationInput,
  workspaceWidthRef: RefObject<number>,
): MainToolWorkspaceState {
  const sessionStorageId = makeSessionStorageId(projectId, activeSessionId);
  const config = useMemo(
    () => buildConfig(sessionStorageId, workspaceWidthRef),
    [sessionStorageId, workspaceWidthRef],
  );

  const toolIslands = useToolIslands(
    config,
    () => {
      const initial = loadInitialWorkspacePersistence(projectId, migration);
      const openToolIds = sessionStorageId
        ? getStoredSessionToolIds(sessionStorageId) ?? initial.defaultOpenToolIds
        : [];
      return materializeWorkspaceState(initial.layout, openToolIds);
    },
  );
  const previousSessionStorageIdRef = useRef(sessionStorageId);

  // Swap only the open-tool set when changing sessions; placement and dimensions
  // are rebuilt from the single global layout record.
  useEffect(() => {
    const initial = loadInitialWorkspacePersistence(projectId, migration);
    const previousSessionStorageId = previousSessionStorageIdRef.current;
    let openToolIds: PanelToolId[] = [];

    if (sessionStorageId) {
      const storedToolIds = getStoredSessionToolIds(sessionStorageId);
      const shouldCarryDraftVisibility = storedToolIds === null
        && isDraftSessionStorageId(previousSessionStorageId)
        && !isDraftSessionStorageId(sessionStorageId);
      openToolIds = shouldCarryDraftVisibility
        ? getOpenToolIds(toolIslands.state)
        : storedToolIds ?? initial.defaultOpenToolIds;

      persistGlobalToolLayout(initial.layout);
      persistSessionToolIds(sessionStorageId, openToolIds);
    }

    if (
      previousSessionStorageId
      && previousSessionStorageId !== sessionStorageId
      && isDraftSessionStorageId(previousSessionStorageId)
    ) {
      removeSessionToolIds(previousSessionStorageId);
    }

    toolIslands.resetState(materializeWorkspaceState(initial.layout, openToolIds), false);
    previousSessionStorageIdRef.current = sessionStorageId;
  }, [projectId, sessionStorageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Adapter: wrap CRUD to match the original API (no sourceSessionId param) ──

  const openToolIsland = useCallback(
    (toolId: PanelToolId, dock: ToolIslandDock, position?: number) =>
      toolIslands.openToolIsland(MAIN_SOURCE_SESSION, toolId, dock, position),
    [toolIslands.openToolIsland],
  );

  const openToolIslandInTopColumn = useCallback(
    (toolId: PanelToolId, columnId: string, position?: number) =>
      toolIslands.openToolIslandInTopColumn(MAIN_SOURCE_SESSION, toolId, columnId, position),
    [toolIslands.openToolIslandInTopColumn],
  );

  const getToolIsland = useCallback(
    (toolId: PanelToolId) => toolIslands.getToolIslandForPane(MAIN_SOURCE_SESSION, toolId),
    [toolIslands.getToolIslandForPane],
  );

  const getRememberedDock = useCallback(
    (toolId: PanelToolId) => toolIslands.getRememberedDock(toolId),
    [toolIslands.getRememberedDock],
  );

  const getRememberedWidthFraction = useCallback(
    (toolId: PanelToolId) => toolIslands.state.toolMemories[toolId]?.lastWidthFraction ?? null,
    [toolIslands.state.toolMemories],
  );

  // Filter topRowItems to only tool-column items (main workspace has no chat items in topRow)
  const topRowItems = useMemo(
    () => toolIslands.topRowItems.filter(
      (item): item is Extract<typeof item, { kind: "tool-column" }> => item.kind === "tool-column",
    ),
    [toolIslands.topRowItems],
  );

  // Validate fractions against current column count
  const widthFractions = toolIslands.state.widthFractions.length === 1 + topRowItems.length
    ? toolIslands.state.widthFractions
    : buildDefaultMainToolWidthFractions(topRowItems.length);

  const bottomWidthFractions = toolIslands.state.bottomWidthFractions.length === toolIslands.bottomToolIslands.length
    ? toolIslands.state.bottomWidthFractions
    : equalWidthFractions(toolIslands.bottomToolIslands.length);

  useEffect(() => {
    if (topRowItems.length <= 0) return;

    const workspaceWidth = workspaceWidthRef.current;
    if (workspaceWidth <= 0) return;

    const nextPreferredTopAreaWidthPx = getTopToolAreaWidthPx(widthFractions, workspaceWidth);
    if (Math.abs((toolIslands.state.preferredTopAreaWidthPx ?? -1) - nextPreferredTopAreaWidthPx) <= 0.5) {
      return;
    }

    toolIslands.setPreferredTopAreaWidthPx(nextPreferredTopAreaWidthPx);
  }, [
    topRowItems.length,
    toolIslands.setPreferredTopAreaWidthPx,
    toolIslands.state.preferredTopAreaWidthPx,
    widthFractions,
    workspaceWidthRef,
  ]);

  return {
    topRowItems,
    bottomToolIslands: toolIslands.bottomToolIslands,
    widthFractions,
    preferredTopAreaWidthPx: toolIslands.state.preferredTopAreaWidthPx,
    bottomHeight: toolIslands.state.bottomHeight,
    bottomWidthFractions,
    setWidthFractions: toolIslands.setWidthFractions,
    setWidthFractionsDirect: toolIslands.setWidthFractionsDirect,
    setPreferredTopAreaWidthPx: toolIslands.setPreferredTopAreaWidthPx,
    setTopToolColumnSplitRatios: toolIslands.setTopToolColumnSplitRatios,
    setBottomHeight: toolIslands.setBottomHeight,
    setBottomWidthFractions: toolIslands.setBottomWidthFractions,
    openToolIsland,
    moveToolIsland: toolIslands.moveToolIsland,
    openToolIslandInTopColumn,
    moveToolIslandToTopColumn: toolIslands.moveToolIslandToTopColumn,
    closeToolIsland: toolIslands.closeToolIsland,
    getToolIsland,
    getRememberedDock,
    getRememberedWidthFraction,
  };
}
