# 品牌替换 & Codex 内置方案

## 一、Codex 二进制内置（方案一：构建时打包）

### 目标

将 Codex 原生二进制作为 `extraResources` 打入 Electron 安装包，用户无需网络即可使用 Codex。

### 当前 Codex 平台包数据

| 平台标签 | npm 包 | 压缩大小 | 解压大小 | 内含文件 |
|----------|--------|----------|----------|----------|
| `darwin-arm64` | `@openai/codex@darwin-arm64` | ~90 MB | ~230 MB | `codex` + `rg` + `zsh` |
| `darwin-x64` | `@openai/codex@darwin-x64` | ~90 MB | ~230 MB | 同上 |
| `linux-arm64` | `@openai/codex@linux-arm64` | ~90 MB | ~230 MB | `codex` + `rg` |
| `linux-x64` | `@openai/codex@linux-x64` | ~90 MB | ~230 MB | `codex` + `rg` |
| `win32-x64` | `@openai/codex@win32-x64` | ~90 MB | ~230 MB | `codex.exe` + `rg.exe` |
| `win32-arm64` | `@openai/codex@win32-arm64` | ~90 MB | ~230 MB | `codex.exe` + `rg.exe` |

> 每个平台包含 3 个文件：Codex 主二进制（~225MB）、ripgrep（~4MB）、zsh（macOS 专用，~720KB）。

### 实现步骤

#### 1. 创建构建脚本 `scripts/bundle-codex.js`

构建前执行，根据目标平台下载对应 Codex 包并解压到 `build/codex-vendor/`：

```
scripts/bundle-codex.js
├── 读取目标平台 (process.env.TARGET_PLATFORM 或当前平台)
├── npm pack @openai/codex@<platform-tag> --pack-destination <tmpdir>
├── tar xzf <tgz> -C <tmpdir>
├── 复制 vendor/<triple>/bin/codex → build/codex-vendor/codex[.exe]
├── 复制 vendor/<triple>/codex-path/rg → build/codex-vendor/rg[.exe]
├── 复制 vendor/<triple>/codex-resources/ → build/codex-vendor/resources/ (如有)
└── 清理 tmpdir
```

#### 2. 修改 `electron-builder.config.js`

```js
extraResources: [
  {
    from: "build/codex-vendor",
    to: "codex-vendor",
    filter: ["**/*"],
  },
],
```

#### 3. 修改 `electron/src/lib/codex-binary.ts`

在搜索链最前面（env override 之后）加入内置路径：

```ts
// 新增：bundled binary in extraResources
function getBundledBinaryPath(): string | null {
  if (!app.isPackaged) return null;
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  const candidate = path.join(process.resourcesPath, "codex-vendor", name);
  return isExecutable(candidate) ? candidate : null;
}
```

修改 `resolveCodexPathSync()` 搜索顺序为：

```
1. 环境变量 CODEX_CLI_PATH
2. ★ 内置二进制 (process.resourcesPath/codex-vendor/codex) ← 新增
3. Managed copy ({userData}/openacpui-data/bin/codex)
4. Known paths (Codex Desktop app, Homebrew)
5. System PATH
```

#### 4. 修改 CI 构建流程 `.github/workflows/build.yml`

在 electron-builder 打包之前执行：

```yaml
- name: Bundle Codex binary
  run: node scripts/bundle-codex.js
  env:
    TARGET_PLATFORM: ${{ matrix.platform }}-${{ matrix.arch }}
```

#### 5. 保留 fallback 下载

内置二进制可能过时，保留现有 `downloadCodexBinary()` 作为自动更新/fallback。用户也可在设置中指定自定义路径。

### 包体积影响

| | 不含 Codex | 含 Codex |
|--|-----------|----------|
| macOS (arm64) DMG | ~200 MB | ~290 MB (+90 MB) |
| Windows (x64) NSIS | ~180 MB | ~270 MB (+90 MB) |
| Linux (x64) AppImage | ~190 MB | ~280 MB (+90 MB) |

---

## 二、品牌替换清单

