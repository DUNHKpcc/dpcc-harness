# Codex Spark Effort Fallback Design

## Goal

Expose reasoning effort controls for the upstream-only `gpt-5.3-codex-spark`
model when the bundled Codex SDK `model/list` response does not contain native
metadata for that exact model ID.

## Scope

- Add one exact-ID fallback for `gpt-5.3-codex-spark`.
- Advertise `low`, `medium`, `high`, and `xhigh` reasoning effort levels.
- Use `medium` as the fallback default effort.
- Keep native Codex `model/list` metadata authoritative whenever it contains
  an exact Spark entry.
- Leave every other upstream-only model without effort metadata.
- Let future models, including GPT-5.6 variants, obtain effort capabilities
  only from updated bundled Codex SDK metadata.

## Explicit Exception

The Spark fallback is a user-approved, product-specific exception. It is not a
general inference from a model family or alias. No capability is inherited from
`gpt-5.3-codex`, and no other model ID may match this fallback by prefix,
substring, version, or family.

## Data Flow

1. DPCC `/v1/models` remains authoritative for the visible Codex model IDs.
2. `mergeCodexModelsForUpstream()` looks for exact native metadata by `id` or
   `model`, as it does today.
3. If exact native metadata exists, it is used unchanged apart from the existing
   visibility, ID, model, and default-selection normalization.
4. If native metadata is absent and the upstream ID is exactly
   `gpt-5.3-codex-spark`, the synthesized model receives the four fallback
   effort options and `medium` default.
5. All other synthesized models retain an empty effort list and `none` default.

## Implementation Boundary

Keep the fallback in `shared/lib/codex-helpers.ts`, next to synthesized Codex
model creation and upstream merge logic. Do not add renderer-specific checks.
This keeps IPC, drafts, split panes, composer controls, and request validation on
the same normalized `CodexModel` metadata.

## Safety Rules

- Exact model ID only.
- Native metadata always wins.
- No family or alias inheritance.
- No runtime documentation fetch.
- No changes to Codex model visibility, upstream routing, or request protocol.
- `resolveCodexReasoningEffort()` continues to reject values not advertised by
  the selected model.

## Tests

- An upstream-only Spark model exposes `low`, `medium`, `high`, and `xhigh`, with
  `medium` as default.
- A native Spark entry remains authoritative and is not overwritten by the
  fallback.
- Similar IDs such as `gpt-5.3-codex-spark-preview` do not inherit capabilities.
- Other future upstream-only IDs remain effortless.
- Spark accepts an advertised requested effort and falls back to `medium` for an
  unsupported requested value.

## Success Criteria

- The composer displays all four Spark effort options when Spark is returned by
  DPCC but absent from native `model/list`.
- Existing native model behavior remains unchanged.
- No other synthesized model gains inferred effort capability.
