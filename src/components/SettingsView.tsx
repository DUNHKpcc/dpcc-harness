import { memo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  SlidersHorizontal,
  Bell,
  Bot,
  Plug,
  Cpu,
  Info,
  Wrench,
  Palette,
  Sparkles,
  Users,
  BarChart3,
  Server,
  X,
  Wallet,
  Smartphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { WeChatSettings } from "@/components/settings/WeChatSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { EngineSettings } from "@/components/settings/EngineSettings";
import { PlaceholderSection } from "@/components/settings/PlaceholderSection";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { AnalyticsSettings } from "@/components/settings/AnalyticsSettings";
import { CurrentConfigSettings } from "@/components/settings/CurrentConfigSettings";
import { setAppSettingsChecked } from "@/lib/app-settings-ipc";
import { isMac } from "@/lib/utils";
import type { AppSettings } from "@/types";
import { useAgentContext } from "./AgentContext";

// ── Section definitions ──

export type SettingsSection = "general" | "account" | "appearance" | "notifications" | "analytics" | "agents" | "mcp" | "engines" | "wechat" | "current-config" | "skills" | "custom-agents" | "advanced" | "about";

interface NavItem {
  id: SettingsSection;
  /** i18n key under the "settings" namespace, resolved at render time */
  labelKey: string;
  icon: LucideIcon;
  /** Renders a subtle "soon" indicator next to the label */
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "account", labelKey: "nav.account", icon: Wallet },
  { id: "general", labelKey: "nav.general", icon: SlidersHorizontal },
  { id: "appearance", labelKey: "nav.appearance", icon: Palette },
  { id: "notifications", labelKey: "nav.notifications", icon: Bell },
  { id: "analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { id: "agents", labelKey: "nav.agents", icon: Bot },
  { id: "mcp", labelKey: "nav.mcp", icon: Plug },
  { id: "engines", labelKey: "nav.engines", icon: Cpu },
  { id: "wechat", labelKey: "nav.wechat", icon: Smartphone },
  { id: "current-config", labelKey: "nav.currentConfig", icon: Server },
  { id: "skills", labelKey: "nav.skills", icon: Sparkles, comingSoon: true },
  { id: "custom-agents", labelKey: "nav.customAgents", icon: Users, comingSoon: true },
  { id: "advanced", labelKey: "nav.advanced", icon: Wrench },
  { id: "about", labelKey: "nav.about", icon: Info },
];

// ── Props ──

interface SettingsViewProps {
  onClose: () => void;
  glassSupported: boolean;
  macLiquidGlassSupported: boolean;
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
  /** Open directly to a specific section (e.g. "agents" from the engine picker). */
  initialSection?: SettingsSection;
}

// ── Component ──

export const SettingsView = memo(function SettingsView({
  onClose,
  glassSupported,
  macLiquidGlassSupported,
  onReplayWelcome,
  initialSection,
}: SettingsViewProps) {
  const { t } = useTranslation("settings");
  const { agents, saveAgent, deleteAgent } = useAgentContext();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? "account");
  const macTitlebarInsetClass = isMac ? "ps-[84px]" : "";

  // ── Main-process app settings (loaded once, updated optimistically) ──
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.claude.settings.get().then((s: AppSettings | null) => {
      if (s) setAppSettings(s);
    });
  }, []);

  const updateAppSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const previousSettings = appSettings;
    setAppSettings((prev) => (prev ? { ...prev, ...patch } : null));
    try {
      await setAppSettingsChecked(patch);
    } catch (error) {
      try {
        setAppSettings((await window.claude.settings.get()) ?? previousSettings);
      } catch {
        setAppSettings(previousSettings);
      }
      toast.error(t("saveFailed"));
      throw error;
    }
  }, [appSettings, t]);

  // Escape key closes settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const renderSection = useCallback(() => {
    switch (activeSection) {
      case "general":
        return (
          <GeneralSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "account":
        return (
          <AccountSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "appearance":
        return (
          <AppearanceSettings
            glassSupported={glassSupported}
            macLiquidGlassSupported={macLiquidGlassSupported}
          />
        );
      case "notifications":
        return (
          <NotificationsSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "analytics":
        return (
          <AnalyticsSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "agents":
        return (
          <AgentSettings
            agents={agents}
            onSave={saveAgent}
            onDelete={deleteAgent}
          />
        );
      case "mcp":
        return <McpSettings />;
      case "wechat":
        return <WeChatSettings />;
      case "engines":
        return (
          <EngineSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "current-config":
        return <CurrentConfigSettings />;
      case "advanced":
        return (
          <AdvancedSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
            onReplayWelcome={onReplayWelcome}
          />
        );
      case "skills":
        return (
          <PlaceholderSection
            title={t("placeholder.skills.title")}
            description={t("placeholder.skills.description")}
            icon={Sparkles}
            comingSoon
          />
        );
      case "custom-agents":
        return (
          <PlaceholderSection
            title={t("placeholder.customAgents.title")}
            description={t("placeholder.customAgents.description")}
            icon={Users}
            comingSoon
          />
        );
      case "about":
        return <AboutSettings />;
      default:
        return null;
    }
  }, [activeSection, appSettings, updateAppSettings, agents, saveAgent, deleteAgent, glassSupported, macLiquidGlassSupported, onReplayWelcome]);

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden rounded-none bg-background">
      <div
        className={`drag-region flex h-[3.25rem] shrink-0 items-center border-b border-foreground/[0.06] px-4 ${macTitlebarInsetClass}`}
      >
        <span className="text-sm font-semibold leading-none text-foreground">{t("titlebar")}</span>

        <Button
          variant="ghost"
          size="icon"
          aria-label={t("close", { defaultValue: "Close" })}
          title={t("close", { defaultValue: "Close" })}
          className="no-drag ms-auto h-7 w-7 text-muted-foreground/60 hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Settings nav sidebar */}
        <div className="flex w-44 shrink-0 flex-col border-e border-foreground/[0.06]">
          {/* Nav items */}
          <nav className="flex flex-1 flex-col gap-0.5 px-1.5 py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] text-start transition-colors ${
                    isActive
                      ? "bg-foreground/[0.06] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{t(item.labelKey)}</span>
                  {item.comingSoon && (
                    <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium text-muted-foreground/70">
                      {t("nav.comingSoon")}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content area — centered container with max width */}
        <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
          <div className="flex h-full w-full max-w-3xl flex-col">
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
});