以下是将 Harnss 改为你自己品牌需要替换的所有资产。假设新品牌名为 `{YourApp}`，新 GitHub 组织为 `{YourOrg}`，新仓库为 `{YourRepo}`。

### 1. 应用身份

| 文件 | 位置/字段 | 当前值 | 替换为 |
|------|-----------|--------|--------|
| `package.json` | `name` | `harnss` | `{your-app}` |
| `package.json` | `version` | `0.22.0-beta.2` | `1.0.0` 或自定 |
| `package.json` | `description` | `Harness your AI coding agents...` | 你的描述 |
| `package.json` | `author.name` | `Dejan Zegarac` | 你的名字 |
| `package.json` | `author.email` | `dejanzegarac3@gmail.com` | 你的邮箱 |
| `package.json` | `homepage` | `https://github.com/OpenSource03/harnss` | 你的主页 |
| `package.json` | `repository.url` | `https://github.com/OpenSource03/harnss.git` | 你的仓库 |
| `electron-builder.config.js` | `appId` | `com.harnss.app` | `com.{yourdomain}.{yourapp}` |
| `electron-builder.config.js` | `productName` | `Harnss` | `{YourApp}` |
| `scripts/notarize.js` | `appBundleId` | `com.harnss.app` | `com.{yourdomain}.{yourapp}` |
| `index.html` | `<title>` | `Harnss` | `{YourApp}` |

### 2. 图标与视觉资产

| 文件 | 说明 | 操作 |
|------|------|------|
| `build/icon.icns` | macOS 图标 | 替换为你的图标 |
| `build/icon.ico` | Windows 图标 | 替换为你的图标 |
| `build/icon.png` | Linux 图标 | 替换为你的图标 |
| `build/icon.icon/` | macOS iconset 目录 | 替换整个目录 |
| `build/icons/` | 多尺寸图标集 | 替换所有尺寸 |
| `src/components/settings/AboutSettings.tsx` | `HarnssLogo` SVG 组件 (第8行) | 替换为你的 Logo |

### 3. GitHub / 发布 / 更新源

| 文件 | 位置 | 当前值 | 替换为 |
|------|------|--------|--------|
| `electron-builder.config.js` | `publish.owner` | `OpenSource03` | `{YourOrg}` |
| `electron-builder.config.js` | `publish.repo` | `harnss` | `{YourRepo}` |
| `electron/src/lib/prerelease-check.ts:25-26` | `GITHUB_OWNER` / `GITHUB_REPO` | `OpenSource03` / `harnss` | `{YourOrg}` / `{YourRepo}` |
| `electron/src/lib/updater.ts:162-163` | 更新下载 URL | `github.com/OpenSource03/harnss/releases` | 你的 releases URL |
| `src/components/settings/AboutSettings.tsx:109` | 仓库链接 | `github.com/OpenSource03/harnss` | 你的仓库 |
| `src/components/settings/AboutSettings.tsx:115` | License 链接 | `github.com/OpenSource03/harnss/blob/main/LICENSE` | 你的 License |
| `src/components/AppSidebar.tsx:680` | Issues 链接 | `github.com/OpenSource03/harnss/issues` | 你的 Issues |
| `.github/FUNDING.yml` | 赞助配置 | `OpenSource03` / `opensource03` | 你的账号 |
| `.github/ISSUE_TEMPLATE/config.yml` | Issue 模板 | 引用 Harnss | 替换品牌名 |

### 4. 数据分析 (PostHog)

| 文件 | 位置 | 当前值 | 替换为 |
|------|------|--------|--------|
| `electron/src/lib/posthog.ts:42` | 主进程 API Key | `phc_lOKFRov0SWy2R71BNJ2t978tmNYc3ND7WwueOteV5vw` | 你的 PostHog Key 或删除 |
| `src/lib/analytics/posthog.ts:16` | 渲染进程 API Key | `phc_lOKFRov0SWy2R71BNJ2t978tmNYc3ND7WwueOteV5vw` | 同上 |

