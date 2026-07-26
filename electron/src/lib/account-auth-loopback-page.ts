export type AccountAuthorizationPageKind =
  | "success"
  | "cancelled"
  | "invalid-host"
  | "state-mismatch"
  | "invalid-response";

interface AccountAuthorizationPageOptions {
  kind: AccountAuthorizationPageKind;
  acceptLanguage?: string | string[];
}

type AccountAuthorizationPageLocale = "en" | "zh-CN" | "zh-TW";
type AccountAuthorizationPageTone = "success" | "cancelled" | "error";

interface AccountAuthorizationPageCopy {
  handoffLabel: string;
  browser: string;
  destinationCaption: string;
  footer: string;
  closeCue: string;
  states: Record<
    AccountAuthorizationPageKind,
    {
      status: string;
      title: string;
      message: string;
      browserCaption: string;
      destination: string;
      note: string;
    }
  >;
}

const pageTones: Record<
  AccountAuthorizationPageKind,
  AccountAuthorizationPageTone
> = {
  success: "success",
  cancelled: "cancelled",
  "invalid-host": "error",
  "state-mismatch": "error",
  "invalid-response": "error",
};

const pageThemeColors: Record<AccountAuthorizationPageTone, string> = {
  success: "#d97757",
  cancelled: "#a86f2d",
  error: "#b1483f",
};

const pageCopy: Record<
  AccountAuthorizationPageLocale,
  AccountAuthorizationPageCopy
