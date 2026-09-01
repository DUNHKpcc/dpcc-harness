import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@/types";
import { BUILTIN_PI_AGENT } from "@/types";
import {
  LOCAL_CLEAR_COMMAND,
  getAvailableSlashCommands,
  getSlashCommandReplacement,
  isClearCommandText,
  splitComposerFiles,
} from "../input-bar";
import {
  commandMatchesQuery,
  getCommandPresentation,
  isProtectedBuiltInPiAgent,
} from "../input-bar/command-presentation";
import { resolveModelOptionsDisplayState } from "../input-bar/ModelThinkingDropdown";

const translations: Record<string, string> = {
  "commands.compact.label": "压缩上下文",
  "commands.compact.description": "手动压缩当前会话上下文",
  "commands.compact.argumentHint": "可选的压缩要求",
};
const t = (key: string) => translations[key] ?? key;

describe("InputBar slash command helpers", () => {
  it("always includes the local clear command first", () => {
    const commands: SlashCommand[] = [
      { name: "compact", description: "Compact context", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[0],
    ]);
  });

  it("deduplicates engine-provided clear commands in favor of the local one", () => {
    const commands: SlashCommand[] = [
      { name: "clear", description: "Engine clear", source: "claude" },
      { name: "help", description: "Help", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[1],
    ]);
  });

  it("keeps Skill commands after regular commands without changing group order", () => {
    const commands: SlashCommand[] = [
      { name: "skill:review", description: "Review changes", source: "acp" },
      { name: "compact", description: "Compact context", source: "acp" },
      { name: "fix", description: "Fix an issue", source: "codex-skill" },
      { name: "session", description: "Show session stats", source: "acp" },
    ];

    expect(getAvailableSlashCommands(commands).map((command) => command.name)).toEqual([
      "clear",
      "compact",
      "session",
      "skill:review",
      "fix",
    ]);
  });

  it("detects the exact /clear command text", () => {
    expect(isClearCommandText("/clear")).toBe(true);
    expect(isClearCommandText("  /clear  ")).toBe(true);
    expect(isClearCommandText("/clear now")).toBe(false);
    expect(isClearCommandText("/compact")).toBe(false);
  });

  it("builds replacement text for local and engine commands", () => {
    expect(getSlashCommandReplacement(LOCAL_CLEAR_COMMAND)).toBe("/clear");
    expect(getSlashCommandReplacement({ name: "compact", description: "", source: "claude" })).toBe("/compact ");
    expect(getSlashCommandReplacement({ name: "open", description: "", source: "codex-app", appSlug: "jira" })).toBe("$jira ");
    expect(
      getSlashCommandReplacement({ name: "fix", description: "", source: "codex-skill", defaultPrompt: "bug" }),
    ).toBe("$fix bug");
  });

  it("localizes built-in Pi commands without changing their command identity", () => {
    const command: SlashCommand = {
      name: "compact",
      description: "Manually compact the session context",
      argumentHint: "optional custom instructions",
      source: "acp",
    };

    expect(isProtectedBuiltInPiAgent(BUILTIN_PI_AGENT)).toBe(true);
    expect(getCommandPresentation(command, BUILTIN_PI_AGENT, t)).toMatchObject({
      label: "压缩上下文",
      description: "手动压缩当前会话上下文",
      argumentHint: "可选的压缩要求",
      isLocalizedBasicCommand: true,
    });
    expect(getSlashCommandReplacement(command)).toBe("/compact ");
    expect(commandMatchesQuery(command, "压缩", BUILTIN_PI_AGENT, t)).toBe(true);
  });

  it("does not localize a custom ACP command that reuses a Pi command name", () => {
    const command: SlashCommand = {
      name: "compact",
      description: "Custom compact behavior",
      source: "acp",
    };
    const customAgent = {
      ...BUILTIN_PI_AGENT,
      id: "custom-pi",
      builtIn: false,
      registryId: "custom-pi",
    };

    expect(isProtectedBuiltInPiAgent(customAgent)).toBe(false);
    expect(isProtectedBuiltInPiAgent({
      ...BUILTIN_PI_AGENT,
      builtIn: false,
    })).toBe(false);
    expect(getCommandPresentation(command, customAgent, t)).toEqual({
      label: "compact",
      description: "Custom compact behavior",
      argumentHint: "",
      isLocalizedBasicCommand: false,
    });
    expect(commandMatchesQuery(command, "压缩", customAgent, t)).toBe(false);
  });

  it("splits selected composer files into image attachments and file references", () => {
    const image = new File(["image"], "screen.png", { type: "image/png" });
    const document = new File(["notes"], "notes.txt", { type: "text/plain" });

    expect(splitComposerFiles([document, image])).toEqual({
      imageFiles: [image],
      otherFiles: [document],
    });
  });
});

describe("Pi model option display state", () => {
  it.each([
    [{ hasOptions: true, loading: true, dormant: true }, "ready"],
    [{ hasOptions: false, loading: true, dormant: true }, "loading"],
    [{ hasOptions: false, loading: false, dormant: true }, "dormant"],
    [{ hasOptions: false, loading: false, dormant: false }, "unavailable"],
  ] as const)("maps %o to %s", (input, expected) => {
    expect(resolveModelOptionsDisplayState(input)).toBe(expected);
  });
});
