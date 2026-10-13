import { normalizeModelId } from "./model-effort-capabilities";

/**
 * Documented API capacities for IDs in the DPCC catalog checked on 2026-10-13.
 * /v1/models often exposes IDs only. Explicit upstream capacity always wins;
 * these are API limits, not the smaller Codex/OAuth runtime context budget.
 * Do not infer a capacity for unknown models or image/review-only aliases.
 */
const CONTEXT_WINDOWS = new Map<string, number>();

// https://developers.openai.com/api/docs/models
for (const model of [
  "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
  "gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol",
]) CONTEXT_WINDOWS.set(model, 1_050_000);
CONTEXT_WINDOWS.set("gpt-5.3-codex-spark", 128_000);
// DPCC's effort-qualified alias for the documented gpt-oss-120b model.
CONTEXT_WINDOWS.set("gpt-oss-120b-medium", 131_072);

// https://platform.claude.com/docs/en/about-claude/models/overview
for (const model of [
  "claude-sonnet-4-6", "claude-sonnet-5", "claude-sonnet-5-5",
  "claude-opus-4-6", "claude-opus-4-6-thinking", "claude-opus-4-7",
  "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5",
  "claude-fable-5", "claude-fable-5-1", "claude-haiku-5-5",
]) CONTEXT_WINDOWS.set(model, 1_000_000);
for (const model of ["claude-haiku-4-5", "claude-haiku-4-5-20251001"]) {
  CONTEXT_WINDOWS.set(model, 200_000);
}

// https://ai.google.dev/gemini-api/docs/models
for (const model of [
  "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview",
  "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash",
  "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.7-flash",
  "gemini-3.8-flash",
]) CONTEXT_WINDOWS.set(model, 1_048_576);

// https://api-docs.deepseek.com/quick_start/pricing
CONTEXT_WINDOWS.set("deepseek-v4-flash", 1_000_000);
// https://docs.x.ai/developers/models
CONTEXT_WINDOWS.set("grok-4.3", 1_000_000);
for (const model of ["grok-4.5", "grok-4.6", "grok-4.7"]) {
  CONTEXT_WINDOWS.set(model, 500_000);
}

/** Only the managed DPCC upstream may use these app-owned fallbacks. */
export function getDpccModelContextWindow(modelId: string): number | undefined {
  return CONTEXT_WINDOWS.get(normalizeModelId(modelId));
}
