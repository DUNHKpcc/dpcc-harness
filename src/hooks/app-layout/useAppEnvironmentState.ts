import { useEffect, useState } from "react";
import { useGlassOrchestrator } from "@/hooks/useGlassOrchestrator";
import { useNotifications } from "@/hooks/useNotifications";
import type { ChatSession, MacBackgroundEffect, NotificationSettings, PermissionRequest, SessionInfo, ThemeOption } from "@/types";
import type { SettingsSection } from "@/components/SettingsView";

interface UseAppEnvironmentStateInput {
  macBackgroundEffect: MacBackgroundEffect;
  setMacBackgroundEffect: (value: MacBackgroundEffect) => void;
  transparency: boolean;
  theme: ThemeOption;
  pendingPermission: PermissionRequest | null;
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  sessionInfo: SessionInfo | null;
  isProcessing: boolean;
  visibleSessionIds: readonly string[];
  setPlanMode: (enabled: boolean) => void;
  onOpenSession?: (sessionId: string) => void;
}

export function useAppEnvironmentState(input: UseAppEnvironmentStateInput) {
  const [showSettings, setShowSettings] = useState<SettingsSection | false>(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [devFillEnabled, setDevFillEnabled] = useState(false);
  const [jiraBoardEnabled, setJiraBoardEnabled] = useState(false);

  const { glassSupported, macLiquidGlassSupported, liveMacBackgroundEffect } = useGlassOrchestrator({
    macBackgroundEffect: input.macBackgroundEffect,
    setMacBackgroundEffect: input.setMacBackgroundEffect,
    transparency: input.transparency,
    theme: input.theme,
  });

  useEffect(() => {
    window.claude.settings.get().then((settings) => {
      if (settings?.notifications) {
        setNotificationSettings(settings.notifications as NotificationSettings);
      }
      setDevFillEnabled(import.meta.env.DEV && !!settings?.showDevFillInChatTitleBar);
      setJiraBoardEnabled(!!settings?.showJiraBoard);
    });
  }, [showSettings]);

  useNotifications({
    pendingPermission: input.pendingPermission,
    notificationSettings,
    activeSessionId: input.activeSessionId,
    activeSession: input.activeSession,
    sessionInfo: input.sessionInfo,
    isProcessing: input.isProcessing,
    visibleSessionIds: input.visibleSessionIds,
    onOpenSession: (sessionId) => {
      setShowSettings(false);
      input.setPlanMode(false);
      input.onOpenSession?.(sessionId);
    },
  });

  useEffect(() => {
    if (!showSettings) window.dispatchEvent(new Event("resize"));
  }, [showSettings]);

  useEffect(() => {
    setChatSearchOpen(false);
  }, [input.activeSessionId]);

  return {
    showSettings,
    setShowSettings,
    scrollToMessageId,
    setScrollToMessageId,
    chatSearchOpen,
    setChatSearchOpen,
    glassSupported,
    macLiquidGlassSupported,
    liveMacBackgroundEffect,
    devFillEnabled,
    jiraBoardEnabled,
  };
}
