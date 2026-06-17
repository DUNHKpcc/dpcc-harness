import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  X,
  Square,
  FileSearch,
  Terminal,
  FileText,
  FileEdit,
  Search,
  FolderSearch,
  Globe,
  Wrench,
  Clock,
  Zap,
  Hash,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PanelHeader } from "@/components/PanelHeader";
import { AgentTranscriptViewer } from "@/components/AgentTranscriptViewer";
import type { BackgroundAgent, BackgroundAgentActivity, BackgroundAgentUsage } from "@/types";

const REMARK_PLUGINS = [remarkGfm];

interface BackgroundAgentsPanelProps {
  agents: BackgroundAgent[];
  expandEditToolCallsByDefault: boolean;
  onDismiss: (agentId: string) => void;
  onStopAgent: (agentId: string, taskId: string) => void;
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: FileText,
  Write: FileEdit,
  Edit: FileEdit,
  Grep: Search,
  Glob: FolderSearch,
  WebSearch: Globe,
  WebFetch: Globe,
};

function getToolIcon(toolName: string) {
  return TOOL_ICONS[toolName] ?? Wrench;
}

export function BackgroundAgentsPanel({
  agents,
  expandEditToolCallsByDefault,
  onDismiss,
  onStopAgent,
}: BackgroundAgentsPanelProps) {
  const { t } = useTranslation("tools");
  const runningCount = agents.filter((a) => a.status === "running" || a.status === "stopping").length;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={Bot}
        label={t("agents.title")}
        iconClass="text-foreground/50"
      >
        {runningCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-foreground/45">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            <span className="tabular-nums">{runningCount}</span>
          </span>
        )}
      </PanelHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-1.5 py-1 space-y-px">
          {agents.map((agent) => (
            <AgentCard
              key={agent.toolUseId}
              agent={agent}
              expandEditToolCallsByDefault={expandEditToolCallsByDefault}
              onDismiss={onDismiss}
              onStopAgent={onStopAgent}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Agent Card ──

function AgentCard({
  agent,
  expandEditToolCallsByDefault,
  onDismiss,
  onStopAgent,
}: {
  agent: BackgroundAgent;
  expandEditToolCallsByDefault: boolean;
  onDismiss: (agentId: string) => void;
  onStopAgent: (agentId: string, taskId: string) => void;
}) {
  const { t } = useTranslation("tools");
  const isRunning = agent.status === "running";
  const isStopping = agent.status === "stopping";
  const isActive = isRunning || isStopping;
  const isCompleted = agent.status === "completed";
  const isError = agent.status === "error";
  const [expanded, setExpanded] = useState(isRunning);
  const [showTranscript, setShowTranscript] = useState(false);

  const handleStop = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (agent.taskId) onStopAgent(agent.agentId, agent.taskId);
    },
    [agent.agentId, agent.taskId, onStopAgent],
  );

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="rounded-md overflow-hidden">
          {/* Header row */}
          <div className="flex items-center gap-0.5 pe-0.5">
            <CollapsibleTrigger asChild>
              <div className="group flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-[11px] transition-colors hover:bg-foreground/[0.03] cursor-pointer rounded-md">
                <ChevronRight
                  className={`h-2.5 w-2.5 shrink-0 text-foreground/30 transition-transform duration-150 ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
                <StatusDot status={agent.status} />
                <span className="truncate text-foreground/75 font-medium">
                  {isStopping && <span className="text-amber-500/60">{t("agents.stopping")}</span>}
                  {agent.description}
                </span>
              </div>
            </CollapsibleTrigger>

            <div className="flex items-center shrink-0">
              {isRunning && agent.taskId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4.5 w-4.5 text-foreground/30 hover:text-red-400/80"
                  onClick={handleStop}
                  title={t("agents.stopAgent")}
                >
                  <Square className="h-2 w-2" />
                </Button>
              )}
              {(isCompleted || isError) && agent.outputFile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4.5 w-4.5 text-foreground/30 hover:text-foreground/60"
                  onClick={(e) => { e.stopPropagation(); setShowTranscript(true); }}
                  title={t("agents.viewTranscript")}
                >
                  <FileSearch className="h-2.5 w-2.5" />
                </Button>
              )}
              {(isCompleted || isError) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4.5 w-4.5 text-foreground/30 hover:text-foreground/60"
                  onClick={(e) => { e.stopPropagation(); onDismiss(agent.agentId); }}
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Progress summary */}
          {isActive && agent.progressSummary && (
            <div className="px-2 ps-7 pb-1 text-[10px] text-foreground/40 italic truncate">
              {agent.progressSummary}
            </div>
          )}

          {/* Current tool inline */}
          {isRunning && agent.currentTool && (
            <CurrentToolBadge name={agent.currentTool.name} elapsed={agent.currentTool.elapsedSeconds} />
          )}

          {/* Collapsed preview */}
          {isRunning && !expanded && !agent.currentTool && agent.activity.length > 0 && (
            <CollapsedPreview activity={agent.activity[agent.activity.length - 1]} />
          )}

          {/* Expanded content */}
          <CollapsibleContent>
            <div className="px-1.5 ps-5 pb-1.5 space-y-1">
              {agent.activity.length > 0 && (
                <ActivityTimeline activities={agent.activity} isRunning={isRunning} />
              )}
              {agent.usage && <UsageBar usage={agent.usage} />}
              {(isCompleted || isError) && agent.result && (
                <AgentResult result={agent.result} isError={isError} />
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {showTranscript && agent.outputFile && (
        <AgentTranscriptViewer
          outputFile={agent.outputFile}
          agentDescription={agent.description}
          expandEditToolCallsByDefault={expandEditToolCallsByDefault}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </>
  );
}

// ── Status dot (minimal) ──

function StatusDot({ status }: { status: BackgroundAgent["status"] }) {
  const colorClass =
    status === "stopping"
      ? "bg-amber-400/70"
      : status === "running"
        ? "bg-blue-400/60 animate-pulse"
        : status === "completed"
          ? "bg-emerald-500/60"
          : "bg-red-400/60";

  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorClass}`} />;
}

// ── Current tool badge ──

function CurrentToolBadge({ name, elapsed }: { name: string; elapsed: number }) {
  const Icon = getToolIcon(name);
  return (
    <div className="mx-1.5 ms-7 mb-1 flex items-center gap-1 rounded bg-foreground/[0.03] px-1.5 py-0.5 text-[10px]">
      <Icon className="h-2.5 w-2.5 shrink-0 text-blue-400/40 animate-pulse" />
      <span className="text-foreground/60 font-medium">{name}</span>
      <span className="text-foreground/30 tabular-nums ms-auto">{Math.round(elapsed)}s</span>
    </div>
  );
}

// ── Collapsed preview ──

function CollapsedPreview({ activity }: { activity: BackgroundAgentActivity }) {
  return (
    <div className="px-2 ps-7 pb-1 text-[10px] text-foreground/35 truncate">
      {activity.toolName && <span className="text-foreground/45 font-medium">{activity.toolName} </span>}
      {activity.summary}
    </div>
  );
}

// ── Activity timeline (auto-scrolling) ──

function ActivityTimeline({ activities, isRunning }: { activities: BackgroundAgentActivity[]; isRunning: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isRunning && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [activities.length, isRunning]);

  return (
    <div className="max-h-44 overflow-y-auto space-y-px scrollbar-none rounded">
      {activities.map((activity, i) => (
        <ActivityItem key={i} activity={activity} isLast={i === activities.length - 1 && isRunning} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ── Activity item ──

function ActivityItem({ activity, isLast }: { activity: BackgroundAgentActivity; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (activity.type === "tool_call") {
    const Icon = getToolIcon(activity.toolName ?? "");
    const hasSummary = activity.summary && activity.summary !== activity.toolName;

    return (
      <div className={`rounded transition-colors ${isLast ? "bg-foreground/[0.02]" : ""}`}>
        <button
          type="button"
          className="flex items-center gap-1 w-full text-start px-1.5 py-0.5 text-[10px] min-w-0 cursor-pointer"
          onClick={() => hasSummary && setExpanded((v) => !v)}
        >
          <Icon className={`h-2.5 w-2.5 shrink-0 ${isLast ? "text-blue-400/40" : "text-foreground/25"}`} />
          <span className={`shrink-0 font-medium ${isLast ? "text-foreground/65" : "text-foreground/45"}`}>
            {activity.toolName}
          </span>
          {!expanded && hasSummary && (
            <span className="truncate text-foreground/30 flex-1">{activity.summary}</span>
          )}
          {hasSummary && (
            expanded
              ? <ChevronDown className="h-2 w-2 shrink-0 text-foreground/20 ms-auto" />
              : <ChevronRight className="h-2 w-2 shrink-0 text-foreground/20 ms-auto" />
          )}
        </button>
        {expanded && hasSummary && (
          <div className="px-1.5 ps-6 pb-1 text-[10px] text-foreground/35 whitespace-pre-wrap wrap-break-word leading-relaxed">
            {activity.summary}
          </div>
        )}
      </div>
    );
  }

  if (activity.type === "error") {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded">
        <AlertCircle className="h-2.5 w-2.5 shrink-0 text-red-400/50" />
        <span className="text-red-500/60 truncate">{activity.summary}</span>
      </div>
    );
  }

  return (
    <div className="px-1.5 py-0.5 text-[10px] text-foreground/35 italic truncate">
      {activity.summary}
    </div>
  );
}

// ── Usage bar ──

function UsageBar({ usage }: { usage: BackgroundAgentUsage }) {
  const tokens =
    usage.totalTokens >= 1000
      ? `${(usage.totalTokens / 1000).toFixed(1)}k`
      : String(usage.totalTokens);
  const duration =
    usage.durationMs >= 60_000
      ? `${(usage.durationMs / 60_000).toFixed(1)}m`
      : `${Math.round(usage.durationMs / 1000)}s`;

  return (
    <div className="flex items-center gap-2.5 text-[9px] text-foreground/30 tabular-nums px-0.5">
      <span className="flex items-center gap-0.5">
        <Zap className="h-2 w-2" />
        {tokens}
      </span>
      <span className="flex items-center gap-0.5">
        <Hash className="h-2 w-2" />
        {usage.toolUses}
      </span>
      <span className="flex items-center gap-0.5">
        <Clock className="h-2 w-2" />
        {duration}
      </span>
    </div>
  );
}

// ── Agent result ──

function AgentResult({ result, isError }: { result: string; isError?: boolean }) {
  const { t } = useTranslation("tools");
  const [resultExpanded, setResultExpanded] = useState(false);
  const isLong = result.length > 200;

  return (
    <div className={`rounded px-2 py-1 ${
      isError ? "bg-red-500/[0.04]" : "bg-foreground/[0.02]"
    }`}>
      <div
        className={`prose dark:prose-invert prose-xs max-w-none text-[10px] text-foreground/65 wrap-break-word
          [&_p]:my-0.5 [&_p]:leading-relaxed
          [&_pre]:my-0.5 [&_pre]:rounded [&_pre]:bg-foreground/[0.04] [&_pre]:px-1.5 [&_pre]:py-1 [&_pre]:text-[9px]
          [&_code]:text-[9px] [&_code]:text-foreground/65
          [&_ul]:my-0.5 [&_ul]:ps-3 [&_ol]:my-0.5 [&_ol]:ps-3
          [&_li]:my-0 [&_li]:text-[10px]
          [&_strong]:text-foreground/80
          [&_h1]:text-[11px] [&_h1]:my-0.5 [&_h2]:text-[11px] [&_h2]:my-0.5 [&_h3]:text-[10px] [&_h3]:my-0.5
          ${!resultExpanded && isLong ? "line-clamp-3" : ""}`}
      >
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{result}</ReactMarkdown>
      </div>
      {isLong && (
        <button
          type="button"
          className="mt-0.5 text-[9px] text-foreground/40 hover:text-foreground/60 transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); setResultExpanded((v) => !v); }}
        >
          {resultExpanded ? t("agents.less") : t("agents.more")}
        </button>
      )}
    </div>
  );
}
