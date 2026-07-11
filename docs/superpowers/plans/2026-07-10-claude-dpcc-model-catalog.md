# Claude DPCC Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DPCC `/v1/models` authoritative for Claude composer visibility while retaining SDK metadata and safe fallback behavior.

**Architecture:** Add a Claude-specific main-process catalog resolver parallel to the Codex resolver. Persist raw SDK metadata, resolve it against the current DPCC catalog at IPC boundaries, and leave renderer model mapping and session restart behavior unchanged.

**Tech Stack:** Electron main process, TypeScript, Vitest, Claude Agent SDK, OpenAI-compatible `/v1/models`.

---

### Task 1: Claude Catalog Resolver

**Files:**
- Create: `electron/src/lib/claude-model-catalog.ts`
- Create: `electron/src/lib/__tests__/claude-model-catalog.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Cover these concrete cases with mocked `resolveClaudeUpstream` and
`fetchUpstreamModels`:

```ts
it("uses DPCC ids as the visible set and supplements alias metadata", async () => {
  mockResolveClaudeUpstream.mockReturnValue({
    tier: "default",
    baseUrl: "https://api.dpcc.example",
    token: "sk-claude",
    model: "claude-sonnet-4-6",
  });
  mockFetchUpstreamModels.mockResolvedValue({
    models: ["claude-sonnet-4-6", "claude-dpcc-only"],
    error: null,
  });

  const result = await resolveEffectiveClaudeModels([
    {
      value: "sonnet",
      displayName: "Sonnet",
      description: "Sonnet 4.6",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
    },
    { value: "opus", displayName: "Opus", description: "Opus 4.6" },
  ]);

  expect(result.map((model) => model.value)).toEqual([
    "claude-sonnet-4-6",
    "claude-dpcc-only",
  ]);
  expect(result[0]).toMatchObject({
    displayName: "Sonnet",
    supportedEffortLevels: ["low", "medium", "high"],
  });
  expect(result[1]).toEqual({
    value: "claude-dpcc-only",
    displayName: "claude-dpcc-only",
    description: "",
  });
});
```

Also test exact-ID metadata, deduplication, local/gateway passthrough, failure
fallback, successful empty response, stale result reuse, and cache isolation by
base URL/token.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run --config vitest.config.electron.ts electron/src/lib/__tests__/claude-model-catalog.test.ts
```

Expected: FAIL because `claude-model-catalog.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Create a 60-second, credential-fingerprinted upstream ID cache mirroring the
Codex catalog's failure semantics. Add Claude-specific metadata matching:

```ts
export async function resolveEffectiveClaudeModels(
  sdkModels: CachedModelInfo[],
): Promise<CachedModelInfo[]> {
  const upstream = resolveClaudeUpstream();
  if (upstream.tier !== "default") return sdkModels;

  const modelIds = await loadDpccModelIds(upstream.baseUrl, upstream.token);
  if (!modelIds) return sdkModels;
  return mergeClaudeModelsForUpstream(sdkModels, modelIds);
}
```

The merge must preserve DPCC order, remove duplicate/blank IDs, prefer exact SDK
values, then match Claude family/context variants, and synthesize only label and
description when metadata is unavailable.

- [ ] **Step 4: Verify GREEN**

Run the focused command from Step 2. Expected: all Claude catalog tests pass.

### Task 2: Claude IPC Integration

**Files:**
- Modify: `electron/src/ipc/claude-sessions.ts`
- Test: `electron/src/lib/__tests__/claude-model-catalog.test.ts`

- [ ] **Step 1: Add a failing raw-cache preservation test**

Add a test proving effective resolution does not mutate the SDK input and that
switching the mocked source from DPCC default to local returns the original SDK
catalog.

- [ ] **Step 2: Verify RED**

Temporarily assert the intended local-after-default behavior against the missing
resolver and run the focused catalog test. Expected: FAIL before implementation
or before the input-preservation guarantee is met.

- [ ] **Step 3: Apply effective resolution at IPC boundaries**

Import `resolveEffectiveClaudeModels` and update the three paths:

```ts
const sdkModels = await queryHandle.supportedModels();
if (Array.isArray(sdkModels) && sdkModels.length > 0) {
  setClaudeModelsCache(sdkModels);
}
return { models: await resolveEffectiveClaudeModels(sdkModels) };
```

For revalidation, persist the raw SDK catalog and return the effective catalog.
For `models-cache:get`, resolve the persisted raw catalog before returning it.
Do not modify `getClaudeSdkModel`, `toSdkModelOverride`, `claudeResolvedModel`,
or `restartSession`.

- [ ] **Step 4: Run focused regression tests**

```bash
pnpm vitest run --config vitest.config.electron.ts electron/src/lib/__tests__/claude-model-catalog.test.ts electron/src/lib/__tests__/claude-gateway-env.test.ts src/lib/__tests__/model-utils.test.ts
```

Expected: all focused tests pass.

### Task 3: Codex Spark Effort Regression

**Files:**
- Modify: `electron/src/lib/__tests__/codex-upstream.test.ts`

- [ ] **Step 1: Add the explicit Spark test**

```ts
it("does not invent effort metadata for an upstream-only Codex Spark model", async () => {
  const { mergeCodexModelsForUpstream, resolveCodexReasoningEffort } =
    await import("@shared/lib/codex-helpers");
  const [spark] = mergeCodexModelsForUpstream(
    [],
    ["gpt-5.3-codex-spark"],
  );

  expect(spark.supportedReasoningEfforts).toEqual([]);
  expect(resolveCodexReasoningEffort(spark, "medium")).toBeUndefined();
});
```

- [ ] **Step 2: Run the Codex focused test**

```bash
pnpm vitest run --config vitest.config.electron.ts electron/src/lib/__tests__/codex-upstream.test.ts
```

Expected: PASS, documenting that the gap is upstream/native metadata rather
than a renderer or protocol failure.

### Task 4: Verification And Review

**Files:**
- Review all changed files.

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: 0 failed test files and 0 failed tests.

- [ ] **Step 2: Run the production build**

```bash
pnpm build
```

Expected: exit code 0 with Electron and renderer bundles produced.

- [ ] **Step 3: Run workflow review**

```bash
bash scripts/agent-workflow/review.sh
```

If the worktree does not contain the local workflow scripts, run the original
repository script against this branch's changed files and report that path
explicitly. Expected: tests pass and Semgrep reports no confirmed finding.

- [ ] **Step 4: Run code-review-graph impact analysis**

Call `get_review_context_tool` with `base: "master"`, `detail_level: "standard"`,
`include_source: true`, and `max_depth: 2`. Review every reported impacted path.

- [ ] **Step 5: Inspect final diff**

```bash
git diff --check
git status --short
git diff --stat master...HEAD
```

Expected: no whitespace errors and only the scoped catalog, IPC, tests, spec,
and plan files are changed.
