/**
 * App-owned reasoning metadata for model catalogs that only expose model IDs.
 *
 * Keep this list scoped to documented upstream behavior. Runtime metadata from
 * Claude/Codex remains authoritative when it is available.
 */

const MODEL_EFFORT_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ModelEffortLevel = (typeof MODEL_EFFORT_LEVELS)[number];
export type PiThinkingLevel = "off" | Exclude<ModelEffortLevel, "none">;

interface ModelEffortProfile {
  levels: readonly ModelEffortLevel[];
  defaultLevel: ModelEffortLevel;
}

interface PiThinkingProfile {
  /** Levels exposed by Pi. Values may be carriers for a different upstream level. */
  levels: readonly PiThinkingLevel[];
  valueMap?: Partial<Record<PiThinkingLevel, ModelEffortLevel>>;
  /** Use output_config.effort with Anthropic-compatible providers. */
  forceAdaptiveThinking?: boolean;
}

interface ModelReasoningProfile {
  effort: ModelEffortProfile | null;
  piThinking: PiThinkingProfile | null;
}

const CLAUDE_STANDARD = ["low", "medium", "high", "max"] as const;
const CLAUDE_EXTENDED = ["low", "medium", "high", "xhigh", "max"] as const;
const GPT_54 = ["none", "low", "medium", "high", "xhigh"] as const;
const GPT_56 = ["none", "low", "medium", "high", "xhigh", "max"] as const;

function effort(
  levels: readonly ModelEffortLevel[],
  defaultLevel: ModelEffortLevel,
): ModelEffortProfile {
  return { levels, defaultLevel };
}

function profile(
  modelEffort: ModelEffortProfile | null,
  piThinking: PiThinkingProfile | null,
): ModelReasoningProfile {
  return { effort: modelEffort, piThinking };
}

const TOGGLE_ONLY_PI: PiThinkingProfile = {
  levels: ["off", "high"],
};

const ALWAYS_THINKING_PI: PiThinkingProfile = {
  levels: ["high"],
};

