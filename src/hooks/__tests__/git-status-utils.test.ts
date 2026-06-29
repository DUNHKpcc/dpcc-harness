import { describe, expect, it } from "vitest";
import type { GitBranch, GitLogEntry, GitRepoInfo, GitStatus } from "@/types";
import { mergeLightRepoRefreshResults, mergeRepoState } from "../git-status-utils";

const repo: GitRepoInfo = {
  path: "/repo",
  name: "repo",
  isSubRepo: false,
  isWorktree: false,
  isPrimaryWorktree: true,
};

const status: GitStatus = {
  branch: "main",
  ahead: 0,
  behind: 0,
  files: [],
};

const branches: GitBranch[] = [
  { name: "main", isCurrent: true, isRemote: false },
  { name: "feature/perf", isCurrent: false, isRemote: false },
];

const log: GitLogEntry[] = [
  {
    hash: "abc123",
    shortHash: "abc123",
    subject: "Initial commit",
    author: "A",
    date: "2026-06-20",
  },
];

describe("mergeRepoState", () => {
  it("preserves slow git data during a lightweight status refresh", () => {
    const previous = {
      repo,
      status,
      branches,
      log,
      diffStat: { additions: 3, deletions: 1 },
    };

    const next = mergeRepoState(previous, repo, {
      statusResult: { ...status, ahead: 1 },
      diffStatResult: { additions: 5, deletions: 2 },
    });

    expect(next.status?.ahead).toBe(1);
    expect(next.diffStat).toEqual({ additions: 5, deletions: 2 });
    expect(next.branches).toBe(branches);
    expect(next.log).toBe(log);
  });

  it("keeps previous values when git commands return errors", () => {
    const previous = {
      repo,
      status,
      branches,
      log,
      diffStat: { additions: 3, deletions: 1 },
    };

    const next = mergeRepoState(previous, repo, {
      statusResult: { error: "failed" },
      branchesResult: { error: "failed" },
      logResult: { error: "failed" },
      diffStatResult: null,
    });

    expect(next).toEqual(previous);
  });
});

describe("mergeLightRepoRefreshResults", () => {
  it("merges lightweight polling into the latest state without reverting branches or log", () => {
    const latestBranches: GitBranch[] = [
      { name: "main", isCurrent: false, isRemote: false },
      { name: "feature/perf", isCurrent: true, isRemote: false },
    ];
    const latestLog: GitLogEntry[] = [
      {
        hash: "def456",
        shortHash: "def456",
        subject: "Create feature branch",
        author: "A",
        date: "2026-06-20",
      },
    ];
    const latest = {
      repo,
      status: { ...status, branch: "feature/perf" },
      branches: latestBranches,
      log: latestLog,
      diffStat: { additions: 0, deletions: 0 },
    };

    const [next] = mergeLightRepoRefreshResults([latest], [
      {
        repo,
        statusResult: { ...status, branch: "feature/perf", ahead: 2 },
        diffStatResult: { additions: 8, deletions: 3 },
      },
    ]);

    expect(next.status?.ahead).toBe(2);
    expect(next.diffStat).toEqual({ additions: 8, deletions: 3 });
    expect(next.branches).toBe(latestBranches);
    expect(next.log).toBe(latestLog);
  });
});