> = {
  en: {
    handoffLabel: "Authorization handoff",
    browser: "Browser",
    destinationCaption: "Desktop app",
    footer: "Secure browser authorization",
    closeCue: "You can safely close this tab.",
    states: {
      success: {
        status: "Local handoff complete",
        title: "Authorization received",
        message:
          "PccAgent is securely completing setup. You can close this tab and continue in the app.",
        browserCaption: "Authorization response received",
        destination: "Continue in PccAgent",
        note: "This callback was delivered directly to PccAgent on this device.",
      },
      cancelled: {
        status: "No access was granted",
        title: "Authorization cancelled",
        message:
          "No changes were made. Return to PccAgent whenever you are ready.",
        browserCaption: "Authorization cancelled",
        destination: "Return to PccAgent",
        note: "No authorization credentials were delivered to PccAgent.",
      },
      "invalid-host": {
        status: "Connection could not be verified",
        title: "Authorization failed",
        message: "The callback host was invalid. Return to PccAgent and try again.",
        browserCaption: "Callback rejected",
        destination: "Return to PccAgent",
        note: "PccAgent rejected this callback before completing account setup.",
      },
      "state-mismatch": {
        status: "Connection could not be verified",
        title: "Authorization failed",
        message:
          "The authorization state did not match. Return to PccAgent and start again.",
        browserCaption: "Security check failed",
        destination: "Return to PccAgent",
        note: "PccAgent rejected this callback before completing account setup.",
      },
      "invalid-response": {
        status: "Connection could not be verified",
        title: "Authorization failed",
        message:
          "The callback response was invalid. Return to PccAgent and try again.",
        browserCaption: "Invalid callback response",
        destination: "Return to PccAgent",
        note: "PccAgent rejected this callback before completing account setup.",
      },
    },
  },
  "zh-CN": {
    handoffLabel: "授权交接状态",
    browser: "浏览器",
    destinationCaption: "桌面应用",
    footer: "安全浏览器授权",
    closeCue: "现在可以安全关闭此页面。",
    states: {
      success: {
        status: "本地授权交接完成",
        title: "授权已接收",
        message:
          "PccAgent 正在安全地完成账户连接。你可以关闭此页面，并返回应用继续使用。",
        browserCaption: "已收到授权响应",
        destination: "继续使用 PccAgent",
        note: "此授权回调已通过本机连接直接交付给 PccAgent。",
      },
      cancelled: {
        status: "未授予任何访问权限",
        title: "授权已取消",
        message: "未对账户进行任何更改。准备好后可返回 PccAgent 重新发起授权。",
        browserCaption: "授权已取消",
        destination: "返回 PccAgent",
        note: "没有任何授权凭据交付给 PccAgent。",
      },
      "invalid-host": {
        status: "无法验证连接",
        title: "授权失败",
        message: "授权回调的主机地址无效。请返回 PccAgent 后重试。",
        browserCaption: "回调已被拒绝",
        destination: "返回 PccAgent",
        note: "PccAgent 已拒绝此回调，账户连接尚未完成。",
      },
      "state-mismatch": {
        status: "无法验证连接",
        title: "授权失败",
        message: "授权状态校验失败。请返回 PccAgent 重新发起授权。",
        browserCaption: "安全校验失败",
        destination: "返回 PccAgent",
        note: "PccAgent 已拒绝此回调，账户连接尚未完成。",
      },
      "invalid-response": {
        status: "无法验证连接",
        title: "授权失败",
        message: "授权回调内容无效。请返回 PccAgent 后重试。",
        browserCaption: "回调内容无效",
        destination: "返回 PccAgent",
        note: "PccAgent 已拒绝此回调，账户连接尚未完成。",
      },
    },
  },
  "zh-TW": {
    handoffLabel: "授權交接狀態",
    browser: "瀏覽器",
    destinationCaption: "桌面應用程式",
    footer: "安全瀏覽器授權",
    closeCue: "現在可以安全關閉此頁面。",
    states: {
      success: {
        status: "本機授權交接完成",
        title: "已收到授權",
        message:
          "PccAgent 正在安全完成帳戶連線。你可以關閉此頁面，並返回應用程式繼續使用。",
        browserCaption: "已收到授權回應",
        destination: "繼續使用 PccAgent",
        note: "此授權回呼已透過本機連線直接交付給 PccAgent。",
      },
      cancelled: {
        status: "未授予任何存取權限",
        title: "授權已取消",
        message: "未變更帳戶。準備好後可返回 PccAgent 重新發起授權。",
        browserCaption: "授權已取消",
        destination: "返回 PccAgent",
        note: "未將任何授權憑證交付給 PccAgent。",
      },
      "invalid-host": {
        status: "無法驗證連線",
        title: "授權失敗",
        message: "授權回呼的主機位址無效。請返回 PccAgent 後重試。",
        browserCaption: "回呼已被拒絕",
        destination: "返回 PccAgent",
        note: "PccAgent 已拒絕此回呼，帳戶連線尚未完成。",
      },
      "state-mismatch": {
        status: "無法驗證連線",
        title: "授權失敗",
        message: "授權狀態驗證失敗。請返回 PccAgent 重新發起授權。",
        browserCaption: "安全驗證失敗",
        destination: "返回 PccAgent",
        note: "PccAgent 已拒絕此回呼，帳戶連線尚未完成。",
      },
      "invalid-response": {
        status: "無法驗證連線",
        title: "授權失敗",
        message: "授權回呼內容無效。請返回 PccAgent 後重試。",
        browserCaption: "回呼內容無效",
        destination: "返回 PccAgent",
        note: "PccAgent 已拒絕此回呼，帳戶連線尚未完成。",
      },
    },
  },
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[character] ?? character,
  );
}