const MODEL_REASONING_PROFILES: Readonly<Record<string, ModelReasoningProfile>> = {
  // Anthropic effort matrix:
  // https://platform.claude.com/docs/en/build-with-claude/effort
  "claude-haiku-4-5": profile(null, {
    levels: ["off", "minimal", "low", "medium", "high"],
  }),
  "claude-opus-4-6": profile(effort(CLAUDE_STANDARD, "high"), {
    levels: ["off", "low", "medium", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),
  "claude-opus-4-7": profile(effort(CLAUDE_EXTENDED, "high"), {
    levels: ["off", "low", "medium", "high", "xhigh", "max"],
    forceAdaptiveThinking: true,
  }),
  "claude-opus-4-8": profile(effort(CLAUDE_EXTENDED, "high"), {
    levels: ["off", "low", "medium", "high", "xhigh", "max"],
    forceAdaptiveThinking: true,
  }),
  "claude-sonnet-4-6": profile(effort(CLAUDE_STANDARD, "high"), {
    levels: ["off", "low", "medium", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),
  "claude-sonnet-5": profile(effort(CLAUDE_EXTENDED, "high"), {
    levels: ["off", "low", "medium", "high", "xhigh", "max"],
    forceAdaptiveThinking: true,
  }),

  // DeepSeek V4 exposes only distinct high/max effort tiers. Low/medium and
  // xhigh are compatibility aliases upstream, so they are not separate UI rows.
  // https://api-docs.deepseek.com/guides/thinking_mode
  "deepseek-v4-flash": profile(effort(["high", "max"], "high"), {
    levels: ["off", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),
  "deepseek-v4-flash-0731": profile(effort(["high", "max"], "high"), {
    levels: ["off", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),
  "deepseek-v4-pro": profile(effort(["high", "max"], "high"), {
    levels: ["off", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),

  // GLM 5/5.1 support a thinking toggle, not tiered effort. GLM 5.2 adds
  // distinct high/max tiers; its other accepted values are compatibility maps.
  // https://docs.bigmodel.cn/cn/guide/capabilities/thinking
  "glm-5": profile(null, TOGGLE_ONLY_PI),
  "glm-5.1": profile(null, TOGGLE_ONLY_PI),
  "glm-5.2": profile(effort(["high", "max"], "max"), {
    levels: ["off", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),

  // Kimi K2.5/K2.6 are toggle-based, K2.7 Code is always-thinking, and K3
  // exposes low/high/max effort.
  // https://github.com/MoonshotAI/Kimi-K2.5
  // https://www.kimi.com/code/docs/en/kimi-code/models.html
  "kimi-k2.5": profile(null, TOGGLE_ONLY_PI),
  "kimi-k2.6": profile(null, TOGGLE_ONLY_PI),
  "kimi-k2.7-code": profile(null, ALWAYS_THINKING_PI),
  "kimi-k3": profile(effort(["low", "high", "max"], "high"), {
    levels: ["low", "high", "xhigh"],
    valueMap: { xhigh: "max" },
    forceAdaptiveThinking: true,
  }),

  // xAI Grok 4.5 cannot disable reasoning and supports low/medium/high.
  // https://docs.x.ai/developers/model-capabilities/text/reasoning
  "grok-4.5": profile(effort(["low", "medium", "high"], "high"), {
    levels: ["low", "medium", "high"],
    forceAdaptiveThinking: true,
  }),

  // Xiaomi's official MiMo clients expose low/medium/high for both V2.5 tiers.
  // https://github.com/XiaomiMiMo/MiMo-Code
  "mimo-v2.5": profile(effort(["low", "medium", "high"], "high"), {
    levels: ["low", "medium", "high"],
    forceAdaptiveThinking: true,
  }),
  "mimo-v2.5-pro": profile(effort(["low", "medium", "high"], "high"), {
    levels: ["low", "medium", "high"],
    forceAdaptiveThinking: true,
  }),

  // OpenAI model pages are the source of truth for fallback metadata. Codex
  // app-server metadata still wins when it advertises a richer live contract.
  // https://developers.openai.com/api/docs/models
  "gpt-5.3-codex-spark": profile(effort(["low", "medium", "high", "xhigh"], "high"), {
    levels: ["low", "medium", "high", "xhigh"],
  }),
  "gpt-5.4": profile(effort(GPT_54, "none"), {
    levels: ["off", "low", "medium", "high", "xhigh"],
    valueMap: { off: "none" },
  }),
  "gpt-5.4-mini": profile(effort(GPT_54, "none"), {
    levels: ["off", "low", "medium", "high", "xhigh"],
    valueMap: { off: "none" },
  }),
  "gpt-5.5": profile(effort(GPT_54, "medium"), {
    levels: ["off", "low", "medium", "high", "xhigh"],
    valueMap: { off: "none" },
  }),
  "gpt-5.6-sol": profile(effort(GPT_56, "medium"), {
    levels: ["off", "low", "medium", "high", "xhigh", "max"],
    valueMap: { off: "none" },
  }),
  "gpt-5.6-terra": profile(effort(GPT_56, "medium"), {
    levels: ["off", "low", "medium", "high", "xhigh", "max"],
    valueMap: { off: "none" },
  }),
  "gpt-5.6-luna": profile(effort(GPT_56, "medium"), {
    levels: ["off", "low", "medium", "high", "xhigh", "max"],
    valueMap: { off: "none" },
  }),
  "gpt-image-2": profile(null, null),
};

/** Strip the managed Pi provider prefix without changing ordinary model IDs. */
export function normalizeModelId(modelId: string): string {
  const value = modelId.trim();
  const separator = value.indexOf("/");
  return (separator >= 0 ? value.slice(separator + 1) : value).toLowerCase();
}

export function getModelReasoningProfile(
  modelId: string | undefined,
): ModelReasoningProfile | undefined {
  if (!modelId?.trim()) return undefined;
  return MODEL_REASONING_PROFILES[normalizeModelId(modelId)];
}

export function getModelEffortProfile(
  modelId: string | undefined,
): ModelEffortProfile | null | undefined {
  return getModelReasoningProfile(modelId)?.effort;
}

export function getPiThinkingProfile(
  modelId: string | undefined,
): PiThinkingProfile | null | undefined {
  return getModelReasoningProfile(modelId)?.piThinking;
}

/** Build Pi's model-level map, hiding unsupported levels and opting into extended ones. */
export function buildPiThinkingLevelMap(
  modelId: string,
): Partial<Record<PiThinkingLevel, ModelEffortLevel | null>> | undefined {
  const profile = getPiThinkingProfile(modelId);
  if (profile === undefined) return undefined;

  const supported = new Set<PiThinkingLevel>(profile?.levels ?? []);
  const map: Partial<Record<PiThinkingLevel, ModelEffortLevel | null>> = {};
  const piLevels: readonly PiThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];

  for (const level of piLevels) {
    if (!supported.has(level)) {
      map[level] = null;
      continue;
    }
    const mapped = profile?.valueMap?.[level];
    if (mapped) {
      map[level] = mapped;
    } else if (level === "xhigh" || level === "max") {
      map[level] = level;
    }
  }
  return map;
}

export function getPiThinkingDisplayLevel(
  modelId: string,
  level: string,
): string {
  const profile = getPiThinkingProfile(modelId);
  if (!profile || !profile.levels.includes(level as PiThinkingLevel)) return level;
  if (level === "off") return level;
  return profile.valueMap?.[level as PiThinkingLevel] ?? level;
}
