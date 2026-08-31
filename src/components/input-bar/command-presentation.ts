import type { LucideIcon } from "lucide-react";
import {
  FileDown,
  Gauge,
  MessagesSquare,
  RefreshCw,
  ScrollText,
  Shrink,
  Signature,
  SquarePen,
  Waypoints,
} from "lucide-react";
import type { InstalledAgent, SlashCommand } from "@/types";
import { BUILTIN_PI_AGENT_ID } from "@/types";

type Translate = (key: string) => string;

interface LocalizedCommandMetadata {
  translationKey: string;
  icon: LucideIcon;
}

export interface CommandPresentation {
  label: string;
  description: string;
  argumentHint: string;
  icon?: LucideIcon;
  isLocalizedBasicCommand: boolean;
}

const LOCAL_COMMAND_METADATA: Record<string, LocalizedCommandMetadata> = {
  clear: { translationKey: "clear", icon: SquarePen },
};

const PI_COMMAND_METADATA: Record<string, LocalizedCommandMetadata> = {
  compact: { translationKey: "compact", icon: Shrink },
  autocompact: { translationKey: "autocompact", icon: RefreshCw },
  export: { translationKey: "export", icon: FileDown },
  session: { translationKey: "session", icon: Gauge },
  name: { translationKey: "name", icon: Signature },
  steering: { translationKey: "steering", icon: Waypoints },
  "follow-up": { translationKey: "followUp", icon: MessagesSquare },
  changelog: { translationKey: "changelog", icon: ScrollText },
};

export function isProtectedBuiltInPiAgent(
  agent: InstalledAgent | null | undefined,
): boolean {
  return agent?.id === BUILTIN_PI_AGENT_ID
    && agent.engine === "acp"
    && agent.builtIn === true
    && agent.registryId?.trim() === BUILTIN_PI_AGENT_ID;
}

function getLocalizedMetadata(
  command: SlashCommand,
  agent: InstalledAgent | null | undefined,
): LocalizedCommandMetadata | undefined {
  if (command.source === "local") {
    return LOCAL_COMMAND_METADATA[command.name];
  }
  if (command.source === "acp" && isProtectedBuiltInPiAgent(agent)) {
    return PI_COMMAND_METADATA[command.name];
  }
  return undefined;
}

export function getCommandPresentation(
  command: SlashCommand,
  agent: InstalledAgent | null | undefined,
  t: Translate,
): CommandPresentation {
  const metadata = getLocalizedMetadata(command, agent);
  if (!metadata) {
    return {
      label: command.name,
      description: command.description,
      argumentHint: command.argumentHint ?? "",
      isLocalizedBasicCommand: false,
    };
  }

  const baseKey = `commands.${metadata.translationKey}`;
  return {
    label: t(`${baseKey}.label`),
    description: t(`${baseKey}.description`),
    argumentHint: command.argumentHint ? t(`${baseKey}.argumentHint`) : "",
    icon: metadata.icon,
    isLocalizedBasicCommand: true,
  };
}

export function commandMatchesQuery(
  command: SlashCommand,
  query: string,
  agent: InstalledAgent | null | undefined,
  t: Translate,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  const presentation = getCommandPresentation(command, agent, t);
  return [
    command.name,
    presentation.label,
    presentation.description,
    presentation.argumentHint,
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}
