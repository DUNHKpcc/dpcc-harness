import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectSkillFiles,
  findSkillDirectory,
  hashSkillFiles,
  normalizeSkillInstallRequest,
} from "../skill-installer";

describe("Skill installer validation", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pcc-skill-test-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("selects the catalog-named Skill instead of an unrelated SKILL.md", async () => {
    const unrelated = path.join(root, "a-unrelated");
    const expected = path.join(root, "z-expected");
    fs.mkdirSync(unrelated);
    fs.mkdirSync(expected);
    fs.writeFileSync(path.join(unrelated, "SKILL.md"), "---\nname: other\n---\n");
    fs.writeFileSync(path.join(expected, "SKILL.md"), "---\nname: expected\n---\n");

    await expect(findSkillDirectory(root, "expected")).resolves.toBe(expected);
    await expect(findSkillDirectory(root, "missing")).rejects.toThrow(
      'Skill "missing" was not found',
    );
  });

  it("rejects symlinks and hashes file content deterministically", async () => {
    const skill = path.join(root, "skill");
    fs.mkdirSync(skill);
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: skill\n---\n");
    fs.writeFileSync(path.join(skill, "notes.txt"), "one");

    const firstHash = await hashSkillFiles(await collectSkillFiles(skill));
    fs.writeFileSync(path.join(skill, "notes.txt"), "two");
    const secondHash = await hashSkillFiles(await collectSkillFiles(skill));
    expect(secondHash).not.toBe(firstHash);

    fs.symlinkSync(path.join(skill, "notes.txt"), path.join(skill, "linked.txt"));
    await expect(collectSkillFiles(skill)).rejects.toThrow("symlinks are not supported");
  });

  it("accepts only explicit public GitHub shorthand sources and valid project scope", () => {
    expect(normalizeSkillInstallRequest({
      catalogId: "owner/repo/skill",
      name: "skill",
      source: "owner/repo",
      scope: "global",
      targets: ["claude-code", "claude-code", "codex"],
    }).targets).toEqual(["claude-code", "codex"]);

    expect(() => normalizeSkillInstallRequest({
      catalogId: "remote",
      name: "skill",
      source: "https://example.com/repo",
      scope: "global",
      targets: ["codex"],
    })).toThrow("Only public GitHub Skill sources");

    expect(() => normalizeSkillInstallRequest({
      catalogId: "project",
      name: "skill",
      source: "owner/repo",
      scope: "project",
      targets: ["codex"],
    })).toThrow("project path is required");
  });
});
