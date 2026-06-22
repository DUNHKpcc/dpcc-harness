import { memo, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Smartphone, QrCode, LogOut, RefreshCw, ShieldAlert, ScrollText } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type {
  WeChatBridgeState,
  WeChatBridgeConfig,
  WeChatBridgeEvent,
  WeChatTool,
  WeChatPermissionMode,
  WeChatLoginStatus,
  Project,
} from "@/types";

const MAX_ACTIVITY = 50;

interface ActivityLine {
  id: number;
  level: "info" | "warn" | "error";
  text: string;
}

export const WeChatSettings = memo(function WeChatSettings() {
  const { t } = useTranslation("settings");
  const [state, setState] = useState<WeChatBridgeState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<WeChatLoginStatus | null>(null);
  const [activity, setActivity] = useState<ActivityLine[]>([]);
  const [allowedUsersText, setAllowedUsersText] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const activityIdRef = useRef(0);

  const pushActivity = useCallback((level: ActivityLine["level"], text: string) => {
    setActivity((prev) => {
      const next = [...prev, { id: activityIdRef.current++, level, text }];
      return next.length > MAX_ACTIVITY ? next.slice(next.length - MAX_ACTIVITY) : next;
    });
  }, []);

  // Initial load + live event subscription.
  useEffect(() => {
    let active = true;
    window.claude.wechat.getState().then((s) => {
      if (!active) return;
      setState(s);
      setAllowedUsersText(s.config.allowedUsers.join("\n"));
    });
    window.claude.projects.list().then((list) => {
      if (active) setProjects(list);
    });

    const unsubscribe = window.claude.wechat.onEvent((event: WeChatBridgeEvent) => {
      switch (event.type) {
        case "state":
          setState(event.state);
          break;
        case "qrcode":
          QRCode.toDataURL(event.content, { width: 220, margin: 1 })
            .then(setQrDataUrl)
            .catch(() => setQrDataUrl(null));
          break;
        case "login-status":
          setLoginStatus(event.status);
          break;
        case "login-success":
          setQrDataUrl(null);
          setLoginStatus(null);
          break;
        case "login-error":
          setQrDataUrl(null);
          setLoginStatus(null);
          // A user cancellation isn't an error — only surface genuine failures.
          if (!event.cancelled) pushActivity("error", event.message);
          break;
        case "activity":
          pushActivity(event.level, event.message);
          break;
        case "message":
          pushActivity(
            "info",
            `${event.direction === "in" ? "↘" : "↖"} ${event.tool ? `[${event.tool}] ` : ""}${event.preview}`,
          );
          break;
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [pushActivity]);

  const patchConfig = useCallback(
    async (patch: Partial<WeChatBridgeConfig>) => {
      setState((prev) => (prev ? { ...prev, config: { ...prev.config, ...patch } } : prev));
      const res = await window.claude.wechat.setConfig(patch);
      if (res.ok && res.state) {
        setState(res.state);
      } else {
        // Patch rejected — roll the optimistic UI back to the persisted truth.
        if (res.error) pushActivity("error", res.error);
        const fresh = await window.claude.wechat.getState();
        setState(fresh);
      }
    },
    [pushActivity],
  );

  const handleLogin = useCallback(() => {
    setQrDataUrl(null);
    setLoginStatus("wait");
    void window.claude.wechat.login();
  }, []);

  const handleCancelLogin = useCallback(() => {
    void window.claude.wechat.cancelLogin();
    setQrDataUrl(null);
    setLoginStatus(null);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      const next = await window.claude.wechat.logout();
      setState(next);
    } catch (err) {
      pushActivity("error", err instanceof Error ? err.message : String(err));
    } finally {
      setQrDataUrl(null);
      setLoginStatus(null);
    }
  }, [pushActivity]);

  const handleReconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      // State updates (status/running) arrive via the onEvent "state" subscription;
      // only surface an explicit failure here.
      const result = await window.claude.wechat.reconnect();
      if (!result.ok && result.error) pushActivity("error", result.error);
    } catch (err) {
      pushActivity("error", err instanceof Error ? err.message : String(err));
    } finally {
      setReconnecting(false);
    }
  }, [pushActivity]);

  const commitAllowedUsers = useCallback(() => {
    const list = allowedUsersText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    void patchConfig({ allowedUsers: list });
  }, [allowedUsersText, patchConfig]);

  if (!state) {
    return (
      <div className="flex h-full flex-col">
        <SettingsHeader title={t("wechat.title")} description={t("wechat.description")} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("wechat.loading")}
        </div>
      </div>
    );
  }

  const { config, hasCredentials, status, botUserId } = state;
  const isConnecting = status === "connecting" || loginStatus !== null;
  const allowAllUnsafe = config.allowedUsers.length === 0;

  const toolOptions: Array<{ value: WeChatTool; label: string }> = [
    { value: "claude", label: "Claude Code" },
    { value: "codex", label: "Codex" },
  ];
  const modeOptions: Array<{ value: WeChatPermissionMode; label: string }> = [
    { value: "safe", label: t("wechat.mode.safe") },
    { value: "auto", label: t("wechat.mode.auto") },
    { value: "plan", label: t("wechat.mode.plan") },
  ];

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("wechat.title")}
        description={t("wechat.description")}
        actions={<StatusBadge status={status} t={t} />}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Connection ── */}
          <SettingsSection icon={Smartphone} label={t("wechat.connection")} first>
            {!hasCredentials ? (
              <div className="py-2">
                {qrDataUrl ? (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <img
                      src={qrDataUrl}
                      alt="WeChat QR"
                      className="rounded-lg border border-foreground/10 bg-white p-2"
                      width={220}
                      height={220}
                    />
                    <p className="text-sm text-muted-foreground">{loginStatusLabel(loginStatus, t)}</p>
                    <Button variant="ghost" size="sm" onClick={handleCancelLogin}>
                      {t("wechat.cancelLogin")}
                    </Button>
                  </div>
                ) : isConnecting ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <p className="text-sm text-muted-foreground">{t("wechat.requestingQr")}</p>
                    <Button variant="ghost" size="sm" onClick={handleCancelLogin}>
                      {t("wechat.cancelLogin")}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3 py-2">
                    <p className="text-sm text-muted-foreground">{t("wechat.notLoggedIn")}</p>
                    <Button onClick={handleLogin} className="gap-2">
                      <QrCode className="h-4 w-4" />
                      {t("wechat.login")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <SettingRow label={t("wechat.loggedIn")} description={botUserId ? `ID: ${botUserId}` : undefined}>
                  <div className="flex items-center gap-1.5">
                    {/* Shown whenever the bridge is enabled — it's the recovery path
                        for both a flaky live connection and a failed/dropped start. */}
                    {config.enabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleReconnect}
                        disabled={reconnecting}
                      >
                        <RefreshCw className={`h-4 w-4 ${reconnecting ? "animate-spin" : ""}`} />
                        {t("wechat.reconnect")}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="gap-1.5 text-destructive" onClick={handleLogout}>
                      <LogOut className="h-4 w-4" />
                      {t("wechat.logout")}
                    </Button>
                  </div>
                </SettingRow>
                <SettingRow label={t("wechat.enableLabel")} description={t("wechat.enableDesc")}>
                  <Switch
                    checked={config.enabled}
                    onCheckedChange={(checked) => void patchConfig({ enabled: checked })}
                  />
                </SettingRow>
              </>
            )}
          </SettingsSection>

          {/* ── Behavior ── */}
          <SettingsSection label={t("wechat.behavior")}>
            <SettingRow label={t("wechat.defaultTool")} description={t("wechat.defaultToolDesc")}>
              <SettingsSelect
                value={config.defaultTool}
                onValueChange={(v) => void patchConfig({ defaultTool: v })}
                options={toolOptions}
              />
            </SettingRow>
            <SettingRow label={t("wechat.permissionMode")} description={t("wechat.permissionModeDesc")}>
              <SettingsSelect
                value={config.permissionMode}
                onValueChange={(v) => void patchConfig({ permissionMode: v })}
                options={modeOptions}
              />
            </SettingRow>
            <SettingRow label={t("wechat.workDir")} description={t("wechat.workDirDesc")}>
              <Input
                defaultValue={config.workDir}
                placeholder={t("wechat.workDirPlaceholder")}
                className="w-64"
                onBlur={(e) => void patchConfig({ workDir: e.target.value.trim() })}
              />
            </SettingRow>
            <SettingRow label="项目" description="微信对话归属的项目（自动则按工作目录绑定）">
              <SettingsSelect
                value={config.projectId || "__auto__"}
                onValueChange={(v) => void patchConfig({ projectId: v === "__auto__" ? "" : v })}
                options={[
                  { value: "__auto__", label: "自动（按工作目录）" },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </SettingRow>
            <SettingRow label={t("wechat.model")} description={t("wechat.modelDesc")}>
              <Input
                defaultValue={config.model}
                placeholder={t("wechat.modelPlaceholder")}
                className="w-40"
                onBlur={(e) => void patchConfig({ model: e.target.value.trim() })}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Access control ── */}
          <SettingsSection icon={ShieldAlert} label={t("wechat.access")}>
            <p className="mb-2 text-xs text-muted-foreground">{t("wechat.allowedUsersDesc")}</p>
            <textarea
              value={allowedUsersText}
              onChange={(e) => setAllowedUsersText(e.target.value)}
              onBlur={commitAllowedUsers}
              placeholder={t("wechat.allowedUsersPlaceholder")}
              rows={3}
              className="w-full resize-y rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-foreground/20"
            />
            {allowAllUnsafe && (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-[11px] text-amber-600 dark:text-amber-400">
                <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{t("wechat.allowAllWarning")}</span>
              </div>
            )}
          </SettingsSection>

          {/* ── Activity feed ── */}
          <SettingsSection icon={ScrollText} label={t("wechat.activity")}>
            {activity.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">{t("wechat.activityEmpty")}</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md bg-foreground/[0.02] p-2.5">
                {activity.map((line) => (
                  <p
                    key={line.id}
                    className={`font-mono text-[11px] break-all ${
                      line.level === "error"
                        ? "text-destructive"
                        : line.level === "warn"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});

// ── Helpers ──

function StatusBadge({
  status,
  t,
}: {
  status: WeChatBridgeState["status"];
  t: (key: string) => string;
}) {
  const map: Record<WeChatBridgeState["status"], { dot: string; label: string }> = {
    disconnected: { dot: "bg-muted-foreground/50", label: t("wechat.status.disconnected") },
    connecting: { dot: "bg-amber-500", label: t("wechat.status.connecting") },
    connected: { dot: "bg-green-500", label: t("wechat.status.connected") },
    error: { dot: "bg-destructive", label: t("wechat.status.error") },
  };
  const { dot, label } = map[status];
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 py-1 text-xs text-foreground/80">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function loginStatusLabel(status: WeChatLoginStatus | null, t: (key: string) => string): string {
  switch (status) {
    case "scaned":
      return t("wechat.loginStatus.scaned");
    case "confirmed":
      return t("wechat.loginStatus.confirmed");
    case "expired":
      return t("wechat.loginStatus.expired");
    default:
      return t("wechat.loginStatus.wait");
  }
}
