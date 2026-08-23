import fs from "fs";
import path from "path";
import type { SkillsListEntry } from "@shared/types/codex-protocol/v2/SkillsListEntry";

const MAX_SKILL_ICON_BYTES = 256 * 1024;
const MAX_SKILL_ICON_CATALOG_BYTES = 2 * 1024 * 1024;

const ICON_MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

interface IconReadBudget {
  remainingBytes: number;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSafeInlineSvg(contents: Buffer): boolean {
  const svg = contents.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (!/^<(?:\?xml[^>]*>\s*)?svg(?:\s|>)/i.test(svg)) return false;

  // SVGs are rendered as images, but reject active/external constructs before
  // turning local content into a renderer-visible data URL.
  return !/(?:<!DOCTYPE|<!ENTITY|<(?:script|style|foreignObject|iframe|object|embed|image)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href|src|style)\s*=|url\s*\()/i.test(svg);
}

function isValidImagePayload(mimeType: string, contents: Buffer): boolean {
  switch (mimeType) {
    case "image/svg+xml":
      return isSafeInlineSvg(contents);
    case "image/png":
      return contents.length >= 8
        && contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
      return contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff;
    case "image/gif":
      return contents.subarray(0, 6).toString("ascii") === "GIF87a"
        || contents.subarray(0, 6).toString("ascii") === "GIF89a";
    case "image/webp":
      return contents.length >= 12
        && contents.subarray(0, 4).toString("ascii") === "RIFF"
        && contents.subarray(8, 12).toString("ascii") === "WEBP";
    case "image/avif": {
      const brand = contents.length >= 12 ? contents.subarray(8, 12).toString("ascii") : "";
      return contents.length >= 12
        && contents.subarray(4, 8).toString("ascii") === "ftyp"
        && (brand === "avif" || brand === "avis");
    }
    case "image/x-icon":
      return contents.length >= 4
        && contents[0] === 0x00
        && contents[1] === 0x00
        && contents[2] === 0x01
        && contents[3] === 0x00;
    default:
      return false;
  }
}

async function resolveRegisteredSkillRoot(skillPath: string): Promise<string | null> {
  if (!skillPath || path.basename(skillPath) !== "SKILL.md") return null;
  const declaredRoot = path.dirname(path.resolve(skillPath));
  try {
    const [root, skillFile] = await Promise.all([
      fs.promises.realpath(declaredRoot),
      fs.promises.realpath(skillPath),
    ]);
    const skillStat = await fs.promises.stat(skillFile);
    return skillStat.isFile() && isWithin(root, skillFile) ? root : null;
  } catch {
    return null;
  }
}

async function inlineSkillIcon(
  skillPath: string,
  iconPath: string | undefined,
  budget: IconReadBudget,
): Promise<string | undefined> {
  if (!iconPath || iconPath.includes("\0") || budget.remainingBytes <= 0) return undefined;

  const skillRoot = await resolveRegisteredSkillRoot(skillPath);
  if (!skillRoot) return undefined;
  const declaredRoot = path.dirname(path.resolve(skillPath));
  const candidate = path.resolve(declaredRoot, iconPath);
  if (!isWithin(declaredRoot, candidate)) return undefined;

  try {
    const resolvedIcon = await fs.promises.realpath(candidate);
    if (!isWithin(skillRoot, resolvedIcon)) return undefined;

    const stat = await fs.promises.stat(resolvedIcon);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SKILL_ICON_BYTES || stat.size > budget.remainingBytes) {
      return undefined;
    }

    const mimeType = ICON_MIME_TYPES[path.extname(resolvedIcon).toLowerCase()];
    if (!mimeType) return undefined;

    const contents = await fs.promises.readFile(resolvedIcon);
    if (contents.length !== stat.size || !isValidImagePayload(mimeType, contents)) return undefined;

    budget.remainingBytes -= contents.length;
    return `data:${mimeType};base64,${contents.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Replace local Skill icon paths with bounded data URLs. The app-server owns
 * the list of Skills; each icon is still constrained to its own registered
 * Skill directory after resolving symlinks.
 */
export async function inlineRegisteredSkillIcons(
  entries: SkillsListEntry[],
): Promise<SkillsListEntry[]> {
  const budget: IconReadBudget = { remainingBytes: MAX_SKILL_ICON_CATALOG_BYTES };

  const sanitizedEntries: SkillsListEntry[] = [];
  for (const entry of entries) {
    const sanitizedSkills: SkillsListEntry["skills"] = [];
    for (const skill of entry.skills) {
      if (!skill.interface?.iconSmall && !skill.interface?.iconLarge) {
        sanitizedSkills.push(skill);
        continue;
      }

      const iconSmall = await inlineSkillIcon(skill.path, skill.interface.iconSmall, budget);
      const iconLarge = await inlineSkillIcon(skill.path, skill.interface.iconLarge, budget);
      const { iconSmall: _iconSmall, iconLarge: _iconLarge, ...restInterface } = skill.interface;
      sanitizedSkills.push({
        ...skill,
        interface: {
          ...restInterface,
          ...(iconSmall ? { iconSmall } : {}),
          ...(iconLarge ? { iconLarge } : {}),
        },
      });
    }
    sanitizedEntries.push({ ...entry, skills: sanitizedSkills });
  }
  return sanitizedEntries;
}
