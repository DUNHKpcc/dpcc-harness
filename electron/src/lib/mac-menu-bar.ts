import type { MenuItemConstructorOptions } from "electron";
import type { AccountOverview, AccountSubscription } from "@shared/types/account";
import type { AccountAuthSnapshot } from "@shared/types/account-auth";
import type { SessionMeta } from "@shared/lib/session-persistence";
import {
  formatAccountUsd,
  resolveAccountSubscription,
} from "@shared/lib/account-display";
import {
  formatTraySessionTitle,
  getSessionEngineLabel,
} from "./tray-menu";

export interface MacMenuBarData {
  auth: AccountAuthSnapshot;
  overview: AccountOverview | null;
  recentSessions: SessionMeta[];
  activeAgentCount: number;
  activeTerminalCount: number;
  openAtLogin: boolean;
  loginItemSupported: boolean;
  locale: string;
  supportsHeaders: boolean;
}

export interface MacMenuBarActions {
  newChat: () => void;
  openSettings: () => void;
  openSession: (projectId: string, sessionId: string) => void;
  recharge: () => void;
  setOpenAtLogin: (openAtLogin: boolean) => void;
  showApp: () => void;
  quit: () => void;
}

export function buildMacTrayTemplateBitmap(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = sourceWidth,
  targetHeight = sourceHeight,
): Buffer | null {
  if (
    sourceWidth <= 0
    || sourceHeight <= 0
    || targetWidth <= 0
    || targetHeight <= 0
    || source.length !== sourceWidth * sourceHeight * 4
  ) return null;

  const mask = new Uint8Array(sourceWidth * sourceHeight);
  let minX = sourceWidth;
  let minY = sourceHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const pixel = (y * sourceWidth + x) * 4;
      const alpha = source[pixel + 3];
      const luminance = Math.max(source[pixel], source[pixel + 1], source[pixel + 2]);
      const value = Math.round((luminance * alpha) / 255);
      mask[y * sourceWidth + x] = value;
      if (value <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const markWidth = maxX - minX + 1;
  const markHeight = maxY - minY + 1;
  const padding = Math.max(1, Math.round(Math.min(targetWidth, targetHeight) * 0.08));
  const scale = Math.min(
    (targetWidth - padding * 2) / markWidth,
    (targetHeight - padding * 2) / markHeight,
  );
  const renderedWidth = markWidth * scale;
  const renderedHeight = markHeight * scale;
  const offsetX = (targetWidth - renderedWidth) / 2;
  const offsetY = (targetHeight - renderedHeight) / 2;
  const output = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceTop = Math.max(minY, minY + (y - offsetY) / scale);
    const sourceBottom = Math.min(maxY + 1, minY + (y + 1 - offsetY) / scale);
    if (sourceBottom <= sourceTop) continue;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceLeft = Math.max(minX, minX + (x - offsetX) / scale);
      const sourceRight = Math.min(maxX + 1, minX + (x + 1 - offsetX) / scale);
      if (sourceRight <= sourceLeft) continue;

      let weightedAlpha = 0;
      let totalWeight = 0;
      for (let sourceY = Math.floor(sourceTop); sourceY < Math.ceil(sourceBottom); sourceY += 1) {
        const yWeight = Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY);
        if (yWeight <= 0) continue;
        for (let sourceX = Math.floor(sourceLeft); sourceX < Math.ceil(sourceRight); sourceX += 1) {
          const xWeight = Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX);
          if (xWeight <= 0) continue;
          const weight = xWeight * yWeight;
          weightedAlpha += mask[sourceY * sourceWidth + sourceX] * weight;
          totalWeight += weight;
        }
      }
      const targetPixel = (y * targetWidth + x) * 4;
      output[targetPixel + 3] = totalWeight > 0 ? Math.round(weightedAlpha / totalWeight) : 0;
    }
  }

  return output;
}

function isChinese(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function header(label: string, supportsHeaders: boolean): MenuItemConstructorOptions {
  return supportsHeaders
    ? { type: "header", label }
    : { label, enabled: false };
}

function formatRecentDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(timestamp);
}

function formatQuotaProgress(percent: number): string {
  const segmentCount = 12;
  const roundedPercent = Math.round(percent);
  const filledCount = Math.round((roundedPercent / 100) * segmentCount);
  return `${"━".repeat(filledCount)}${"─".repeat(segmentCount - filledCount)}  ${roundedPercent}%`;
}

