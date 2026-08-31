---
name: harnss-agent-workflow
description: Run the clean-clone, fail-closed, Pi-first Harnss development workflow with pinned Pi source references, deterministic retrieval, evidence, tests, Semgrep, Serena, and code-review-graph.
---

# Harnss Pi-first Agent Workflow

## Purpose

Use this skill for non-trivial Harnss development, review, debugging, or
handoff work. Pi is the only built-in live Agent, so agent-facing investigation
must start from the protected bundled Pi/ACP path rather than from historical
Claude or Codex runtime assumptions.

This is a Codex-led workflow. Codex owns architecture, edits, verification, and
the final report. Serena, code-review-graph, Semgrep, Pi reference queries, and
subagents are supporting tools, not decision owners.

## Source Of Truth

Use Pi information in this order:

1. Current Harnss implementation, tests, contracts, and
   scripts/pi-runtime-versions.json.
2. The exact installed sources for the three shipped runtime packages, pinned
   by version, npm integrity, repository, and commit in
   scripts/agent-workflow/pi-reference.json.
3. Official Pi documentation under https://pi.dev/docs/latest and the pinned
   pi-acp / pi-mcp-adapter repositories.
4. Model inference only when the preceding sources do not answer the question.

The shipped version wins over newer online documentation when behavior differs.
Do not place the 100k+ upstream source lines into the Harnss application graph.
Use the separate read-only Pi reference layer so application impact analysis
stays focused.

Before changing Pi runtime, lifecycle, Skills, MCP, tools, recovery, or error
contracts, query the dedicated routes:

    pnpm workflow:pi-reference -- query "why is this Pi session recovery failing?"
    pnpm workflow:check-pi-reference
    pnpm workflow:verify-pi-upstream
    pnpm workflow:benchmark-pi

workflow:check-pi-reference is offline after pnpm install. It validates:

- @earendil-works/pi-coding-agent 0.84.1
- pi-acp 0.0.33
- pi-mcp-adapter 2.31.0
- package versions, lockfile integrity, declared upstream commit IDs, required package
  source/doc files, Harnss route paths, and benchmark fixtures

The offline check treats commit IDs as declared provenance and uses exact npm
integrity as the installed-source identity. workflow:verify-pi-upstream is the
explicit network check that compares all three commit IDs and integrity values
with npm registry metadata. It is not a required local/PR gate because registry
availability is external to the repository.

workflow:benchmark-pi runs 30 deterministic questions across runtime,
lifecycle, turn/error, Skill/MCP, and quality/recovery categories. Recall@5
must remain at least 90%.

## Clean-clone Bootstrap

The workflow scripts, this skill, .serena/project.yml, and .semgrep.yml are
repository files. A clean clone must not depend on ignored local copies.

    pnpm install --frozen-lockfile
    bash scripts/agent-workflow/doctor.sh
    bash scripts/agent-workflow/start.sh

doctor.sh is fail-closed for required tools, repository files, Bash syntax,
package command targets, and the Pi reference contract. Serena and
code-review-graph are optional semantic accelerators; their absence must be
reported, not fabricated.

## Process Lifecycle

Codex normally uses Serena through a host-configured stdio MCP. Starting the
workflow does not launch a second Serena process.

Only use the HTTP process for explicit local protocol debugging:

    pnpm workflow:start -- --http-debug

The debug process records PID, project root, port, start time, and ownership.
workflow:stop refuses to kill a PID unless that metadata and the live command
both match. Do not stop Serena unless the user explicitly asks.

## Evidence Contract

Every workflow run has a unique run ID. Each review starts a fresh evidence
run and marks it passed or failed. Events record timestamp, event, subject,
exit code, HEAD SHA, dirty-worktree hash, changed-file count, and summary.
Status reports only the current run instead of mixing historical evidence.

    pnpm workflow:hook -- session-start "task scope"
    pnpm workflow:hook -- pre-tool-use <tool> "intent"
    pnpm workflow:hook -- post-tool-use <tool> "actual result"
    pnpm workflow:hook -- post-edit "changed paths and verification"
    pnpm workflow:hook -- pre-compact "state to preserve"
    pnpm workflow:hook -- stop "final checkpoint"

Record only real tool participation. Process availability is not proof that a
Serena or code-review-graph query occurred.

## Search And Review Loop

1. Run workflow:hook -- session-start.
2. Query workflow:pi-reference for Pi-facing work.
3. Use rg for exact text/file discovery.
4. Use Serena for symbol, reference, implementation, and diagnostics lookup
   when its MCP tools are actually loaded.
5. Use code-review-graph for impact analysis after edits and record the actual
   response.
6. Keep changes inside the requested scope and preserve unrelated worktree
   changes.
7. Run fast gates during iteration and full local gates before completion.
8. Run workflow:status and report the current run evidence.

## Fail-closed Gates

    pnpm workflow:review -- --fast
    pnpm workflow:review -- --full

Fast mode runs:

- workflow self-tests
- Pi reference contract and 30-scenario benchmark
- unit tests
- typecheck
- Semgrep
- git diff --check

Full mode additionally runs:

- production build
- documentation and test-map checks
- real bundled pi-acp and Pi child integration
- Electron ACP recovery E2E
- Pi runtime doctor against an isolated repository fixture, so bundled runtime
  reproducibility is required without depending on developer credentials or a
  production provider

No local mode packages the application. --ci adds Playwright, Linux package,
and packaged smoke gates, but it refuses to run outside GitHub Actions on
Linux. A failed or environment-blocked command remains a non-zero result; it
must never be converted into a green review.

## Delegation

Do not use Spark. Delegation requires user authorization and must follow
AGENTS.md. When project_coder_medium is available, use it only for bounded,
low-risk, independently verifiable work. Codex retains architecture, security,
cross-system behavior, and final review.

Before writable delegation, reserve canonical repository paths:

    pnpm workflow:subagent -- assign project-coder \
      --model project_coder_medium \
      --agent-id <actual-agent-id> \
      --owns "src/path,tests/path" \
      --task "concrete bounded task"

Use readonly:path for review. The ledger canonicalizes dot segments and
symlinks, rejects repository escapes and overlapping writable paths, recovers
stale locks, and rejects Spark names/models.

On completion:

    pnpm workflow:hook -- subagent-stop <agent-name> "verified result"

## Handoff

Before compaction, session switching, or pausing unfinished work:

    pnpm workflow:handoff -- \
      --summary "current implementation and evidence" \
      --next "specific next action"

The recipient must inspect the current git diff and current run evidence. Never
treat a historical handoff or aggregated log as current state.

## Command Reference

- pnpm workflow:doctor
- pnpm workflow:start
- pnpm workflow:hook -- <event> ...
- pnpm workflow:pi-reference -- query <question>
- pnpm workflow:sync-pi-reference
- pnpm workflow:check-pi-reference
- pnpm workflow:verify-pi-upstream
- pnpm workflow:benchmark-pi
- pnpm workflow:review -- --fast
- pnpm workflow:review -- --full
- pnpm workflow:subagent -- <command>
- pnpm workflow:handoff -- ...
- pnpm workflow:status
- pnpm workflow:stop

Inside Codex, direct bash scripts/agent-workflow/<command>.sh is acceptable
when the host's bundled package-manager path is ambiguous.