export function renderAccountAuthorizationPage(
  options: AccountAuthorizationPageOptions,
): string {
  const acceptLanguage = Array.isArray(options.acceptLanguage)
    ? options.acceptLanguage.join(",")
    : (options.acceptLanguage ?? "");
  const languages = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find(
        (parameter) => parameter.trim().startsWith("q="),
      );
      const parsedQuality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      return {
        tag: tag.toLowerCase(),
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
        index,
      };
    })
    .filter((entry) => entry.quality > 0)
    .sort(
      (left, right) =>
        right.quality - left.quality || left.index - right.index,
    );
  const preferredLanguage = languages.find(
    (entry) =>
      entry.tag === "*"
      || entry.tag === "en"
      || entry.tag.startsWith("en-")
      || entry.tag === "zh"
      || entry.tag.startsWith("zh-"),
  );
  let locale: AccountAuthorizationPageLocale = "en";
  if (
    preferredLanguage
    && (
      preferredLanguage.tag === "zh"
      || preferredLanguage.tag.startsWith("zh-")
    )
  ) {
    const tag = preferredLanguage.tag;
    locale = (
      tag === "zh-tw"
      || tag.startsWith("zh-tw-")
      || tag === "zh-hk"
      || tag.startsWith("zh-hk-")
      || tag === "zh-mo"
      || tag.startsWith("zh-mo-")
      || tag === "zh-hant"
      || tag.startsWith("zh-hant-")
    )
      ? "zh-TW"
      : "zh-CN";
  }
  const tone = pageTones[options.kind];
  const copy = pageCopy[locale];
  const stateCopy = copy.states[options.kind];
  const title = escapeHtml(stateCopy.title);
  const message = escapeHtml(stateCopy.message);
  const themeColor = pageThemeColors[tone];

  return `<!doctype html>
<html lang="${locale}" class="is-${tone}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${themeColor}">
  <link rel="icon" href="data:,">
  <title>${title} | PccAgent</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #faf9f5;
      --surface: #f0eee7;
      --ink: #201e1b;
      --muted: #69635c;
      --line: #dedbd2;
      --accent: #d97757;
      --accent-soft: #f4e4dc;
      --accent-ink: #9c4d35;
      --mark-bg: #ffffff;
      --mark-ink: #181613;
    }

    .is-cancelled {
      --accent: #a86f2d;
      --accent-soft: #f2e6d5;
      --accent-ink: #744713;
    }

    .is-error {
      --accent: #b1483f;
      --accent-soft: #f3dfdc;
      --accent-ink: #822f29;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      min-height: 100%;
    }

    body {
      min-width: 280px;
      margin: 0;
      background: var(--page);
      color: var(--ink);
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .page {
      min-height: 100vh;
      min-height: 100svh;
      display: grid;
      grid-template-rows: auto 1fr auto;
      padding: 28px 36px 24px;
      overflow: hidden;
      position: relative;
    }

    .page::after {
      content: "";
      position: absolute;
      top: 0;
      right: 0;
      width: 9px;
      height: 100%;
      background: var(--accent);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 11px;
      width: fit-content;
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .brand-mark {
      display: block;
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
      filter: drop-shadow(0 5px 10px rgb(28 28 24 / 0.12));
    }

    main {
      width: min(720px, 100%);
      margin: auto;
      padding: 56px 0 44px;
    }

    .hero {
      display: grid;
      grid-template-columns: 112px minmax(0, 1fr);
      align-items: center;
      gap: 38px;
    }

    .status-visual {
      width: 112px;
      height: 112px;
      display: grid;
      place-items: center;
      position: relative;
    }

    .status-visual::before,
    .status-visual::after {
      content: "";
      position: absolute;
      border: 1px solid var(--accent);
      border-radius: 50%;
      opacity: 0.22;
    }

    .status-visual::before {
      inset: 0;
      animation: ring-in 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .status-visual::after {
      inset: 14px;
      opacity: 0.4;
      animation: ring-in 700ms 80ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .status-symbol {
      width: 60px;
      height: 60px;
      display: grid;
      place-items: center;
      position: relative;
      z-index: 1;
      border-radius: 50%;
      background: var(--accent);
      color: #ffffff;
      box-shadow: 0 12px 30px rgb(121 63 43 / 0.2);
      animation: symbol-in 520ms 140ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .status-symbol svg {
      width: 29px;
      height: 29px;
      stroke: currentColor;
      stroke-width: 2.25;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    .status-symbol .check {
      stroke-dasharray: 28;
      stroke-dashoffset: 28;
      animation: draw-check 420ms 440ms ease-out forwards;
    }

    .is-cancelled .status-symbol .check,
    .is-error .status-symbol .check {
      display: none;
    }

    .status-symbol .cross {
      display: none;
    }

    .is-cancelled .status-symbol .cross,
    .is-error .status-symbol .cross {
      display: block;
    }

    .eyebrow {
      margin: 0 0 10px;
      color: var(--accent-ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      font-weight: 750;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 600px;
      margin: 0;
      font-size: 50px;
      font-weight: 500;
      line-height: 1.02;
      letter-spacing: 0;
      text-wrap: balance;
    }

    .message {
      max-width: 560px;
      margin: 18px 0 0;
      color: var(--muted);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 17px;
      line-height: 1.65;
      text-wrap: pretty;
    }

    .handoff {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 168px minmax(0, 1fr);
      align-items: center;
      margin-top: 52px;
      padding: 24px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      animation: content-in 600ms 260ms ease-out both;
    }

    .endpoint {
      display: flex;
      align-items: center;
      gap: 13px;
      min-width: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .endpoint:last-child {
      justify-content: flex-end;
      text-align: right;
    }

    .endpoint-icon {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .endpoint-icon svg {
      width: 21px;
      height: 21px;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    .endpoint-title {
      display: block;
      overflow-wrap: anywhere;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.3;
    }

    .endpoint-caption {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .connector {
      height: 16px;
      margin: 0 20px;
      position: relative;
    }

    .connector-line {
      position: absolute;
      top: 7px;
      left: 0;
      width: 100%;
      height: 1px;
      background: var(--line);
    }

    .connector-line::after {
      content: "";
      position: absolute;
      top: -2px;
      right: 0;
      width: 5px;
      height: 5px;
      border-top: 1px solid var(--accent);
      border-right: 1px solid var(--accent);
      transform: rotate(45deg);
    }

    .connector-dot {
      position: absolute;
      top: 4px;
      left: 0;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 4px var(--accent-soft);
      animation: handoff 1800ms 700ms cubic-bezier(0.45, 0, 0.2, 1) infinite;
    }

    .is-cancelled .connector-dot,
    .is-error .connector-dot {
      left: calc(50% - 4px);
      animation: none;
    }

    .note {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 18px 0 0;
      color: var(--muted);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.5;
      animation: content-in 600ms 360ms ease-out both;
    }

    .note svg {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      margin-top: 1px;
      stroke: var(--accent);
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding-right: 16px;
      color: var(--muted);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      line-height: 1.4;
    }

    .close-cue {
      color: var(--ink);
      font-weight: 650;
    }

    @keyframes symbol-in {
      from {
        opacity: 0;
        transform: scale(0.72) rotate(-8deg);
      }
      to {
        opacity: 1;
        transform: scale(1) rotate(0);
      }
    }

    @keyframes ring-in {
      from {
        opacity: 0;
        transform: scale(0.72);
      }
    }

    @keyframes draw-check {
      to {
        stroke-dashoffset: 0;
      }
    }

    @keyframes content-in {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
    }

    @keyframes handoff {
      0% {
        left: 0;
        opacity: 0;
      }
      12%,
      74% {
        opacity: 1;
      }
      88%,
      100% {
        left: calc(100% - 7px);
        opacity: 0;
      }
    }

    @media (max-width: 640px) {
      .page {
        padding: 22px 22px 20px;
      }

      .page::after {
        width: 6px;
      }

      main {
        padding: 40px 0 34px;
      }

      .hero {
        grid-template-columns: 1fr;
        gap: 25px;
      }

      .status-visual {
        width: 88px;
        height: 88px;
      }

      .status-symbol {
        width: 48px;
        height: 48px;
      }

      .status-symbol svg {
        width: 24px;
        height: 24px;
      }

      h1 {
        font-size: 38px;
      }

      .message {
        margin-top: 14px;
        font-size: 16px;
      }

      .handoff {
        grid-template-columns: 1fr;
        gap: 18px;
        margin-top: 38px;
        padding: 21px 0;
      }

      .endpoint:last-child {
        justify-content: flex-start;
        text-align: left;
      }

      .endpoint:last-child .endpoint-icon {
        order: -1;
      }

      .connector {
        width: 16px;
        height: 42px;
        margin: -5px 0 -5px 14px;
      }

      .connector-line {
        top: 0;
        left: 7px;
        width: 1px;
        height: 100%;
      }

      .connector-line::after {
        top: auto;
        right: -2px;
        bottom: 0;
        transform: rotate(135deg);
      }

      .connector-dot {
        top: 0;
        left: 4px;
        animation-name: handoff-mobile;
      }

      .is-cancelled .connector-dot,
      .is-error .connector-dot {
        top: calc(50% - 4px);
        left: 4px;
      }

      footer {
        align-items: flex-start;
        flex-direction: column;
        gap: 5px;
      }
    }

    @keyframes handoff-mobile {
      0% {
        top: 0;
        opacity: 0;
      }
      12%,
      74% {
        opacity: 1;
      }
      88%,
      100% {
        top: calc(100% - 7px);
        opacity: 0;
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --page: #191816;
        --surface: #27241f;
        --ink: #f2f0e8;
        --muted: #bdb5aa;
        --line: #403b35;
        --accent: #e18a6d;
        --accent-soft: #4a3027;
        --accent-ink: #f0a68b;
        --mark-bg: #f2f0e8;
        --mark-ink: #121310;
      }

      .is-cancelled {
        --accent: #d7a85d;
        --accent-soft: #46371f;
        --accent-ink: #e6bd7c;
      }

      .is-error {
        --accent: #e17d73;
        --accent-soft: #4a2927;
        --accent-ink: #eea199;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 1ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="brand" aria-label="PccAgent">
        <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
          <rect x="1.5" y="1.5" width="61" height="61" rx="16" fill="var(--mark-bg)" stroke="var(--line)" />
          <circle cx="32" cy="32" r="25" fill="var(--mark-ink)" />
          <rect x="21" y="19.5" width="9" height="26" rx="3.2" fill="var(--mark-bg)" />
          <circle cx="38" cy="24.5" r="4.8" fill="var(--mark-bg)" />
          <path d="M33 33.5a12.5 12.5 0 0 1 12.5 12.5H33z" fill="var(--mark-bg)" />
        </svg>
        <span>PccAgent</span>
      </div>
    </header>

    <main>
      <section class="hero" aria-labelledby="authorization-title">
        <div class="status-visual" aria-hidden="true">
          <span class="status-symbol">
            <svg viewBox="0 0 32 32">
              <path class="check" d="m8 16.5 5.3 5.3L24.5 10.5" />
              <path class="cross" d="m10.5 10.5 11 11m0-11-11 11" />
            </svg>
          </span>
        </div>
        <div>
          <p class="eyebrow">${escapeHtml(stateCopy.status)}</p>
          <h1 id="authorization-title">${title}</h1>
          <p class="message">${message}</p>
        </div>
      </section>

      <section class="handoff" aria-label="${escapeHtml(copy.handoffLabel)}">
        <div class="endpoint">
          <span class="endpoint-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M8 21h8M12 18v3" />
            </svg>
          </span>
          <span>
            <span class="endpoint-title">${escapeHtml(copy.browser)}</span>
            <span class="endpoint-caption">${escapeHtml(stateCopy.browserCaption)}</span>
          </span>
        </div>

        <div class="connector" aria-hidden="true">
          <span class="connector-line"></span>
          <span class="connector-dot"></span>
        </div>

        <div class="endpoint">
          <span>
            <span class="endpoint-title">${escapeHtml(stateCopy.destination)}</span>
            <span class="endpoint-caption">${escapeHtml(copy.destinationCaption)}</span>
          </span>
          <span class="endpoint-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M8.5 15.5v-7M15.5 15.5a7 7 0 0 0-7-7M15.5 8.5h.01" />
            </svg>
          </span>
        </div>
      </section>

      <p class="note">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
        </svg>
        <span>${escapeHtml(stateCopy.note)}</span>
      </p>
    </main>

    <footer>
      <span>${escapeHtml(copy.footer)}</span>
      <span class="close-cue">${escapeHtml(copy.closeCue)}</span>
    </footer>
  </div>
</body>
</html>`;
}