export function buildMacMenuBarTemplate(
  data: MacMenuBarData,
  actions: MacMenuBarActions,
): MenuItemConstructorOptions[] {
  const zh = isChinese(data.locale);
  const connected = data.auth.status === "connected" || data.auth.status === "expiring";
  const accountName = connected
    ? data.auth.account?.displayName || "DPCC API"
    : zh ? "DPCC API 账户" : "DPCC API Account";
  const accountSublabel = connected
    ? data.auth.account?.maskedEmail || (zh ? "已连接" : "Connected")
    : zh ? "尚未连接" : "Not connected";
  const runtimeIdle = data.activeAgentCount === 0 && data.activeTerminalCount === 0;
  const runtimeLabel = runtimeIdle
    ? zh ? "没有正在运行的 Agent 或 Terminal" : "No Agent or Terminal is running"
    : zh
      ? `${data.activeAgentCount} 个 Agent，${data.activeTerminalCount} 个 Terminal`
      : `${data.activeAgentCount} Agent, ${data.activeTerminalCount} Terminal`;

  const recentItems: MenuItemConstructorOptions[] = data.recentSessions.length > 0
    ? data.recentSessions.map((session) => ({
        label: formatTraySessionTitle(
          session.title,
          zh ? "未命名对话" : "Untitled chat",
        ),
        sublabel: `${getSessionEngineLabel(session.engine)} · ${formatRecentDate(session.lastMessageAt, data.locale)}`,
        click: () => actions.openSession(session.projectId, session.id),
      }))
    : [{ label: zh ? "暂无最近对话" : "No recent chats", enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    header("Account", data.supportsHeaders),
    {
      label: accountName,
      sublabel: accountSublabel,
      click: actions.openSettings,
    },
  ];

  if (!connected) {
    template.push({
      label: zh ? "打开 PccAgent 登录" : "Open PccAgent to sign in",
      click: actions.openSettings,
    });
  }

  template.push(
    { type: "separator" },
    header("Running", data.supportsHeaders),
    { label: runtimeLabel, enabled: !runtimeIdle, click: runtimeIdle ? undefined : actions.showApp },
    { type: "separator" },
    header("Recent", data.supportsHeaders),
    ...recentItems,
  );

  if (connected) {
    const overviewSubscription: AccountSubscription | null =
      data.overview?.subscription && !("error" in data.overview.subscription)
        ? data.overview.subscription
        : null;
    const subscription = resolveAccountSubscription(overviewSubscription, data.auth.account);
    const expired = subscription?.state === "expired"
      || (subscription?.expiresAt !== null
        && subscription?.expiresAt !== undefined
        && subscription.expiresAt <= Date.now());
    const active = subscription?.state === "active" && !expired;
    const planName = subscription?.items.find((item) => item.name.trim())?.name
      || (active ? (zh ? "当前订阅" : "Current plan") : (zh ? "未订阅方案" : "No active plan"));
    const subscriptionStatus = active
      ? (zh ? "有效" : "Active")
      : expired ? (zh ? "已到期" : "Expired") : (zh ? "无订阅" : "No subscription");
    const balance = data.overview?.balance && !("error" in data.overview.balance)
      ? data.overview.balance
      : null;
    const quotaLabel = balance
      ? balance.unlimited
        ? (zh ? "额度：不限额" : "Quota: Unlimited")
        : (zh
            ? `额度：可用 ${formatAccountUsd(balance.remainingUsd)}`
            : `Quota: ${formatAccountUsd(balance.remainingUsd)} available`)
      : (zh ? "额度：暂无数据" : "Quota: Unavailable");
    const quotaPercent = balance && !balance.unlimited && balance.totalUsd > 0
      ? Math.max(0, Math.min(100, (balance.remainingUsd / balance.totalUsd) * 100))
      : null;

    template.push(
      { type: "separator" },
      header("Usage", data.supportsHeaders),
      {
        label: zh ? `订阅：${planName}` : `Subscription: ${planName}`,
        sublabel: subscriptionStatus,
        click: actions.openSettings,
      },
      {
        label: quotaLabel,
        sublabel: quotaPercent === null ? undefined : formatQuotaProgress(quotaPercent),
        click: actions.recharge,
      },
    );
  }

  template.push(
    { type: "separator" },
    { label: zh ? "新对话" : "New Chat", click: actions.newChat },
    { label: zh ? "显示 PccAgent" : "Show PccAgent", click: actions.showApp },
    { label: zh ? "账户与设置" : "Account & Settings", click: actions.openSettings },
    { type: "separator" },
    {
      type: "checkbox",
      label: zh ? "登录时启动" : "Open at Login",
      checked: data.openAtLogin,
      enabled: data.loginItemSupported,
      toolTip: data.loginItemSupported
        ? undefined
        : (zh ? "安装版 PccAgent 支持此设置" : "Available in the installed app"),
      click: (item) => actions.setOpenAtLogin(item.checked),
    },
    { label: zh ? "充值" : "Recharge", click: actions.recharge },
    { type: "separator" },
    { label: zh ? "退出 PccAgent" : "Quit PccAgent", click: actions.quit },
  );

  return template;
}
