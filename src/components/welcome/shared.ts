import type { InstalledAgent } from "@/types";

// ── Step definitions ──

export const WIZARD_STEPS = [
  "welcome",
  "appearance",
  "account",
  "permissions",
  "project",
  "agents",
  "tour",
  "ready",
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number];

export const WELCOME_COMPLETED_KEY = "pcc-agent-welcome-completed";

// ── Step props ──

export interface WizardStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export interface AppearanceStepProps extends WizardStepProps {
  glassSupported: boolean;
}

export interface PermissionsStepProps extends WizardStepProps {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
}

export interface ProjectStepProps extends WizardStepProps {
  onCreateProject: () => void;
  hasProjects: boolean;
}

export interface AgentsStepProps extends WizardStepProps {
  agents: InstalledAgent[];
  onSaveAgent: (agent: InstalledAgent) => Promise<{ ok?: boolean; error?: string }>;
  onDeleteAgent: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

export interface ReadyStepProps {
  permissionMode: string;
  onComplete: () => void;
}

// ── Permission mode data ──
// Text lives in the `welcome` i18n namespace under `permissionsStep.modes.<id>`
// and is resolved with `t()` at render time.

export const PERMISSION_MODES = [
  {
    id: "default",
    icon: "Shield" as const,
  },
  {
    id: "acceptEdits",
    icon: "ShieldCheck" as const,
  },
  {
    id: "bypassPermissions",
    icon: "ShieldOff" as const,
  },
] as const;

// ── Animation ──

export const springTransition = {
  type: "spring" as const,
  damping: 30,
  stiffness: 300,
  mass: 0.8,
};

// ── Space color showcase data ──

export interface SpaceShowcase {
  /** i18n key suffix under `tourStep.spaceNames.<nameKey>` */
  nameKey: string;
  emoji: string;
  hue: number;
  chroma: number;
}

export const SHOWCASE_SPACES: SpaceShowcase[] = [
  { nameKey: "frontend", emoji: "🎨", hue: 260, chroma: 0.15 },
  { nameKey: "api", emoji: "⚡", hue: 150, chroma: 0.15 },
  { nameKey: "mobile", emoji: "📱", hue: 340, chroma: 0.15 },
  { nameKey: "devops", emoji: "🚀", hue: 45, chroma: 0.15 },
];

// ── Tool panel showcase data ──

export interface ToolShowcase {
  id: string;
  /** i18n key suffix under `tourStep.tools.<labelKey>` */
  labelKey: string;
  icon: string;
}

export const SHOWCASE_TOOLS: ToolShowcase[] = [
  { id: "terminal", labelKey: "terminal", icon: "Terminal" },
  { id: "git", labelKey: "git", icon: "GitBranch" },
  { id: "browser", labelKey: "browser", icon: "Globe" },
  { id: "files", labelKey: "files", icon: "FileText" },
  { id: "project-files", labelKey: "projectFiles", icon: "FolderTree" },
];

/** Preview background for a space color swatch. */
export function getSpacePreviewBg(hue: number, chroma: number): string {
  const c = Math.min(chroma, 0.18);
  return `oklch(0.52 ${c} ${hue})`;
}
