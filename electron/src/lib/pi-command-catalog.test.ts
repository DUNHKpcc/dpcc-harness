import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { listPiDraftSlashCommands } from "./pi-command-catalog";

const tempDirs: string[] = [];

function fixture(): { root: string; homeDir: string; agentDir: string; cwd: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-command-catalog-"));
  tempDirs.push(root);
  const homeDir = path.join(root, "home");
  const agentDir = path.join(homeDir, ".pi", "agent");
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  return { root, homeDir, agentDir, cwd };
}

function write(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Pi draft command catalog", () => {
  it("returns pinned built-in commands when no cache or user resources exist", () => {
    const { homeDir, agentDir, cwd } = fixture();

    const commands = listPiDraftSlashCommands(cwd, { homeDir, agentDir });

    expect(commands.map((command) => command.name)).toEqual([
      "compact",
      "autocompact",
      "export",
      "session",
      "name",
      "steering",
      "follow-up",
      "changelog",
    ]);
  });

  it("loads global and project prompts and explicit Agent Skills before Pi starts", () => {
    const { homeDir, agentDir, cwd } = fixture();
    write(
      path.join(agentDir, "prompts", "review.md"),
      "---\ndescription: Review this change\nargument-hint: <path>\n---\nReview $ARGUMENTS\n",
    );
    write(
      path.join(cwd, ".pi", "prompts", "nested", "explain.md"),
      "Explain the selected code in plain language.\n",
    );
    write(
      path.join(homeDir, ".agents", "skills", "global-skill", "SKILL.md"),
      "---\nname: global-skill\ndescription: Global fixture skill\n---\n",
    );
    write(
      path.join(cwd, ".agents", "skills", "project-skill", "SKILL.md"),
      "---\nname: project-skill\ndescription: Project fixture skill\n---\n",
    );

    const commands = listPiDraftSlashCommands(cwd, { homeDir, agentDir });

    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "review", argumentHint: "<path>" }),
      expect.objectContaining({ name: "explain" }),
      expect.objectContaining({ name: "skill:global-skill" }),
      expect.objectContaining({ name: "skill:project-skill" }),
      expect.objectContaining({ name: "compact" }),
    ]));
  });

  it("honors the project skill-command setting without hiding prompts or built-ins", () => {
    const { homeDir, agentDir, cwd } = fixture();
    write(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ enableSkillCommands: false }));
    write(path.join(cwd, ".pi", "prompts", "review.md"), "Review this change.\n");
    write(
      path.join(cwd, ".agents", "skills", "project-skill", "SKILL.md"),
      "---\nname: project-skill\ndescription: Project fixture skill\n---\n",
    );

    const names = listPiDraftSlashCommands(cwd, { homeDir, agentDir })
      .map((command) => command.name);

    expect(names).toContain("review");
    expect(names).toContain("compact");
    expect(names).not.toContain("skill:project-skill");
  });

  it("rejects a relative cwd", () => {
    expect(() => listPiDraftSlashCommands("relative/path", {
      homeDir: "/tmp/home",
      agentDir: "/tmp/agent",
    })).toThrow("absolute cwd");
  });
});
