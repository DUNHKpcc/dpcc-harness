import type { BackgroundAgent } from "@/types";
import type {
  BackgroundTasksChangedEvent,
  TaskNotificationEvent,
  TaskProgressEvent,
  TaskStartedEvent,
  TaskUpdatedEvent,
  ToolProgressEvent,
} from "@/types";
import { capture } from "@/lib/analytics/analytics";

type Listener = (sessionId: string) => void;

interface AsyncAgentInfo {
  toolUseId: string;
  agentId: string;
  description: string;
  outputFile: string;
}

export interface TaskCompletion {
  taskId: string;
  toolUseId?: string;
  status: "completed" | "failed";
  summary?: string;
  usage?: BackgroundAgent["usage"];
}

/**
 * Shared store for event-driven background agent tracking.
 *
 * Only tracks BACKGROUND (async) agents — foreground agents use the
 * existing parentToolMap/subagentSteps system in useClaude.
 *
 * Registration: eagerly from task_started (pending), confirmed from
 * tool_result with isAsync: true. Foreground agents cleaned up via
 * removePendingAgent when their tool_result arrives without isAsync.
 *
 * Updates: from task_progress events (live metrics + AI summaries),
 * tool_progress events (current tool), and task-notification XML
 * in user messages (completion).
 */
class BackgroundAgentStore {
  private agents = new Map<string, Map<string, BackgroundAgent>>();
  private listeners = new Set<Listener>();
  /** Cached arrays per session — only recreated when agents change */
  private snapshotCache = new Map<string, BackgroundAgent[]>();

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(sessionId: string): void {
    // Invalidate cached snapshot so useSyncExternalStore sees a new reference
    this.snapshotCache.delete(sessionId);
    for (const cb of this.listeners) cb(sessionId);
  }

  /** Returns a referentially stable array (same ref if unchanged). */
  getAgents(sessionId: string): BackgroundAgent[] {
    const cached = this.snapshotCache.get(sessionId);
    if (cached) return cached;
    const map = this.agents.get(sessionId);
    // Filter out pending agents that haven't been confirmed yet
    const arr = map
      ? Array.from(map.values()).filter((a) => !a.isPending)
      : [];
    this.snapshotCache.set(sessionId, arr);
    return arr;
  }

  clearSession(sessionId: string): void {
    if (!this.agents.has(sessionId)) return;
    this.agents.delete(sessionId);
    this.notify(sessionId);
  }

  private findAgent(sessionId: string, taskId: string, toolUseId?: string): BackgroundAgent | undefined {
    const map = this.agents.get(sessionId);
    if (!map) return undefined;
    if (toolUseId) {
      const byToolUseId = map.get(toolUseId);
      if (byToolUseId) return byToolUseId;
    }
    return Array.from(map.values()).find((agent) => agent.taskId === taskId);
  }

  private applyCompletion(sessionId: string, completion: TaskCompletion): void {
    const agent = this.findAgent(sessionId, completion.taskId, completion.toolUseId);
    if (!agent) return;

    agent.status = completion.status === "completed" ? "completed" : "error";
    agent.result = completion.summary;
    agent.currentTool = null;
    if (completion.usage) agent.usage = completion.usage;
    capture("background_agent_completed", {
      status: agent.status,
      duration_ms: completion.usage?.durationMs,
    });
    this.notify(sessionId);
  }

  // ── Phase 4: Early registration from task_started ──

  /**
   * Eagerly register an agent from task_started event.
   * Creates a pending entry that will be confirmed by registerAsyncAgent
   * or removed by removePendingAgent (for foreground agents).
   */
  handleTaskStarted(sessionId: string, event: TaskStartedEvent): void {
    if (!event.tool_use_id) return;
    let map = this.agents.get(sessionId);
    if (!map) {
      map = new Map();
      this.agents.set(sessionId, map);
    }
    // Don't overwrite if already registered (registerAsyncAgent beat us)
    if (map.has(event.tool_use_id)) return;

    map.set(event.tool_use_id, {
      agentId: event.task_id,
      description: event.description,
      prompt: "",
      outputFile: "",
      launchedAt: Date.now(),
      status: "running",
      activity: [],
      toolUseId: event.tool_use_id,
      taskId: event.task_id,
      isPending: true,
    });
    // Notify so pending→confirmed transition is visible immediately
    this.notify(sessionId);
  }

