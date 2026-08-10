import fs from "node:fs";
import path from "node:path";

export type AccountAuthorizationPageKind =
  | "success"
  | "cancelled"
  | "invalid-host"
  | "state-mismatch"
  | "invalid-response";

export type AccountAuthorizationPageTheme = "light" | "dark";

interface AccountAuthorizationPageOptions {
  kind: AccountAuthorizationPageKind;
  acceptLanguage?: string | string[];
  theme?: AccountAuthorizationPageTheme;
}

type AccountAuthorizationPageLocale = "en" | "zh-CN" | "zh-TW";
type AccountAuthorizationPageTone = "success" | "cancelled" | "error";

interface AccountAuthorizationPageCopy {
  closeCue: string;
  states: Record<
    AccountAuthorizationPageKind,
    {
      title: string;
      message: string;
      note?: string;
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
    closeCue: "You can safely close this tab",
    states: {
      success: {
        title: "Authorization successful",
        message: "Return to PccAgent to continue",
      },
      cancelled: {
        title: "Authorization cancelled",
        message:
          "No changes were made. Return to PccAgent whenever you are ready.",
        note: "No authorization credentials were delivered to PccAgent.",
      },
      "invalid-host": {
        title: "Authorization failed",
        message: "The callback host was invalid. Return to PccAgent and try again.",
        note: "PccAgent rejected this callback before completing account setup.",
      },
      "state-mismatch": {
        title: "Authorization failed",
        message:
          "The authorization state did not match. Return to PccAgent and start again.",
        note: "PccAgent rejected this callback before completing account setup.",
      },
      "invalid-response": {
        title: "Authorization failed",
        message:
          "The callback response was invalid. Return to PccAgent and try again.",
        note: "PccAgent rejected this callback before completing account setup.",
      },
    },
  },
  "zh-CN": {
    closeCue: "现在可以安全关闭此页面",
    states: {
      success: {
        title: "授权成功",
        message: "请返回 PccAgent 继续使用",
      },
      cancelled: {
        title: "授权已取消",
        message: "未对账户进行任何更改。准备好后可返回 PccAgent 重新发起授权。",
        note: "没有任何授权凭据交付给 PccAgent。",
      },
      "invalid-host": {
        title: "授权失败",
        message: "授权回调的主机地址无效。请返回 PccAgent 后重试。",
        note: "PccAgent 已拒绝此回调，账户连接尚未完成。",
      },
      "state-mismatch": {
        title: "授权失败",
        message: "授权状态校验失败。请返回 PccAgent 重新发起授权。",
        note: "PccAgent 已拒绝此回调，账户连接尚未完成。",
      },
      "invalid-response": {
        title: "授权失败",
        message: "授权回调内容无效。请返回 PccAgent 后重试。",
        note: "PccAgent 已拒绝此回调，账户连接尚未完成。",
      },
    },
  },
  "zh-TW": {
    closeCue: "現在可以安全關閉此頁面",
    states: {
      success: {
        title: "授權成功",
        message: "請返回 PccAgent 繼續使用",
      },
      cancelled: {
        title: "授權已取消",
        message: "未變更帳戶。準備好後可返回 PccAgent 重新發起授權。",
        note: "未將任何授權憑證交付給 PccAgent。",
      },
      "invalid-host": {
        title: "授權失敗",
        message: "授權回呼的主機位址無效。請返回 PccAgent 後重試。",
        note: "PccAgent 已拒絕此回呼，帳戶連線尚未完成。",
      },
      "state-mismatch": {
        title: "授權失敗",
        message: "授權狀態驗證失敗。請返回 PccAgent 重新發起授權。",
        note: "PccAgent 已拒絕此回呼，帳戶連線尚未完成。",
      },
      "invalid-response": {
        title: "授權失敗",
        message: "授權回呼內容無效。請返回 PccAgent 後重試。",
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

let cachedProjectLogoDataUrl: string | null = null;

function projectLogoDataUrl(): string {
  if (cachedProjectLogoDataUrl !== null) return cachedProjectLogoDataUrl;

  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const candidates = [
    path.resolve(process.cwd(), "public/icon.png"),
    path.resolve(__dirname, "../../public/icon.png"),
    path.resolve(__dirname, "../../dist/icon.png"),
    ...(resourcesPath
      ? [path.resolve(resourcesPath, "pcc-agent-logo.png")]
      : []),
  ];
  for (const candidate of new Set(candidates)) {
    try {
      cachedProjectLogoDataUrl =
        `data:image/png;base64,${fs.readFileSync(candidate).toString("base64")}`;
      return cachedProjectLogoDataUrl;
    } catch {
      // Try the next development, asar, or extraResources location.
    }
  }

  // The callback page must remain usable even if a broken package omitted its logo.
  cachedProjectLogoDataUrl =
    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  return cachedProjectLogoDataUrl;
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
  const themeClass = options.theme ? ` theme-${options.theme}` : "";
  const logoDataUrl = projectLogoDataUrl();
  const note = stateCopy.note
    ? `<p class="note">${escapeHtml(stateCopy.note)}</p>`
    : "";

  return `<!doctype html>
<html lang="${locale}" class="is-${tone}${themeClass}">
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
      --ink: #201e1b;
      --muted: #69635c;
      --line: #dedbd2;
      --accent: #d97757;
      --accent-soft: #f4e4dc;
    }

    .is-cancelled {
      --accent: #a86f2d;
      --accent-soft: #f2e6d5;
    }

    .is-error {
      --accent: #b1483f;
      --accent-soft: #f3dfdc;
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
      min-height: 100vh;
      min-height: 100svh;
      display: grid;
      place-items: center;
      margin: 0;
      padding: 32px 24px;
      background: var(--page);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .page {
      width: min(440px, 100%);
    }

    main {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      margin-bottom: 32px;
      color: var(--ink);
      font-size: 14px;
      font-weight: 700;
    }

    .brand-mark {
      display: block;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
    }

    .hero {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .hero > div:last-child {
      width: 100%;
    }

    .status-visual {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      margin: 0 auto 20px;
    }

    .status-symbol {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent);
    }

    .status-symbol svg {
      width: 24px;
      height: 24px;
      stroke: currentColor;
      stroke-width: 2.25;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    .status-symbol .cross {
      display: none;
    }

    .is-cancelled .status-symbol .check,
    .is-error .status-symbol .check {
      display: none;
    }

    .is-cancelled .status-symbol .cross,
    .is-error .status-symbol .cross {
      display: block;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 650;
      line-height: 1.25;
      letter-spacing: 0;
      text-wrap: balance;
    }

    .message {
      max-width: 420px;
      margin: 12px auto 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.6;
      text-wrap: pretty;
    }

    .note {
      width: 100%;
      margin: 24px 0 0;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .close-cue {
      width: 100%;
      display: block;
      margin-top: 24px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    @media (prefers-color-scheme: dark) {
      :root:not(.theme-light) {
        --page: #191816;
        --ink: #f2f0e8;
        --muted: #bdb5aa;
        --line: #403b35;
        --accent: #e18a6d;
        --accent-soft: #4a3027;
      }

      :root:not(.theme-light).is-cancelled {
        --accent: #d7a85d;
        --accent-soft: #46371f;
      }

      :root:not(.theme-light).is-error {
        --accent: #e17d73;
        --accent-soft: #4a2927;
      }
    }

    :root.theme-dark {
      color-scheme: dark;
      --page: #191816;
      --ink: #f2f0e8;
      --muted: #bdb5aa;
      --line: #403b35;
      --accent: #e18a6d;
      --accent-soft: #4a3027;
    }

    :root.theme-dark.is-cancelled {
      --accent: #d7a85d;
      --accent-soft: #46371f;
    }

    :root.theme-dark.is-error {
      --accent: #e17d73;
      --accent-soft: #4a2927;
    }

    :root.theme-light {
      color-scheme: light;
    }

    @media (max-width: 480px) {
      body {
        padding: 24px 20px;
      }

      .brand {
        margin-bottom: 28px;
      }

      h1 {
        font-size: 25px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <main aria-labelledby="authorization-title">
      <div class="brand" aria-label="PccAgent">
        <img
          class="brand-mark"
          src="${logoDataUrl}"
          alt=""
          draggable="false"
          data-project-logo
        >
        <span>PccAgent</span>
      </div>
      <section class="hero">
        <div class="status-visual" aria-hidden="true">
          <span class="status-symbol">
            <svg viewBox="0 0 32 32">
              <path class="check" d="m8 16.5 5.3 5.3L24.5 10.5" />
              <path class="cross" d="m10.5 10.5 11 11m0-11-11 11" />
            </svg>
          </span>
        </div>
        <div>
          <h1 id="authorization-title">${title}</h1>
          <p class="message">${message}</p>
        </div>
      </section>
      ${note}
      <span class="close-cue">${escapeHtml(copy.closeCue)}</span>
    </main>
  </div>
</body>
</html>`;
}
