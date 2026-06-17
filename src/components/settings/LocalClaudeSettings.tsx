import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  FileText,
  FolderOpen,
  Globe,
  Plug,
  RefreshCw,
  Slash,
  Terminal,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type {
  LocalCliConfig,
  LocalAgentInfo,
  LocalCommandInfo,
  LocalMcpServerInfo,
  LocalClaudeMdEntry,
  LocalCodexConfig,
} from "@shared/types/cc-config";

function maskSecret(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.min(8, value.length - 8))}${value.slice(-4)}`;
}

function FilePathChip({ path }: { path: string }) {
  return (
    <button
      onClick={() => window.claude.showItemInFolder(path)}
      title={path}
      className="inline-flex max-w-full items-center gap-1 truncate rounded bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
    >
      <FolderOpen className="h-3 w-3 shrink-0" />
      <span className="truncate">{path}</span>
    </button>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-dashed border-foreground/10 px-3 py-2 text-xs text-muted-foreground">
      {label}
    </p>
  );
}

function AgentCard({ agent }: { agent: LocalAgentInfo }) {
  return (
    <div className="rounded-md border border-foreground/[0.06] bg-foreground/[0.015] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
          {agent.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
          )}
        </div>
        <button
          onClick={() => window.claude.openInEditor(agent.filePath)}
          className="shrink-0 rounded px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          Edit
        </button>
      </div>
      {(agent.model || (agent.tools && agent.tools.length > 0)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {agent.model && (
            <span className="rounded bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {agent.model}
            </span>
          )}
          {agent.tools?.slice(0, 6).map((tool) => (
            <span
              key={tool}
              className="rounded bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {tool}
            </span>
          ))}
          {agent.tools && agent.tools.length > 6 && (
            <span className="text-[10px] text-muted-foreground/70">
              +{agent.tools.length - 6}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CommandCard({ cmd }: { cmd: LocalCommandInfo }) {
  return (
    <div className="rounded-md border border-foreground/[0.06] bg-foreground/[0.015] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            <span className="font-mono text-muted-foreground">/</span>
            {cmd.name}
            {cmd.argumentHint && (
              <span className="ms-1 font-mono text-[11px] font-normal text-muted-foreground">
                {cmd.argumentHint}
              </span>
            )}
          </p>
          {cmd.description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{cmd.description}</p>
          )}
        </div>
        <button
          onClick={() => window.claude.openInEditor(cmd.filePath)}
          className="shrink-0 rounded px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function McpServerCard({ server }: { server: LocalMcpServerInfo }) {
  const display = server.url
    ? server.url
    : server.command
      ? [server.command, ...server.args].join(" ")
      : "(no command)";
  return (
    <div className="rounded-md border border-foreground/[0.06] bg-foreground/[0.015] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-medium text-foreground">{server.name}</p>
        <span className="shrink-0 rounded bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {server.type}
        </span>
      </div>
      <p
        title={display}
        className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
      >
        {display}
      </p>
      {Object.keys(server.env).length > 0 && (
        <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
          env: {Object.keys(server.env).join(", ")}
        </p>
      )}
    </div>
  );
}

function ClaudeMdCard({ entry, label }: { entry: LocalClaudeMdEntry; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = entry.content.split("\n").slice(0, 8).join("\n");
  const hasMore = entry.content.split("\n").length > 8;

  return (
    <div className="rounded-md border border-foreground/[0.06] bg-foreground/[0.015] px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="rounded bg-foreground/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {(entry.fileSize / 1024).toFixed(1)} KB
          </span>
        </div>
        <button
          onClick={() => window.claude.openInEditor(entry.filePath)}
          className="shrink-0 rounded px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        >
          Edit
        </button>
      </div>
      <FilePathChip path={entry.filePath} />
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-foreground/[0.03] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
        {expanded ? entry.content : preview}
      </pre>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

function PriorityBadge({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
      <Check className="h-3 w-3" />
      {label}
    </span>
  );
}

function CodexSection({ codex }: { codex: LocalCodexConfig }) {
  const { t } = useTranslation("settings");
  return (
    <SettingsSection icon={Terminal} label={t("localClaude.codex.section")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <FilePathChip path={codex.configPath} />
        <PriorityBadge active={codex.takesPriorityOverHarnss} label={t("localClaude.codex.priority")} />
      </div>
      {!codex.configExists && (
        <p className="rounded-md border border-dashed border-foreground/10 px-3 py-2 text-xs text-muted-foreground">
          {t("localClaude.codex.empty")}
        </p>
      )}
      {codex.configExists && (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 rounded border border-foreground/[0.05] bg-foreground/[0.015] px-2.5 py-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">model_provider</span>
              <span className="truncate font-mono text-[11px] text-foreground">
                {codex.modelProvider ?? <span className="text-muted-foreground/60">—</span>}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded border border-foreground/[0.05] bg-foreground/[0.015] px-2.5 py-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">model</span>
              <span className="truncate font-mono text-[11px] text-foreground">
                {codex.model ?? <span className="text-muted-foreground/60">—</span>}
              </span>
            </div>
            {codex.customProviders.length > 0 && (
              <div className="flex items-start justify-between gap-3 rounded border border-foreground/[0.05] bg-foreground/[0.015] px-2.5 py-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">custom providers</span>
                <span className="truncate text-end font-mono text-[11px] text-foreground">
                  {codex.customProviders.join(", ")}
                </span>
              </div>
            )}
          </div>
          {codex.preview && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre rounded bg-foreground/[0.03] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
              {codex.preview}
            </pre>
          )}
        </>
      )}
    </SettingsSection>
  );
}

export const LocalClaudeSettings = memo(function LocalClaudeSettings() {
  const { t } = useTranslation("settings");
  const [data, setData] = useState<LocalCliConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.claude.ccConfig.readAll();
      setData(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const config = data?.claude ?? null;
  const codex = data?.codex ?? null;

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("localClaude.title")}
        description={t("localClaude.description")}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          {/* ── Root path + refresh ── */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-foreground/[0.06] bg-foreground/[0.015] px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("localClaude.rootLabel")}
              </p>
              <p className="truncate font-mono text-xs text-foreground">
                {config?.rootDir ?? "—"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={loading}
              className="shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="ms-1.5 text-xs">{t("localClaude.refresh")}</span>
            </Button>
          </div>

          {!config?.exists && !loading && (
            <p className="mt-3 rounded-md border border-dashed border-foreground/10 px-3 py-3 text-xs text-muted-foreground">
              {t("localClaude.notFound")}
            </p>
          )}

          {config?.settingsError && (
            <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t("localClaude.settingsError")}: {config.settingsError}
            </p>
          )}

          {/* ── Gateway env ── */}
          <SettingsSection icon={Globe} label={t("localClaude.gateway.section")} first>
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("localClaude.gateway.description")}
              </p>
              <PriorityBadge
                active={config?.takesPriorityOverHarnss ?? false}
                label={t("localClaude.gateway.priority")}
              />
            </div>
            <div className="space-y-1.5">
              {(["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"] as const).map((key) => {
                const value = config?.gatewayEnv[key] ?? null;
                const isSecret = key.includes("TOKEN") || key.includes("KEY");
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded border border-foreground/[0.05] bg-foreground/[0.015] px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{key}</span>
                    <span className="truncate font-mono text-[11px] text-foreground">
                      {value ? (isSecret ? maskSecret(value) : value) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {config && config.gatewayEnv.allKeys.length > 0 && (
              <p className="mt-2 text-[10.5px] text-muted-foreground/70">
                {t("localClaude.gateway.allKeys")}: {config.gatewayEnv.allKeys.join(", ")}
              </p>
            )}
          </SettingsSection>

          {/* ── Agents ── */}
          <SettingsSection
            icon={Bot}
            label={`${t("localClaude.agents.section")} (${config?.agents.length ?? 0})`}
          >
            {config?.agents.length === 0 ? (
              <EmptyHint label={t("localClaude.agents.empty")} />
            ) : (
              <div className="space-y-1.5">
                {config?.agents.map((agent) => <AgentCard key={agent.filePath} agent={agent} />)}
              </div>
            )}
          </SettingsSection>

          {/* ── Slash commands ── */}
          <SettingsSection
            icon={Slash}
            label={`${t("localClaude.commands.section")} (${config?.commands.length ?? 0})`}
          >
            {config?.commands.length === 0 ? (
              <EmptyHint label={t("localClaude.commands.empty")} />
            ) : (
              <div className="space-y-1.5">
                {config?.commands.map((cmd) => <CommandCard key={cmd.filePath} cmd={cmd} />)}
              </div>
            )}
          </SettingsSection>

          {/* ── MCP servers ── */}
          <SettingsSection
            icon={Plug}
            label={`${t("localClaude.mcp.section")} (${config?.mcpServers.length ?? 0})`}
          >
            {config?.mcpServers.length === 0 ? (
              <EmptyHint label={t("localClaude.mcp.empty")} />
            ) : (
              <div className="space-y-1.5">
                {config?.mcpServers.map((s) => <McpServerCard key={s.name} server={s} />)}
              </div>
            )}
          </SettingsSection>

          {/* ── Codex local config ── */}
          {codex && <CodexSection codex={codex} />}

          {/* ── CLAUDE.md ── */}
          <SettingsSection
            icon={FileText}
            label={`${t("localClaude.claudeMd.section")} (${config?.claudeMdFiles.length ?? 0})`}
          >
            {config?.claudeMdFiles.length === 0 ? (
              <EmptyHint label={t("localClaude.claudeMd.empty")} />
            ) : (
              <div className="space-y-2">
                {config?.claudeMdFiles.map((entry) => (
                  <ClaudeMdCard
                    key={entry.filePath}
                    entry={entry}
                    label={t(`localClaude.claudeMd.scope.${entry.scope}`)}
                  />
                ))}
              </div>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
