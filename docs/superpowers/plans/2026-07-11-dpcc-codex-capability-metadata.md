# DPCC Codex Capability Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve native Codex effort metadata when available and let DPCC `/v1/models` supply exact per-model effort capabilities when isolated `model/list` omits an entitlement-gated model.

**Architecture:** Extend the shared upstream-model response with an optional, validated capability map while preserving the existing ID-only projection. Cache IDs and capabilities together in the DPCC Codex catalog, then enrich only synthesized exact-ID models; exact native `model/list` entries remain authoritative.

**Tech Stack:** TypeScript 5.9, Electron main process, Codex app-server protocol types, Vitest.

---

## File Map

- Modify `shared/types/codex.ts`: define the process-safe capability shape.
- Modify `electron/src/lib/upstream-models.ts`: parse optional DPCC capability fields.
- Modify `electron/src/lib/upstream-models.test.ts`: verify compatibility and validation.
- Modify `electron/src/lib/codex-model-catalog.ts`: cache and forward IDs plus capabilities.
- Modify `shared/lib/codex-helpers.ts`: enrich synthesized exact-ID models only.
- Modify `electron/src/lib/__tests__/codex-upstream.test.ts`: cover merge priority and request behavior.

### Task 1: Parse Optional DPCC Capability Metadata

**Files:**
- Modify: `shared/types/codex.ts`
- Modify: `electron/src/lib/upstream-models.ts`
- Test: `electron/src/lib/upstream-models.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add tests proving ID-only responses remain unchanged and valid optional fields produce a capability map:

```ts
expect(await fetchUpstreamModels(root, token)).toEqual({
  models: ["gpt-5.3-codex-spark"],
  capabilities: {
    "gpt-5.3-codex-spark": {
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
      defaultReasoningEffort: "high",
    },
  },
  error: null,
});
```

Add malformed-input cases where unknown levels are removed, a default outside the supported list is omitted, and the model ID remains visible.

- [ ] **Step 2: Run parser tests and confirm RED**

Run:

```bash
pnpm vitest run --config vitest.config.electron.ts electron/src/lib/upstream-models.test.ts
```

Expected: FAIL because `fetchUpstreamModels()` does not expose capabilities.

- [ ] **Step 3: Add the shared capability type**

In `shared/types/codex.ts`, import the generated effort type and define:

```ts
import type { ReasoningEffort } from "./codex-protocol/ReasoningEffort";

export interface CodexModelCapability {
  supportedReasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}
```

- [ ] **Step 4: Implement strict optional parsing**

In `upstream-models.ts`, accept only generated-protocol effort values and add
`capabilities` only when at least one valid supported effort remains. Keep the
existing `{ models, error }` shape for ID-only and empty responses.

```ts
const REASONING_EFFORTS = new Set([
  "none", "minimal", "low", "medium", "high", "xhigh",
]);
```

Parse snake-case fields `supported_reasoning_efforts` and
`default_reasoning_effort`; retain the default only when included in the valid
supported list.

- [ ] **Step 5: Run parser tests and confirm GREEN**

Run the Task 1 command. Expected: all tests pass.

- [ ] **Step 6: Commit parser support**

```bash
git add shared/types/codex.ts electron/src/lib/upstream-models.ts electron/src/lib/upstream-models.test.ts
git commit -m "feat(codex): parse upstream effort capabilities"
```

### Task 2: Merge DPCC Capabilities Without Overriding Native Metadata

**Files:**
- Modify: `shared/lib/codex-helpers.ts`
- Test: `electron/src/lib/__tests__/codex-upstream.test.ts`

- [ ] **Step 1: Write failing merge tests**

Add tests for these exact cases:

```ts
const capabilities = {
  "gpt-5.3-codex-spark": {
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "high",
  },
};
```

- Upstream-only Spark receives four effort options and defaults to `high`.
- A native Spark entry with a different effort list remains unchanged.
- `gpt-5.3-codex-spark-preview` receives no Spark capability.
- An unsupported requested Spark effort resolves to `high` through
  `resolveCodexReasoningEffort()`.

- [ ] **Step 2: Run merge tests and confirm RED**

```bash
pnpm vitest run --config vitest.config.electron.ts electron/src/lib/__tests__/codex-upstream.test.ts
```

Expected: FAIL because the merge helper accepts only IDs and native metadata.

- [ ] **Step 3: Enrich synthesized models**

Add an optional capability map argument after `preferredModel`:

```ts
export function mergeCodexModelsForUpstream(
  nativeModels: CodexModel[],
  upstreamModelIds: string[],
  preferredModel?: string,
  capabilities: Readonly<Record<string, CodexModelCapability>> = {},
): CodexModel[]
```

Pass only `capabilities[id]` into `createUpstreamCodexModel()` when no exact
native entry exists. Map effort IDs to neutral descriptions; use the advertised
default when valid, otherwise the first supported effort. Preserve `none` and an
empty list when no capability exists.

- [ ] **Step 4: Run merge tests and confirm GREEN**

Run the Task 2 command. Expected: all tests pass.

- [ ] **Step 5: Commit merge behavior**

```bash
git add shared/lib/codex-helpers.ts electron/src/lib/__tests__/codex-upstream.test.ts
git commit -m "feat(codex): merge DPCC effort capabilities"
```

### Task 3: Cache and Propagate Complete DPCC Catalog Entries

**Files:**
- Modify: `electron/src/lib/codex-model-catalog.ts`
- Test: `electron/src/lib/__tests__/codex-upstream.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Mock `fetchUpstreamModels()` with IDs plus a Spark capability map. Assert
`resolveEffectiveCodexModels()` returns Spark with the four levels. Add a second
call assertion proving the existing credential-scoped cache avoids another
network request while retaining capabilities.

- [ ] **Step 2: Run catalog tests and confirm RED**

Run the Task 2 test command. Expected: FAIL because the catalog cache stores only
`modelIds`.

- [ ] **Step 3: Store a complete cached catalog**

Replace the ID-only cache value with:

```ts
interface UpstreamCodexCatalog {
  modelIds: string[];
  capabilities: Record<string, CodexModelCapability>;
}
```

Preserve the current TTL, credential hash, in-flight deduplication, stale
same-credential failure behavior, and source-switch guards. Pass both fields to
`mergeCodexModelsForUpstream()`.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm vitest run --config vitest.config.electron.ts electron/src/lib/upstream-models.test.ts electron/src/lib/__tests__/codex-upstream.test.ts electron/src/ipc/codex-model-ipc.test.ts
pnpm exec tsc --noEmit
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit catalog propagation**

```bash
git add electron/src/lib/codex-model-catalog.ts electron/src/lib/__tests__/codex-upstream.test.ts
git commit -m "feat(codex): propagate DPCC model capabilities"
```

### Task 4: Final Verification

**Files:**
- Verify all files changed by Tasks 1-3.

- [ ] **Step 1: Run full tests**

```bash
pnpm test
```

Expected: all Vitest files pass.

- [ ] **Step 2: Run production build**

```bash
pnpm build
```

Expected: Electron and Vite builds succeed; existing chunk-size warnings are
non-blocking.

- [ ] **Step 3: Run Semgrep and diff checks**

```bash
semgrep scan --metrics=off --config /Users/dpccskisw/Documents/DpccProject/harnss/.semgrep.yml .
git diff --check master...HEAD
git status --short --untracked-files=all
```

Expected: zero findings, no whitespace errors, and a clean worktree.

- [ ] **Step 4: Confirm deployment dependency**

Record that production effort controls require the DPCC service to emit the new
optional fields. Client compatibility alone cannot populate missing metadata.
