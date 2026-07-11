# Claude DPCC Model Catalog Design

## Goal

When Claude's effective source is the DPCC default, make the Claude token's
`/v1/models` response authoritative for the composer model list. Claude SDK
`supportedModels()` data remains metadata only. Local and third-party gateway
sources retain their current behavior.

## Catalog Rules

- Resolve the effective source with `resolveClaudeUpstream()`.
- For `local` and `gateway`, return the SDK catalog unchanged.
- For `default`, fetch model IDs from the resolved DPCC base URL with the
  resolved Claude token.
- A successful DPCC response, including an empty response, is authoritative.
- A failed DPCC request falls back to the SDK catalog. A stale successful DPCC
  result may be reused for the same base URL and token.
- DPCC IDs missing from the SDK catalog remain visible with an ID-based label
  and no guessed capability metadata.

## Metadata Merge

Claude needs a dedicated merge because its `ModelInfo` shape and aliases differ
from Codex `Model` records. Each DPCC ID is emitted as the picker `value`.

Metadata lookup first uses an exact SDK `value`. If no exact match exists, it
uses Claude family and context-variant equivalence so IDs such as
`claude-sonnet-4-6` can inherit metadata from the SDK `sonnet` alias. The merge
copies display name, description, effort levels, adaptive-thinking support, and
fast-mode support without adding SDK-only models to the visible set.

## Data Flow

The main process applies the effective catalog at every Claude model IPC
boundary:

1. `claude:supported-models` caches the raw SDK result, then returns the
   effective catalog.
2. `claude:models-cache:revalidate` caches the raw SDK result, then returns the
   effective catalog.
3. `claude:models-cache:get` resolves the persisted raw SDK cache against the
   current source before returning it.

Keeping the persisted cache raw allows switching back to `local` to recover the
full SDK catalog instead of reusing an already filtered DPCC list.

## Compatibility

Do not change `getClaudeSdkModel()`, renderer alias canonicalization, or
`restartSession()`. The effective catalog emits DPCC IDs as picker values, so
the existing model selection and restart paths continue receiving the same
string selected by the user. Existing upstream model override behavior remains
out of scope.

## Codex Effort Finding

`gpt-5.3-codex-spark` can appear through DPCC `/v1/models` without a matching
native Codex `model/list` record. The fallback Codex record intentionally has an
empty `supportedReasoningEfforts`, so the composer hides effort and turn/start
omits it. This is a metadata gap, not a protocol limitation. The client must not
invent effort levels; a focused test will document this behavior.

## Verification

- Unit tests cover authoritative filtering, alias metadata merge, empty success,
  request-failure fallback, stale-cache isolation, and unchanged non-default
  sources.
- Existing Codex tests retain the no-guessed-effort invariant for upstream-only
  models, including Spark.
- Run focused tests, the full Vitest suite, production build, Semgrep workflow
  review, and code-review-graph impact analysis.
