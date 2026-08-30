import { useEffect, useState } from "react";
import { useGlassOrchestrator } from "@/hooks/useGlassOrchestrator";
import { useAccountBalanceAlert } from "@/hooks/useAccountBalanceAlert";
import { useNotifications } from "@/hooks/useNotifications";
import { reportError } from "@/lib/analytics/analytics";
import type { AccountBalanceAlertSettings, AppSettings, ChatSession, MacBackgroundEffect, NotificationSettings, PermissionRequest, SessionInfo, ThemeOption } from "@/types";
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
  onOpenSession?: (sessionId: string) => void;
}

export function useAppEnvironmentState(input: UseAppEnvironmentStateInput) {
  const [showSettings, setShowSettings] = useState<SettingsSection | false>(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [accountBalanceAlert, setAccountBalanceAlert] = useState<AccountBalanceAlertSettings | null>(null);
  const [devFillEnabled, setDevFillEnabled] = useState(false);
  const [jiraBoardEnabled, setJiraBoardEnabled] = useState(false);

  const { glassSupported, macLiquidGlassSupported, liveMacBackgroundEffect } = useGlassOrchestrator({
    macBackgroundEffect: input.macBackgroundEffect,
    setMacBackgroundEffect: input.setMacBackgroundEffect,
    transparency: input.transparency,
    theme: input.theme,
  });

  useEffect(() => {
    const applySettings = (settings: AppSettings) => {
      setNotificationSettings(settings.notifications);
      setAccountBalanceAlert(settings.accountBalanceAlert);
      setDevFillEnabled(import.meta.env.DEV && !!settings?.showDevFillInChatTitleBar);
      setJiraBoardEnabled(!!settings?.showJiraBoard);
    };
    void window.claude.settings.get()
      .then(applySettings)
      .catch((error) => reportError("APP_ENVIRONMENT_SETTINGS", error));
    return window.claude.settings.onChanged(applySettings);
  }, []);

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
      input.onOpenSession?.(sessionId);
    },
  });

  useAccountBalanceAlert({
    settings: accountBalanceAlert,
    isProcessing: input.isProcessing,
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
