---
name: release
description: "Compatibility entry for the canonical PccAgent release workflow. Use when releasing, bumping version, tagging, or creating a release. Argument: major, minor, or patch."
---

# PccAgent Release Workflow

The canonical workflow is `.agents/skills/release/SKILL.md`. Read that file in
full and follow it exactly; this compatibility entry must not maintain a second
release policy.

Release invariants:

- Pi is the only built-in live Agent. Do not restore or advertise Claude Code
  or Codex runtime support.
- Validate the exact bundled Pi, `pi-acp`, and `pi-mcp-adapter` pins through
  `scripts/pi-runtime-versions.json` and `pnpm pi:runtime:check`.
- Run the full unit, type, build, documentation, Pi child integration, and
  Electron recovery gates before tagging.
- Do not run local packaging unless the user explicitly requests it. Verify
  macOS, Windows, and Linux artifacts in terminal CI before calling the release
  complete.