> 如果不需要分析，可将两处 key 置空并移除 `posthog-js` / `posthog-node` 依赖。

### 5. UI 文本 / 品牌名出现处

| 文件 | 行号 | 内容 | 操作 |
|------|------|------|------|
| `src/components/welcome/WelcomeStep.tsx` | 31 | `Harnss` 标题 | 替换 |
| `src/components/welcome/FeatureTourStep.tsx` | 47 | `make Harnss different` | 替换 |
| `src/components/welcome/ProjectStep.tsx` | 50 | `Point Harnss at any folder` | 替换 |
| `src/components/settings/AboutSettings.tsx` | 84, 135 | `Harnss` 品牌名 | 替换 |
| `src/components/AppSidebar.tsx` | 677 | `Harnss is in early beta` | 替换 |
| `electron/src/main.ts` | 406 | `Harnss DevTools` 窗口标题 | 替换 |
| `electron/src/lib/mcp-oauth-provider.ts` | 36 | `client_name: "Harnss"` (OAuth 注册名) | 替换 |
| `electron/src/lib/mcp-oauth-flow.ts` | 105 | `return to Harnss` (OAuth 回调页) | 替换 |

### 6. SDK / 引擎客户端标识

| 文件 | 位置 | 当前值 | 替换为 |
|------|------|--------|--------|
| `electron/src/lib/sdk.ts:43` | SDK User-Agent | `Harnss/${version}` | `{YourApp}/${version}` |
| `electron/src/ipc/codex-sessions.ts:62-65` | Codex 握手 client name | `Harnss` (来自 settings) | 修改默认值 |
| `shared/types/settings.ts:47` | `codexClientName` 默认值描述 | `"Harnss"` | `"{YourApp}"` |

### 7. 本地存储 Key 前缀

| 文件 | Key 前缀 | 说明 |
|------|----------|------|
| `src/stores/settings-store.ts:44` | `harnss-settings-store` | Zustand 持久化 key |
| `src/stores/settings-store.ts:212+` | `harnss-*` | 所有 localStorage keys |
| `electron/src/preload.ts:23,40,49` | `harnss-theme`, `harnss-transparency` | 预加载读取的 keys |
| `index.html` 内联脚本 | `harnss-theme` | 防闪烁脚本 |
| `src/components/welcome/shared.ts:17` | `harnss-welcome-completed` | 引导完成标记 |
| `src/lib/engine/acp-agent-registry.ts:8` | `harnss-agent-store-cache` | 注册表缓存 key |
| `src/lib/local-storage-migration.ts` | `openacpui-*` → `harnss-*` | 迁移逻辑（需改目标前缀） |

> 注意：修改前缀会导致现有用户设置丢失。建议写一次性迁移（类似现有 `openacpui-*` → `harnss-*` 的模式）。

### 8. 文件系统路径 / 数据目录

| 文件 | 路径 | 当前值 | 替换为 |
|------|------|--------|--------|
| `electron/src/lib/data-dir.ts:6` | 数据目录 | `{userData}/openacpui-data/` | `{userData}/{yourapp}-data/` |
| `electron/src/lib/agent-registry.ts:38` | Agent 存储 | `{userData}/openacpui-data/agents.json` | 同上 |
| `electron/src/lib/codex-binary.ts:39` | Codex 缓存 | `{userData}/openacpui-data/bin/` | 同上 |
| `electron/src/lib/app-settings.ts:8` | 设置文件 | `{userData}/openacpui-data/settings.json` | 同上 |
| `electron/src/lib/updater.ts:240` | 更新缓存 | `Caches/harnss-updater/pending/` | `Caches/{yourapp}-updater/pending/` |
| `electron/src/lib/updater.ts:292` | 临时目录 | `harnss-update-*` | `{yourapp}-update-*` |
| `electron/src/lib/migration.ts:56` | 迁移标记 | `.harnss-migrated` | `.{yourapp}-migrated` |
| `electron/src/ipc/git.ts:60` | Worktree 配置 | `.harnss/worktree.json` | `.{yourapp}/worktree.json` |
| `src/hooks/useWorktreeChips.ts:12` | Worktree 路径常量 | `.harnss/worktree.json` | `.{yourapp}/worktree.json` |
| `src/components/WorktreeBar.tsx:22,33,44,311` | Worktree UI 文案 | `.harnss/worktree.json` | `.{yourapp}/worktree.json` |
| `src/components/DiffViewer.tsx:155` | Monaco diff URI | `inmemory://harnss-diff/` | `inmemory://{yourapp}-diff/` |

