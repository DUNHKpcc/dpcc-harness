# DPCC Codex Capability Metadata Design

## Goal

Make Codex reasoning effort controls work for DPCC models even when the bundled
Codex `app-server model/list` omits entitlement-gated metadata in the isolated
DPCC `CODEX_HOME`.

## Verified Root Cause

The bundled `codex-cli 0.144.1` returns native metadata for
`gpt-5.3-codex-spark` under a normal authenticated `CODEX_HOME`, including
`low`, `medium`, `high`, and `xhigh` with `high` as default. The same binary
omits Spark under PccAgent's isolated, unauthenticated DPCC `CODEX_HOME`.

The problem is therefore not a stale bundled binary. Spark metadata is filtered
by Codex login state or entitlement. Copying `models_cache.json` into an
unauthenticated isolated home does not make `model/list` return Spark.

## Scope

- Keep DPCC `/v1/models` authoritative for visible Codex model IDs.
- Keep exact native `model/list` metadata as the first metadata source.
- Allow DPCC `/v1/models` entries to carry optional reasoning capability
  metadata for models missing from native `model/list`.
- Do not read the user's local OpenAI login for DPCC sessions or metadata.
- Do not hardcode Spark or infer capabilities from model names.
- Let future bundled Codex updates supply native metadata automatically.

## DPCC Response Extension

The client remains compatible with ordinary OpenAI-style model objects that
only contain `id`. DPCC may additionally return:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5.3-codex-spark",
      "supported_reasoning_efforts": ["low", "medium", "high", "xhigh"],
      "default_reasoning_effort": "high"
    }
  ]
}
```

Only recognized, non-empty effort strings are retained. The default is retained
only when it is present in the supported list. Invalid optional metadata is
ignored without invalidating an otherwise valid model ID.

## Data Model

`fetchUpstreamModels()` continues returning the existing `models: string[]`
projection for account and settings consumers. It additionally returns parsed
per-model capability records so existing callers remain source-compatible.

The Codex catalog cache stores the complete parsed upstream entries, not only
IDs, for the existing 60-second credential-scoped lifetime.

## Merge Order

For each model ID returned by DPCC:

1. Use an exact native `model/list` entry when present. Native display name,
   description, effort options, default effort, modalities, and other metadata
   remain authoritative.
2. If native metadata is absent, synthesize the model and apply exact DPCC
   capability metadata for that same ID.
3. If both metadata sources are absent, keep the synthesized model without
   effort controls.

DPCC metadata never overrides an exact native entry. No prefix, alias, family,
or version inheritance is allowed.

## Effort Descriptions

DPCC supplies capability values, while the client maps recognized effort IDs to
the existing neutral UI descriptions. Descriptions do not determine support;
only the DPCC-provided supported list does.

## Failure Behavior

- A successful DPCC response, including an empty list, remains authoritative.
- A failed DPCC request retains the existing catalog fallback behavior.
- Missing or malformed optional capability fields do not hide the model.
- Unknown effort values are ignored rather than sent to Codex.
- No local OpenAI auth files are copied into the isolated DPCC home.

## Components

- `electron/src/lib/upstream-models.ts`: parse IDs and optional capability
  metadata from `/v1/models`.
- `electron/src/lib/codex-model-catalog.ts`: cache and pass complete DPCC model
  entries to the merge layer.
- `shared/lib/codex-helpers.ts`: preserve native-first exact-ID merge semantics
  and enrich only synthesized models with DPCC capabilities.
- Existing renderer and request code consume the normalized `CodexModel` and do
  not need model-specific conditions.

## Tests

- Parse ID-only responses unchanged.
- Parse valid Spark capability metadata.
- Ignore malformed effort metadata while retaining the ID.
- Enrich an upstream-only model from exact DPCC capabilities.
- Preserve exact native metadata over conflicting DPCC metadata.
- Do not transfer capabilities to similar model IDs.
- Keep an upstream-only ID without effort when DPCC sends no capabilities.
- Validate requested effort through the existing
  `resolveCodexReasoningEffort()` path.

## Deployment Dependency

The client implementation enables the protocol but cannot create missing
capabilities. Production Spark effort controls appear only after the DPCC
`/v1/models` service emits the optional fields above for the Codex token.

## Success Criteria

- DPCC users do not need an OpenAI login to receive trustworthy effort metadata.
- Spark displays native-equivalent effort controls when DPCC publishes them.
- Native metadata automatically wins after a bundled Codex update exposes a
  model in the isolated environment.
- No model capability is guessed or hardcoded in the client.
