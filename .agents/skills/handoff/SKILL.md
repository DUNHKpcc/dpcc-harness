---
name: handoff
description: Create or read a Codex-led Harnss workflow handoff for session switching, task handoff, conversation transfer, resume notes, continuation notes, or passing a scoped workstream to another Codex-owned worker/subagent. Use when the user asks for handoff, 交接, 会话切换, 任务交接, 接力, 继续前读取交接, or wants the next Codex session/subagent to pick up work.
---

# Handoff

Use this repo-local skill as the standalone entry point for Harnss task/session handoff. It delegates to the shared workflow handoff script and keeps the workflow `codex-led`.

## Rules

- Keep Codex as workflow owner, decision owner, and edit owner.
- Treat handoff as a transfer note, not as a change in implementation ownership.
- Do not stop Serena during handoff unless the user explicitly asks to stop the process.
- Use the existing script instead of recreating handoff files manually.

## Create A Handoff

From the Harnss repository root, run:

```bash
pnpm workflow:handoff -- --to "<recipient>" --summary "<current state>" --next "<next action>"
```

If the user does not specify a recipient, use `next Codex session`. If the task is being passed to a subagent, make the summary and next step include owner, scope, relevant files, risks, and open questions.

Inside Codex, the direct script form is also valid:

```bash
bash scripts/agent-workflow/handoff.sh --to "next Codex session" --summary "Current state" --next "Next action"
```

## Read Or Resume From Handoff

When continuing from a handoff:

1. Read `.harnss/agent-workflow/latest-handoff.md`.
2. Run `pnpm workflow:status` or `bash scripts/agent-workflow/status.sh`.
3. Verify the current git status before editing.
4. Continue with Codex as the orchestrator and edit owner.

## Evidence To Report

Before the final response, run the workflow status board when available:

```bash
pnpm workflow:status
```

Report the latest handoff path and archive path, plus whether Serena was intentionally left running.