  /**
   * Register a background agent from tool_result with isAsync: true.
   * If an entry already exists from handleTaskStarted, confirms it
   * by filling in details and clearing isPending.
   */
  registerAsyncAgent(sessionId: string, info: AsyncAgentInfo): void {
    let map = this.agents.get(sessionId);
    if (!map) {
      map = new Map();
      this.agents.set(sessionId, map);
    }

    const existing = map.get(info.toolUseId);
    if (existing) {
      // Confirm the pending entry from task_started
      existing.agentId = info.agentId;
      existing.description = info.description;
      existing.outputFile = info.outputFile;
      existing.taskId = info.agentId;
      existing.isPending = false;
    } else {
      map.set(info.toolUseId, {
        agentId: info.agentId,
        description: info.description,
        prompt: "",
        outputFile: info.outputFile,
        launchedAt: Date.now(),
        status: "running",
        activity: [],
        toolUseId: info.toolUseId,
        taskId: info.agentId,
      });
    }
    capture("background_agent_created");
    this.notify(sessionId);
  }

  /**
   * Remove a pending agent that turned out to be foreground (not async).
   * Called when tool_result arrives for Task/Agent without isAsync flag.
   */
  removePendingAgent(sessionId: string, toolUseId: string): void {
    const map = this.agents.get(sessionId);
    if (!map) return;
    const agent = map.get(toolUseId);
    if (agent?.isPending) {
      map.delete(toolUseId);
      this.notify(sessionId);
    }
  }

  // ── Phase 1: Progress summaries ──

  handleTaskProgress(sessionId: string, event: TaskProgressEvent): void {
    const agent = this.findAgent(sessionId, event.task_id, event.tool_use_id);
    // Only update agents we've registered (i.e. background agents)
    if (!agent) return;

    agent.usage = {
      totalTokens: event.usage.total_tokens,
      toolUses: event.usage.tool_uses,
      durationMs: event.usage.duration_ms,
    };

    // Capture AI-generated progress summary
    if (event.summary) {
      agent.progressSummary = event.summary;
    }

    if (event.last_tool_name) {
      agent.activity.push({
        type: "tool_call",
        toolName: event.last_tool_name,
        summary: event.description,
        timestamp: Date.now(),
      });
    }

    this.notify(sessionId);
  }

  // ── Phase 3: Tool progress routing ──

  handleToolProgress(sessionId: string, event: ToolProgressEvent): void {
    if (!event.task_id) return;
    const map = this.agents.get(sessionId);
    if (!map) return;
    for (const agent of map.values()) {
      if (agent.taskId === event.task_id) {
        agent.currentTool = {
          name: event.tool_name,
          elapsedSeconds: event.elapsed_time_seconds,
        };
        this.notify(sessionId);
        return;
      }
    }
  }

  handleTaskNotification(sessionId: string, event: TaskNotificationEvent): TaskCompletion {
    const completion: TaskCompletion = {
      taskId: event.task_id,
      toolUseId: event.tool_use_id,
      status: event.status === "completed" ? "completed" : "failed",
      summary: event.summary || undefined,
      usage: event.usage && {
        totalTokens: event.usage.total_tokens,
        toolUses: event.usage.tool_uses,
        durationMs: event.usage.duration_ms,
      },
    };
    const agent = this.findAgent(sessionId, event.task_id, event.tool_use_id);
    if (agent) agent.outputFile = event.output_file;
    this.applyCompletion(sessionId, completion);
    return completion;
  }

  handleTaskUpdated(sessionId: string, event: TaskUpdatedEvent): TaskCompletion | undefined {
    const status = event.patch.status;
    const agent = this.findAgent(sessionId, event.task_id);
    if (agent && event.patch.description) {
      agent.description = event.patch.description;
      this.notify(sessionId);
    }
    if (status !== "completed" && status !== "failed" && status !== "killed") return undefined;

    const completion: TaskCompletion = {
      taskId: event.task_id,
      status: status === "completed" ? "completed" : "failed",
      summary: event.patch.error,
    };
    this.applyCompletion(sessionId, completion);
    return completion;
  }

