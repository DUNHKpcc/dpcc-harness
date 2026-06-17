import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch as GitBranchIcon,
  RefreshCw,
  Loader2,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/PanelHeader";
import { useGitStatus } from "@/hooks/useGitStatus";
import { RepoSection } from "./RepoSection";
import type { EngineId } from "@/types";

interface GitPanelProps {
  cwd?: string;
  collapsedRepos?: Set<string>;
  onToggleRepoCollapsed?: (path: string) => void;
  activeEngine?: EngineId;
  activeSessionId?: string | null;
  headerControls?: React.ReactNode;
}

export const GitPanel = memo(function GitPanel({
  cwd,
  collapsedRepos,
  onToggleRepoCollapsed,
  activeEngine,
  activeSessionId,
  headerControls,
}: GitPanelProps) {
  const { t } = useTranslation("git");
  const git = useGitStatus({ projectPath: cwd });

  if (!cwd) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader icon={GitBranchIcon} label={t("panel.title")} iconClass="text-orange-600/70 dark:text-orange-200/50">
          {headerControls}
        </PanelHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-1">
          <FolderGit2 className="h-3.5 w-3.5 text-foreground/20" />
          <p className="text-[10px] text-foreground/35">{t("panel.noProjectOpen")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PanelHeader icon={GitBranchIcon} label={t("panel.title")} iconClass="text-orange-600/70 dark:text-orange-200/50">
        {git.isLoading && <Loader2 className="h-3 w-3 animate-spin text-foreground/35" />}
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 text-foreground/40 hover:text-foreground/65"
          onClick={() => git.refreshAll()}
          title={t("panel.refreshAll")}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
        {headerControls}
      </PanelHeader>

      {/* Scrollable list of all repos */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {git.repoStates.length === 0 && git.isLoading && (
          <div className="flex flex-col items-center justify-center gap-1 py-6">
            <Loader2 className="h-3 w-3 animate-spin text-foreground/30" />
            <p className="text-[10px] text-foreground/35">{t("panel.scanning")}</p>
          </div>
        )}

        {git.repoStates.length === 0 && !git.isLoading && (
          <div className="flex flex-col items-center justify-center gap-1 py-6">
            <FolderGit2 className="h-3 w-3 text-foreground/20" />
            <p className="text-[10px] text-foreground/35">{t("panel.noReposFound")}</p>
          </div>
        )}

        {git.repoStates.map((rs, i) => (
          <div key={rs.repo.path}>
            {i > 0 && (
              <div className="mx-2.5 my-0.5">
                <div className="h-px bg-foreground/[0.06]" />
              </div>
            )}
            <RepoSection
              repoState={rs}
              git={git}
              collapsed={collapsedRepos?.has(rs.repo.path) ?? false}
              onToggleCollapsed={onToggleRepoCollapsed ? () => onToggleRepoCollapsed(rs.repo.path) : undefined}
              activeEngine={activeEngine}
              activeSessionId={activeSessionId}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