### 9. 外部下载源

| 文件 | 当前源 | 说明 | 操作 |
|------|--------|------|------|
| `electron/src/lib/claude-binary.ts:27-29` | `https://claude.ai/install.sh` / `.ps1` / `.cmd` | Claude Code CLI 安装脚本 | 内置后可移除安装逻辑，或保留作更新用 |
| `electron/src/lib/codex-binary.ts` | `npm pack @openai/codex@<tag>` (npmjs.org) | Codex 二进制下载 | 内置后作为 fallback 更新通道 |
| `src/lib/engine/acp-agent-registry.ts:7` | `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` | ACP Agent 目录 | 可自建镜像或代理 |
| `src/lib/engine-icons.ts:6-7` | `https://cdn.agentclientprotocol.com/.../claude-acp.svg` / `codex-acp.svg` | 引擎图标 | 内嵌为本地 SVG 或自建 CDN |

### 10. macOS 签名 / 公证

| 文件 | 说明 | 操作 |
|------|------|------|
| `scripts/notarize.js` | Apple 公证脚本 | 换 `appBundleId`，配你自己的 `APPLE_ID` / `APPLE_TEAM_ID` |
| `build/entitlements.mac.plist` | macOS 权限声明 | 检查是否需要修改 |
| `electron-builder.config.js` → `mac.extendInfo` | 麦克风权限描述 | `Harnss uses the microphone...` → 替换品牌名 |

### 11. CI / GitHub Actions

| 文件 | 说明 | 操作 |
|------|------|------|
| `.github/workflows/build.yml` | 构建流水线 | 确认 secrets、仓库名 |
| `.github/ISSUE_TEMPLATE/*.yml` | Issue 模板 | 替换品牌名 |
| `.github/FUNDING.yml` | 赞助链接 | 替换为你的账号 |

---

## 三、建议执行顺序

1. **Fork & 重命名仓库**
2. **替换图标** — `build/` 下所有图标文件 + `AboutSettings.tsx` 中的 SVG Logo
3. **全局替换品牌名** — `Harnss` → `{YourApp}`（注意大小写变体：`harnss`、`HARNSS`、`Harnss`）
4. **替换 localStorage 前缀** — `harnss-` → `{yourapp}-`（加迁移逻辑）
5. **替换数据目录** — `openacpui-data` → `{yourapp}-data`（加迁移逻辑）
6. **替换 GitHub 坐标** — `OpenSource03/harnss` → `{YourOrg}/{YourRepo}`
7. **替换或移除 PostHog** — 换 key 或删除分析代码
8. **实现 Codex 内置** — 按第一节步骤添加构建脚本和 extraResources
9. **更新 electron-builder** — appId、productName、publish、签名配置
10. **测试构建** — 各平台打包验证
11. **首次发布** — 新版本号，新 GitHub Release

---

## 四、快速替换命令参考

```bash
# 品牌名替换（排除 node_modules、.git、docs、pnpm-lock）
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.yml' -o -name '*.yaml' -o -name '*.md' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/pnpm-lock*' -not -path '*/docs/*' -not -path '*/.claude/*' \
  -exec grep -l 'Harnss\|harnss\|HARNSS' {} \;

# localStorage key 前缀替换
grep -rn 'harnss-' --include='*.ts' --include='*.tsx' --include='*.html' . | grep -v node_modules

# GitHub 组织替换
grep -rn 'OpenSource03' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.yml' . | grep -v node_modules

# 旧数据目录名替换
grep -rn 'openacpui-data' --include='*.ts' . | grep -v node_modules
```
