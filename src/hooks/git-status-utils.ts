import type { GitBranch, GitLogEntry, GitRepoInfo, GitStatus } from "@/types";

export interface DiffStat {
  additions: number;
  deletions: number;
}

export interface RepoState {
  repo: GitRepoInfo;
  status: GitStatus | null;
  branches: GitBranch[];
  log: GitLogEntry[];
  diffStat: DiffStat;
}

type GitResult<T> = T | { error: string } | null | undefined;

export interface RepoRefreshSnapshot {
  statusResult?: GitResult<GitStatus>;
  branchesResult?: GitResult<GitBranch[]>;
  logResult?: GitResult<GitLogEntry[]>;
  diffStatResult?: GitResult<DiffStat>;
}

export interface LightRepoRefreshResult {
  repo: GitRepoInfo;
  statusResult?: GitResult<GitStatus>;
  diffStatResult?: GitResult<DiffStat>;
}

const EMPTY_DIFF_STAT: DiffStat = { additions: 0, deletions: 0 };

function isErrorResult<T>(value: GitResult<T>): value is { error: string } {
  return !!value && typeof value === "object" && "error" in value;
}

export function mergeRepoState(
  previous: RepoState | undefined,
  repo: GitRepoInfo,
  snapshot: RepoRefreshSnapshot,
): RepoState {
  return {
    repo,
    status: snapshot.statusResult && !isErrorResult(snapshot.statusResult)
      ? snapshot.statusResult
      : previous?.status ?? null,
    branches: Array.isArray(snapshot.branchesResult)
      ? snapshot.branchesResult
      : previous?.branches ?? [],
    log: Array.isArray(snapshot.logResult)
      ? snapshot.logResult
      : previous?.log ?? [],
    diffStat: snapshot.diffStatResult && !isErrorResult(snapshot.diffStatResult)
      ? snapshot.diffStatResult
      : previous?.diffStat ?? EMPTY_DIFF_STAT,
  };
}

export function mergeLightRepoRefreshResults(
  previousStates: RepoState[],
  results: LightRepoRefreshResult[],
): RepoState[] {
  const resultByPath = new Map(results.map((result) => [result.repo.path, result]));
  return previousStates.map((state) => {
    const result = resultByPath.get(state.repo.path);
    if (!result) return state;
    return mergeRepoState(state, state.repo, {
      statusResult: result.statusResult,
      diffStatResult: result.diffStatResult,
    });
  });
}
