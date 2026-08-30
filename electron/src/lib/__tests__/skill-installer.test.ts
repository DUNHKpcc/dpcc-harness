import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSkillFiles,
  filterInstalledSkillsForProject,
  findSkillDirectory,
  hashSkillFiles,
  normalizeSkillInstallRequest,
  resolveManagedSkillPaths,
} from "../skill-installer";
import type { InstalledSkillRecord } from "../../../../shared/types/plugins";

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

  it("accepts only explicit public GitHub shorthand sources and global scope", () => {
    expect(normalizeSkillInstallRequest({
      catalogId: "owner/repo/skill",
      name: "skill",
      source: "owner/repo",
      scope: "global",
      targets: ["pi", "pi"],
    }).targets).toEqual(["pi"]);

    expect(() => normalizeSkillInstallRequest({
      catalogId: "legacy-agent",
      name: "skill",
      source: "owner/repo",
      scope: "global",
      targets: ["codex"] as never,
    })).toThrow("Unsupported Skill target");

    expect(() => normalizeSkillInstallRequest({
      catalogId: "remote",
      name: "skill",
      source: "https://example.com/repo",
      scope: "global",
      targets: ["pi"],
    })).toThrow("Only public GitHub Skill sources");

    expect(() => normalizeSkillInstallRequest({
      catalogId: "project",
      name: "skill",
      source: "owner/repo",
      scope: "project" as never,
      targets: ["pi"],
    })).toThrow("only be installed globally");
  });

  it("accepts only manifest paths derived from the recorded scope and targets", () => {
    const projectPath = path.join(root, "project");
    const record: InstalledSkillRecord = {
      id: "record",
      catalogId: "owner/repo/skill",
      name: "skill",
      source: "owner/repo",
      sourceRevision: "abc123",
      contentHash: "hash",
      scope: "project",
      targets: ["claude-code", "codex"],
      projectPath,
      installPaths: [
        path.join(projectPath, ".claude/skills/skill"),
        path.join(projectPath, ".agents/skills/skill"),
      ],
      installedAt: new Date(0).toISOString(),
    };

    expect(resolveManagedSkillPaths(record)).toEqual(new Set(record.installPaths));
    expect(() => resolveManagedSkillPaths({
      ...record,
      installPaths: [record.installPaths[0], path.join(root, "outside")],
    })).toThrow("outside its managed root");
  });

  it("lists only global Skills and Skills installed for the selected project", () => {
    const firstProject = path.join(root, "first");
    const secondProject = path.join(root, "second");
    const baseRecord: InstalledSkillRecord = {
      id: "global",
      catalogId: "owner/repo/skill",
      name: "skill",
      source: "owner/repo",
      sourceRevision: "abc123",
      contentHash: "hash",
      scope: "global",
      targets: ["pi"],
      installPaths: [path.join(os.homedir(), ".agents/skills/skill")],
      installedAt: new Date(0).toISOString(),
    };
    const records: InstalledSkillRecord[] = [
      baseRecord,
      {
        ...baseRecord,
        id: "first",
        scope: "project",
        projectPath: firstProject,
        installPaths: [path.join(firstProject, ".agents/skills/skill")],
      },
      {
        ...baseRecord,
        id: "second",
        scope: "project",
        projectPath: secondProject,
        installPaths: [path.join(secondProject, ".agents/skills/skill")],
      },
    ];

    expect(filterInstalledSkillsForProject(records, firstProject).map((record) => record.id))
      .toEqual(["global", "first"]);
    expect(filterInstalledSkillsForProject(records, null).map((record) => record.id))
      .toEqual(["global"]);
  });

  it("migrates an unmodified managed Pi project Skill into the global root", async () => {
    const projectPath = path.join(root, "project");
    const projectSkillPath = path.join(projectPath, ".agents/skills/skill");
    fs.mkdirSync(projectSkillPath, { recursive: true });
    fs.writeFileSync(path.join(projectSkillPath, "SKILL.md"), "---\nname: skill\n---\n");
    fs.writeFileSync(path.join(projectSkillPath, "payload.txt"), "project");
    const contentHash = await hashSkillFiles(await collectSkillFiles(projectSkillPath));
    let manifest: InstalledSkillRecord[] = [{
      id: "project-record",
      catalogId: "owner/repo/skill",
      name: "skill",
      source: "owner/repo",
      sourceRevision: "old-revision",
      contentHash,
      scope: "project",
      targets: ["pi"],
      projectPath,
      installPaths: [projectSkillPath],
      installedAt: new Date(0).toISOString(),
    }];
    const saveManifest = vi.fn((_key: string, records: InstalledSkillRecord[]) => {
      manifest = records;
    });

    vi.resetModules();
    vi.doMock("../json-file-store", () => ({
      JsonFileStore: class {
        load() {
          return manifest;
        }

        save(key: string, records: InstalledSkillRecord[]) {
          saveManifest(key, records);
        }
      },
    }));
    const homeDirSpy = vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));

    try {
      const { listInstalledSkills } = await import("../skill-installer");
      const installed = await listInstalledSkills();
      const globalPath = path.join(root, "home", ".agents/skills/skill");

      expect(installed).toHaveLength(1);
      expect(installed[0]).toMatchObject({ scope: "global", installPaths: [globalPath] });
      expect(fs.readFileSync(path.join(globalPath, "payload.txt"), "utf8")).toBe("project");
      expect(fs.existsSync(projectSkillPath)).toBe(true);
      expect(saveManifest).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock("../json-file-store");
      homeDirSpy.mockRestore();
      vi.resetModules();
    }
  });
});