  /**
   * Reconcile against the SDK's authoritative membership signal. This prevents a
   * dropped completion edge from leaving an agent permanently marked as running.
   */
  reconcileBackgroundTasks(
    sessionId: string,
    event: BackgroundTasksChangedEvent,
  ): TaskCompletion[] {
    let map = this.agents.get(sessionId);
    if (!map) {
      map = new Map();
      this.agents.set(sessionId, map);
    }

    const activeTaskIds = new Set(event.tasks.map((task) => task.task_id));
    let changed = false;
    for (const task of event.tasks) {
      const agent = this.findAgent(sessionId, task.task_id);
      if (agent) {
        if (agent.isPending || agent.description !== task.description) {
          agent.isPending = false;
          agent.description = task.description;
          changed = true;
        }
        continue;
      }
      const key = `task:${task.task_id}`;
      map.set(key, {
        agentId: task.task_id,
        description: task.description,
        prompt: "",
        outputFile: "",
        launchedAt: Date.now(),
        status: "running",
        activity: [],
        toolUseId: key,
        taskId: task.task_id,
      });
      changed = true;
    }

    const completed: TaskCompletion[] = [];
    for (const agent of map.values()) {
      if (!agent.taskId || agent.isPending || activeTaskIds.has(agent.taskId)) continue;
      if (agent.status !== "running" && agent.status !== "stopping") continue;
      agent.status = "completed";
      agent.currentTool = null;
      completed.push({ taskId: agent.taskId, toolUseId: agent.toolUseId, status: "completed" });
      changed = true;
    }
    if (changed) this.notify(sessionId);
    return completed;
  }

  /**
   * Parse task completion from user text messages containing <task-notification> XML.
   * The SDK delivers task completion as a user text message, NOT as a system event.
   */
  handleUserMessage(sessionId: string, content: string): TaskCompletion | undefined {
    if (!content.includes("<task-notification>")) return undefined;

    const taskId = extractXmlTag(content, "task-id");
    const toolUseId = extractXmlTag(content, "tool-use-id") ?? undefined;
    if (!taskId && !toolUseId) return undefined;
    const status = extractXmlTag(content, "status");
    const tokens = extractXmlTag(content, "total_tokens");
    const tools = extractXmlTag(content, "tool_uses");
    const duration = extractXmlTag(content, "duration_ms");
    const completion: TaskCompletion = {
      taskId: taskId ?? toolUseId!,
      toolUseId,
      status: status === "completed" ? "completed" : "failed",
      summary: extractXmlTag(content, "summary") || undefined,
      ...(tokens ? { usage: {
        totalTokens: parseInt(tokens, 10) || 0,
        toolUses: parseInt(tools ?? "0", 10) || 0,
        durationMs: parseInt(duration ?? "0", 10) || 0,
      } } : {}),
    };
    this.applyCompletion(sessionId, completion);
    return completion;
  }

  // ── Phase 2: Stop agent ──

  /** Optimistically mark an agent as stopping before the IPC completes. */
  setAgentStopping(sessionId: string, agentId: string): void {
    const map = this.agents.get(sessionId);
    if (!map) return;
    for (const agent of map.values()) {
      if (agent.agentId === agentId && agent.status === "running") {
        agent.status = "stopping";
        this.notify(sessionId);
        return;
      }
    }
  }

  dismissAgent(sessionId: string, agentId: string): void {
    const map = this.agents.get(sessionId);
    if (!map) return;
    for (const [key, agent] of map) {
      if (agent.agentId === agentId) {
        map.delete(key);
        break;
      }
    }
    this.notify(sessionId);
  }
}

/** Extract text content of an XML-like tag from a string. */
function extractXmlTag(text: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${escapedTag}>([\\s\\S]*?)</${escapedTag}>`);
  const match = re.exec(text);
  return match ? match[1].trim() : null;
}

export const bgAgentStore = new BackgroundAgentStore();
