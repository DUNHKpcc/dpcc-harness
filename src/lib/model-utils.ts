import type { ModelInfo } from "@/types";

function normalizeModelId(model: string | null | undefined): string {
  return (model ?? "").trim().toLowerCase();
}

function modelFamily(model: string): "haiku" | "sonnet" | "opus" | "other" {
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("opus")) return "opus";
  return "other";
}

function modelVariant(model: string): "1m" | "base" {
  return model.includes("[1m]") ? "1m" : "base";
}

function modelLabel(model: ModelInfo): string {
  return model.displayName.trim().toLowerCase();
}

function modelValue(model: ModelInfo): string {
  return model.value.trim().toLowerCase();
}

function modelSearchText(model: ModelInfo): string {
  return [
    model.value,
    model.displayName,
    model.description,
  ].filter(Boolean).join(" ").trim().toLowerCase();
}

function modelFamilyForEntry(model: ModelInfo): "haiku" | "sonnet" | "opus" | "other" {
  return modelFamily(modelSearchText(model));
}

function modelVariantForEntry(model: ModelInfo): "1m" | "base" {
  return modelSearchText(model).includes("1m") ? "1m" : "base";
}

function getEquivalentModels(
  model: string | null | undefined,
  supportedModels: ModelInfo[],
): ModelInfo[] {
  return supportedModels.filter((entry) => areModelsEquivalent(entry.value, model));
}

function getFamilyMatches(
  model: string | null | undefined,
  supportedModels: ModelInfo[],
): ModelInfo[] {
  const target = normalizeModelId(model);
  const family = modelFamily(target);
  if (!target || family === "other") return [];
  const variant = modelVariant(target);
  const familyMatches = supportedModels.filter((entry) => modelFamilyForEntry(entry) === family);
  const variantMatches = familyMatches.filter((entry) => modelVariantForEntry(entry) === variant);
  return variantMatches.length > 0 ? variantMatches : familyMatches;
}

function modelPreferenceScore(candidate: ModelInfo, target: string): number {
  const value = modelValue(candidate);
  const label = modelLabel(candidate);
  let score = 0;

  // Prefer the stable alias the SDK recommends.
  if (value === "default" || label.includes("default")) score += 100;
  // Prefer short aliases (haiku/sonnet/opus) over canonical version pins.
  if (!value.startsWith("claude-")) score += 20;
  // De-prioritize "Custom Model" when an equivalent alias exists.
  if (label.includes("custom")) score -= 80;
  // Minor tie-breaker for exact match.
  if (value === target) score += 5;

  return score;
}

/**
 * Treat SDK aliases (e.g. "haiku") and canonical runtime names
 * (e.g. "claude-haiku-4-5-20251001") as equivalent for selection UI.
 */
export function areModelsEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeModelId(a);
  const nb = normalizeModelId(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const fa = modelFamily(na);
  const fb = modelFamily(nb);
  if (fa === "other" || fb === "other") return false;
  if (fa !== fb) return false;

  return modelVariant(na) === modelVariant(nb);
}

/**
 * Convert a runtime model string to the matching picker value, if possible.
 */
export function resolveModelValue(model: string | null | undefined, supportedModels: ModelInfo[]): string | undefined {
  if (!model) return undefined;
  const target = normalizeModelId(model);

  const exact = supportedModels.find((entry) => modelValue(entry) === target);
  if (exact) {
    return exact.value;
  }

  // First prefer equivalent aliases (e.g. default <-> claude-opus-*).
  const equivalents = getEquivalentModels(model, supportedModels);
  if (equivalents.length > 0) {
    const preferred = [...equivalents].sort(
      (a, b) => modelPreferenceScore(b, target) - modelPreferenceScore(a, target),
    )[0];
    return preferred.value;
  }

  // Fallback for stale caches: prefer the closest match within the same model family.
  const familyMatches = getFamilyMatches(model, supportedModels);
  if (familyMatches.length > 0) {
    const preferred = [...familyMatches].sort(
      (a, b) => modelPreferenceScore(b, target) - modelPreferenceScore(a, target),
    )[0];
    return preferred.value;
  }

  return undefined;
}

/**
 * Convert a model id into the most stable picker value for persistence.
 *
 * Unlike `resolveModelValue`, this prefers SDK aliases such as `default`,
 * `opus`, `sonnet`, and `haiku` over release-specific runtime ids whenever
 * both refer to the same effective model.
 */
export function canonicalizeModelValue(
  model: string | null | undefined,
  supportedModels: ModelInfo[],
): string | undefined {
  if (!model) return undefined;
  const target = normalizeModelId(model);

  const equivalents = getEquivalentModels(model, supportedModels);
  if (equivalents.length > 0) {
    const preferred = [...equivalents].sort(
      (a, b) => modelPreferenceScore(b, target) - modelPreferenceScore(a, target),
    )[0];
    return preferred.value;
  }

  const exact = supportedModels.find((entry) => modelValue(entry) === target);
  if (exact) {
    return exact.value;
  }

  const familyMatches = getFamilyMatches(model, supportedModels);
  if (familyMatches.length > 0) {
    const preferred = [...familyMatches].sort(
      (a, b) => modelPreferenceScore(b, target) - modelPreferenceScore(a, target),
    )[0];
    return preferred.value;
  }

  return undefined;
}

/**
 * Format a Claude model into a friendly versioned label.
 *
 * The SDK returns models keyed by short aliases (e.g. `value: "sonnet"`,
 * `displayName: "Sonnet"`), with the actual version buried in the
 * description (e.g. `"Sonnet 4.6 · Efficient for routine tasks · ..."`).
 * This helper parses `"{Family} {Version}"` out of the description and
 * appends a `1M` marker for long-context variants.
 *
 * Examples:
 *   value: "sonnet",     description starting with "Sonnet 4.6 · ..."             → "Sonnet 4.6"
 *   value: "opus[1m]",   description starting with "Opus 4.8 with 1M context ..."  → "Opus 4.8 · 1M"
 *   value: "default",    description "...currently Opus 4.8 (1M context)..."       → "Opus 4.8 · 1M"
 *
 * Falls back to `displayName` when no version can be extracted.
 */
export function formatClaudeModelLabel(model: ModelInfo): string {
  const description = model.description ?? "";
  const match = /(Opus|Sonnet|Haiku|Fable)\s+(\d+(?:\.\d+)?)/i.exec(description);
  if (!match) return model.displayName;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  const version = match[2];
  const has1M = /\[1m\]|1m\s*context|\(1m\)/i.test(
    `${model.value} ${model.displayName} ${description}`,
  );
  return has1M ? `${family} ${version} · 1M` : `${family} ${version}`;
}

export function findEquivalentModel(
  model: string | null | undefined,
  supportedModels: ModelInfo[],
): ModelInfo | undefined {
  const resolved = resolveModelValue(model, supportedModels);
  if (!resolved) return undefined;
  return supportedModels.find((entry) => entry.value === resolved);
}
