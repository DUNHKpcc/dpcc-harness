import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InstalledSkillRecord, StoredSkillTarget } from "../../../shared/types/plugins";

const MAX_DISCOVERED_SKILLS = 2_000;
const MAX_DISCOVERY_DEPTH = 10;

interface SkillRoot {
  root: string;
  origin: NonNullable<InstalledSkillRecord["origin"]>;
  target: StoredSkillTarget;
}

function skillName(contents: string, fallback: string): string {
  const match = contents.replace(/\r\n/g, "\n").match(/^---\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m);
  return match?.[1]?.trim() || fallback;
}

function sourceRoots(home: string): SkillRoot[] {
  return [
    { root: path.join(home, ".agents", "skills"), origin: "Local Agent", target: "pi" },
    { root: path.join(home, ".claude", "skills"), origin: "Claude Code", target: "claude-code" },
    { root: path.join(home, ".claude", "plugins", "cache"), origin: "Claude Code", target: "claude-code" },
    { root: path.join(home, ".claude", "plugins", "marketplaces"), origin: "Claude Code", target: "claude-code" },
    { root: path.join(home, ".codex", "skills"), origin: "Codex", target: "codex" },
    { root: path.join(home, ".codex", "plugins", "cache"), origin: "Codex", target: "codex" },
  ];
}

function findSkillFiles(root: string): string[] {
  const files: string[] = [];
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  while (queue.length > 0 && files.length < MAX_DISCOVERED_SKILLS) {
    const current = queue.shift();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(current.directory, entry.name);
      if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(entryPath);
      } else if (
        entry.isDirectory()
        && current.depth < MAX_DISCOVERY_DEPTH
        && entry.name !== ".git"
        && entry.name !== "node_modules"
      ) {
        queue.push({ directory: entryPath, depth: current.depth + 1 });
      }
      if (files.length >= MAX_DISCOVERED_SKILLS) break;
    }
  }
  return files;
}

export function discoverLocalSkills(managedRecords: InstalledSkillRecord[]): InstalledSkillRecord[] {
  const managedPaths = new Set(managedRecords.flatMap((record) => record.installPaths.map((item) => path.resolve(item))));
  const discovered = new Map<string, InstalledSkillRecord>();
  for (const { root, origin, target } of sourceRoots(os.homedir())) {
    for (const filePath of findSkillFiles(root)) {
      const skillDirectory = path.dirname(filePath);
      if (managedPaths.has(path.resolve(skillDirectory))) continue;
      try {
        const name = skillName(fs.readFileSync(filePath, "utf8"), path.basename(skillDirectory));
        const key = `${origin}:${name}`;
        if (discovered.has(key)) continue;
        discovered.set(key, {
          id: `local-${createHash("sha256").update(skillDirectory).digest("hex")}`,
          catalogId: "",
          name,
          source: origin,
          sourceRevision: "",
          contentHash: "",
          scope: "global",
          targets: [target],
          installPaths: [skillDirectory],
          installedAt: "",
          managed: false,
          origin,
        });
      } catch {
        // A local Skill should not disappear from another agent because one file is unreadable.
      }
    }
  }
  return [...discovered.values()];
}
