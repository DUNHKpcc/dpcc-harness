# PccAgent 已知 Bug 汇总

> 最后更新:2026-06-22 · 主要针对 Windows x64 的用户反馈 + 日志分析。
> 代码引用为 `file:line`,可点击定位。

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ 已修复 | 代码已完成并通过 tsc / 单测 / 构建(工作区,**尚未提交**) |
| 🟡 部分缓解 | 已被某项改动间接缓解,但仍有残留需处理 |
| 🔴 待修复 | 已实锤定位根因,尚未动手 |
| 🟠 已设计待实现 | 根因清楚、方案已定,代码未写 |
| ⚪ 需更多信息 | 代码诊断成立,但日志/复现未触发,需进一步证据 |
| ➖ 良性 / 可选 | 不影响功能,优化项 |

## 总览

| ID | Bug | 来源 | 状态 | 需 Windows 验收 |
|---|---|---|---|:---:|
| B1 | 欢迎界面强制弹"连接 DPCC API 账户"面板 | 用户报告 | ✅ 已修复 | ❌ |
| B2 | 卡顿 + 反复闪现欢迎界面新窗口 | 用户报告 + 日志实锤 | ✅ 已修复(待 Win 验收) | ✅ |
| B3 | 微信桥接配置重启后登录丢失 | 用户报告 + 日志实锤 | ✅ 已修复(待 Win 验收) | ❌(代码可证) |
| B4 | 微信发消息一直 not login / 找不到 path;需加刷新按钮 | 用户报告 | ✅ 已修复(网关 env + 刷新按钮) | ❌ |
| B5b | 内置 Claude 会话标题一直 "not login" | 用户报告 | ✅ 已修复 | ❌ |
| C1 | 本机 claudecode 找不到 session(custom 空路径) | 用户报告 + 日志实锤 | ✅ 残留已修(回退内置) | ❌ |
| C2 | 内置/托管 Claude 安装在国内被地域封锁 | 日志实锤 | 🟡 部分缓解 + 🟠 残留 | ❌ |
| C3 | `managed` 源安装失败时不回退内置 | 代码确认 | ✅ 已缓解(新增 builtin 档) | ❌ |
| C4 | UI 诱导下载原生 Claude("检查更新"误导) | 代码确认 | ✅ 已修复 | ❌ |
| L2 | 更新源连不上 GitHub 且不断重试占资源 | 日志实锤 | ✅ 已修复 | ❌ |
| L3 | 每次写设置都触发 `allowPrerelease changed` 日志 | 日志 | ➖ 可选(未做) | ❌ |
| L4 | 非 git 文件夹仍轮询 git status 刷错误 | 日志 | ➖ 良性(未做) | ❌ |
| B8 | "当前配置"面板显示陈旧,且无刷新手段 | 用户改动回归 | ✅ 已修复 | ❌ |
| B9 | 主进程 `getAppSettings()` 缓存对外部改文件不失效 | 代码确认(B8 关联) | ✅ 已修复 | ❌ |

**计数**:✅ 已修复/已缓解 11 · 🟡 部分缓解 1(C2)· 🟠 残留待决策 1(C2)· ➖ 良性可选未做 2

---

## ✅ 已修复(代码完成,工作区未提交)

### B2 — 卡顿 + 反复闪现欢迎界面新窗口
- **现象**:Windows 上频繁卡顿,每次卡顿闪出一个欢迎界面新窗口又消失,循环。
- **根因(日志双重实锤)**:[claude-binary.ts:289](electron/src/lib/claude-binary.ts:289) `readClaudeVersion` 当路径是脚本(内置 `cli.js`)时用 `process.execPath` 重启 Electron,但缺 `ELECTRON_RUN_AS_NODE` → 启动了第二个完整 GUI 实例;同步 `execFileSync`(10s 超时)阻塞主线程。日志里两次精确 ~10.03s 冻结 + 多个 `DEVTOOLS Register …: FAILED`(第二实例)。又因 [main.ts](electron/src/main.ts) 无单实例锁,第二实例不被拦截。
- **修复**:脚本分支加 `env: { ELECTRON_RUN_AS_NODE: "1" }` + `windowsHide: true`([claude-binary.ts:289](electron/src/lib/claude-binary.ts:289));[main.ts:60](electron/src/main.ts:60) 加 `requestSingleInstanceLock()` + `second-instance` 聚焦已有窗口。
- **验证**:claude-binary 单测 +2;mac 不受影响(脚本分支才注入;单实例锁是 mac 期望的单窗口)。
- **待办**:Windows x64 上装新打包版做最终 E2E(应不再成对生成日志、无 FAILED、CLI 选定后无 10s 空档)。

### C4 — UI 诱导下载原生 Claude
- **现象**:"检查更新"按钮其实会运行 `claude.ai/install.ps1` 安装原生 Claude,让用户误以为内置不完整、必须去下载。
- **根因**:[EngineSettings.tsx](src/components/settings/EngineSettings.tsx) 在 `source !== "custom"` 时都显示下载按钮 → `window.claude.downloadUpdate()`。
- **修复**:下载/检查更新按钮**只在 `managed` 档显示**;新增 `builtin` 默认档并标"内置(推荐)";版本行显示当前实际 binary(内置 vX · 来源)。
- **关联**:见下方"新增 builtin 引擎来源"。

### C3 — `managed` 源安装失败时不回退内置(已缓解)
- **根因**:[claude-binary.ts](electron/src/lib/claude-binary.ts) 仅 `source === "auto"` 时回退内置 cli.js;选 `managed` 且安装失败 → 彻底无可用 binary。
- **缓解**:新增显式 `builtin` 档,用户不必赌 `auto`/`managed` 的回退行为,可直接选"内置"。

### L2 — 更新源连不上 GitHub 且不断重试
- **现象**:国内每次启动刷 `net::ERR_SSL_PROTOCOL_ERROR`/超时,并在每次 focus/startup/4h 重试,占资源。
- **修复**([updater.ts](electron/src/lib/updater.ts)):`checkForUpdates` 改为按"首选源 → 另一源"顺序尝试,GitHub 失败自动切 dpccgaming.xyz 镜像;两源全失败后挂起自动检查(不再 hammer),仅手动检查/切换源时重新启用;检查中的网络错误不再上报 PostHog。
- **验证**:updater 单测 59 个全过(新增 3:回退成功 / 全失败上报 / 挂起后手动重启)。日志显示用户已手动切镜像且工作正常,反向印证。

### 🧩 新增 builtin 引擎来源(C1–C4 这条线的主修)
- **背景**:`auto` 语义模糊(优先本机、找不到才回退内置),且 `managed` 走被封的 claude.ai。无显式"就用内置"选项。
- **改动**:
  - [settings.ts](shared/types/settings.ts):`ClaudeBinarySource`/`CodexBinarySource` 加 `"builtin"`。
  - [app-settings.ts](electron/src/lib/app-settings.ts):默认改为 `builtin`。
  - [claude-binary.ts](electron/src/lib/claude-binary.ts):`builtin` 永远用内置 cli.js,且**永不触发 claude.ai 安装器**。
  - [codex-binary.ts](electron/src/lib/codex-binary.ts):`builtin` 永远用内置 `codex-vendor`(dev 无内置回退 npm)。
  - [EngineSettings.tsx](src/components/settings/EngineSettings.tsx) + zh/en i18n:"内置(推荐)"首项、文案更直白、下载按钮仅 managed。
- **验证**:tsc 0 错;全量 308 测试通过;electron + vite 构建通过。
- **依赖**:必须与 B2 一起上(builtin 让 cli.js 成为所有平台热路径)。

---

## 🔴 待修复(已实锤)

### B3 — 微信桥接配置重启后登录丢失 ✅ 已修复
- **现象**:配置微信桥接后,重启应用登录信息消失,需重新扫码。
- **根因(日志实锤)**:每次启动第 1 行 `WECHAT_CRED_LOAD: Unexpected token 'v', "v10%S…" is not valid JSON`。凭据在 `app.whenReady()` 之前(模块求值期,[main.ts](electron/src/main.ts) IPC 注册块构造 WeChatBridge)被读;Windows `safeStorage`(DPAPI)此时 `isEncryptionAvailable()` 返回 false → [json-file-store.ts](electron/src/lib/json-file-store.ts) 退化为把 `v10` 密文当明文 `JSON.parse` → 抛错 → 返回 null。(`v10` 前缀证明数据已正确加密、ready 后可解。)
- **修复(已实现)**:① 凭据读取移出构造函数到 `ensureInit()`([bridge.ts](electron/src/lib/wechat/bridge.ts)),在所有 ready 后 reader(`getState`/`autoStart`/`start`/`setConfig`/`login`/`logout`)首次进入时幂等加载;构造期只读非加密的 config。② 加固 `JsonFileStore.load()`([json-file-store.ts](electron/src/lib/json-file-store.ts)):`encrypt && !isEncryptionAvailable()` 改走 `loadPlaintextLenient` —— 真明文(平台从不支持加密)仍可读,密文暂不可解则返回 null 且不报错,ready 后再读自愈。
- **需 Windows**:否(代码即可证;Win 仅作 E2E 兜底)。

### C1 — 本机 claudecode 找不到 session(custom 空路径)✅ 残留已修
- **现象**:配置用本机 Claude CLI 时,开会话报"找不到这个 session"。
- **根因(日志实锤)**:`claudeBinarySource: "custom"` 但路径为空 → [claude-binary.ts:71](electron/src/lib/claude-binary.ts:71) 抛 `Claude custom binary path is not set` → `START_ERROR` → 会话起不来,且错误未清晰提示。(另:npm/.cmd shim 经 SDK `child_process.spawn` 无 shell 在 Windows 会 ENOENT,见旧机器 `C:\nvm4w\nodejs\claude`。)
- **缓解**:默认改 `builtin` 后,新用户不再依赖本机。
- **残留修复(已实现)**:`resolveFromCustom()` 不再抛错,改返回 null 并 log(`CLAUDE_BINARY_CUSTOM_UNSET`/`CLAUDE_BINARY_CUSTOM_INVALID`);`resolveClaudeBinarySync` 对 custom 失败回退 `resolveSdkFallback()`(内置 cli.js,受 `allowSdkFallback` 控制),会话照常起;`getClaudeBinaryPath` 的 "not found" 错误对 custom 给可操作提示(去设置改路径或切内置)。新增 2 个单测覆盖空路径/不可执行回退。
- **未做**:UI 侧"失败时一键切到内置"提示(对已存 `custom`/`auto` 的老用户)。

### B8 — "当前配置"面板显示陈旧,且无刷新手段 ✅ 已修复
- **现象**:改了配置后,"当前配置"面板仍显示旧值、不生效。
- **根因**:提交 `8df0148` 删了手动刷新按钮,只留 mount 时 `useEffect([refresh])` 取一次([CurrentConfigSettings.tsx:87](src/components/settings/CurrentConfigSettings.tsx:87));未订阅设置变更、未监听窗口聚焦。配置在面板不重挂载的情况下变化(外部编辑 `~/.claude`/`~/.codex`、app 外改 settings.json、面板挂载时从别处改)→ 显示旧值且**无法刷新**。
- **易误判**:有本地 `~/.claude` 凭据时,启用应用内网关后面板仍显示 `local`(本地优先),属设计如此,非刷新 bug。
- **修复(已实现)**:[CurrentConfigSettings.tsx](src/components/settings/CurrentConfigSettings.tsx) 订阅 `window.claude.settings.onChanged` refetch + 窗口 `focus` refetch + 保留 mount fetch(配合 B9 让外部改 settings.json 在聚焦时生效)。

### B9 — 主进程 `getAppSettings()` 缓存对外部改文件不失效(B8 关联)✅ 已修复
- **根因**:[app-settings.ts:50](electron/src/lib/app-settings.ts:50) `let cached` 首次读盘后常驻,只有 `setAppSettings` 更新它;若用户在 app 外直接编辑 `{userData}/pcc-agent-data/settings.json`,缓存不失效,`effective()` 等读到旧值。
- **修复(已实现)**:`getAppSettings()` 增加基于 mtime 的失效——每次读取 `fs.statSync` 比对 `cachedMtimeMs`,文件在外部被改写则重新读盘;`setAppSettings` 写盘后同步 `cachedMtimeMs`,避免把自己的写当外部变更重读。

---

## ✅ 已修复(本批新增)

### B1 — 欢迎界面强制弹"连接 DPCC API 账户"面板 ✅ 已修复
- **现象**:新用户欢迎界面左下角反复弹出账户连接面板,产品方不想强制登录。
- **根因**:[AccountPopover.tsx:416](src/components/AccountPopover.tsx:416) mount 时 `useEffect` 在未配置账户时强制 `setOpen(true)`。
- **修复(已实现)**:删掉 auto-open `useEffect` 与 `ONBOARD_FLAG` 常量,去掉无用的 `useEffect` import(保留 `shouldLoadAccountDetails`)。左下角账户按钮仍是可选登录入口,不再强制弹出。

### B4 — 微信发消息一直 not login / 找不到 path + 加刷新按钮 ✅ 已修复
- **现象**:微信连成功后发消息报 not login 或找不到本机 claudecode path;希望加刷新按钮。
- **根因**:微信 `ClaudeAdapter` 的 spawn env([claude-adapter.ts:57](electron/src/lib/wechat/adapters/claude-adapter.ts:57))漏注入 `claudeGatewayEnv()`(交互式会话有);路径解析在 Windows/managed 下偏弱;且无手动重连入口。
- **修复(已实现)**:
  - ① 抽出共享模块 [claude-gateway-env.ts](electron/src/lib/claude-gateway-env.ts)(`claudeGatewayEnv()` + `claudeGatewayModel()`),交互式会话、标题/commit 生成、微信适配器三方复用。
  - ② 适配器 spawn env 注入 `claudeGatewayEnv()`,并用网关 model 覆盖配置 model(对齐交互式)。
  - ③ 路径解析经 `getClaudeBinaryPath()`,已随 C1 修复回退内置 cli.js。
  - ④ **刷新按钮**:新增 `WeChatBridge.reconnect()`(保留凭据,停旧 client/router → `resetClaudeBinaryCache()` 重置二进制缓存 → 重新 `start()`)+ `wechat:reconnect` IPC + preload/`window.d.ts` 类型 + 设置页"已连接"行的「重新连接 / Reconnect」按钮(`config.enabled` 时显示,转圈禁用)。**注意:dev 加了新 IPC 需整重启 Electron 才生效。**
- **验证**:3 路对抗式 review(后端生命周期 / IPC 契约 / 渲染层 + i18n)全 clean;renderer tsc 0 错、310 测试通过、build 通过。

### B5b — 内置 Claude 会话标题一直 "not login" ✅ 已修复
- **现象**:内置 Claude 正常用,但自动生成的标题一直显示 "not login"。
- **根因**:[title-gen.ts:61](electron/src/ipc/title-gen.ts:61) 的 `oneShotSdkQuery` env 缺 `settingSources` + `claudeGatewayEnv()` → 裸鉴权 → 网关回的 "not login" 文本被 `firstNonEmptyLine` 原样当标题返回([title-gen.ts:116](electron/src/ipc/title-gen.ts:116))。
- **修复(已实现)**:`oneShotSdkQuery` 默认补 `settingSources: ["user","project","local"]`(置于 `extraOptions` 展开前,commit 生成仍可覆盖)+ env 注入 `...claudeGatewayEnv()` + 用 `claudeGatewayModel()` 覆盖请求 model(网关只服务自身 model,"haiku" 会 404)。

---

## 🟡 部分缓解(有残留)

### C2 — 内置/托管 Claude 安装在国内被地域封锁
- **现象**:点"下载/安装 Claude" → `irm https://claude.ai/install.ps1 | iex` 返回 `App unavailable in region` HTML → 安装失败。
- **缓解**:默认 `builtin` 永不触发安装;`auto`/`builtin` 下隐藏下载按钮。
- **残留(待决策)**:若用户主动选 `managed`,入口仍会跑被封的 claude.ai。可选:镜像安装脚本走 dpccgaming.xyz,或国内禁用该档,或失败时明确报错。

---

## ➖ 良性 / 可选

### L3 — 每次写设置都触发 `allowPrerelease changed` 日志
- 设置变更回调对每次 `settings:set` 都触发并打日志(轻微噪音)。可选优化:仅在 `allowPrereleaseUpdates` 真变化时处理。

### L4 — 非 git 文件夹仍轮询 git status
- 打开非 git 目录时持续刷 `GIT_STATUS_ERR: not a git repository`。功能无影响。可选:检测到非仓库后停止轮询。

---

## 修复推进建议

1. **待 Windows 验收**:B2、B3、B4 刷新按钮(代码已证 / review clean,Win 上做 E2E 兜底;新增 IPC 需打新包验)。
2. **剩余可选 / 待决策**:
   - C2 残留(镜像安装脚本走 dpccgaming.xyz / 国内禁用 managed / 失败明确报错)——待产品决策。
   - L3(`allowPrerelease changed` 日志只在真变化时打)、L4(非 git 目录停止轮询)——良性,未做。
   - C1 老用户"一键切内置"UI 提示。

## 工作区当前未提交改动

**已有(上一批)**:
- B2:`claude-binary.ts`(readClaudeVersion)、`main.ts`(单实例锁)、`claude-binary.test.ts`
- L2:`updater.ts`、`updater.test.ts`
- builtin 引擎来源(C3/C4 主修):`settings.ts`、`app-settings.ts`、`claude-binary.ts`、`codex-binary.ts`、`EngineSettings.tsx`、`zh/en settings.json`、`claude-binary.test.ts`

**本批新增(B1/B3/B4/B5b/B8/B9/C1)**:
- B9:`app-settings.ts`(mtime 缓存失效)
- B8:`CurrentConfigSettings.tsx`(onChanged + focus refetch)
- B3:`json-file-store.ts`(load 加固)、`wechat/bridge.ts`(凭据延迟到 ensureInit)
- C1:`claude-binary.ts`(custom 回退内置 + 可操作错误)、`claude-binary.test.ts`(+2 测试)
- B1:`AccountPopover.tsx`(移除强制弹窗)
- B4+B5b:新增 `claude-gateway-env.ts`(共享);`claude-sessions.ts`(改用共享模块)、`title-gen.ts`、`wechat/adapters/claude-adapter.ts`(注入网关 env/model)
- B4 刷新按钮:`claude-binary.ts`(`resetClaudeBinaryCache`)、`wechat/bridge.ts`(`reconnect()`)、`ipc/wechat.ts`(`wechat:reconnect`)、`preload.ts`、`window.d.ts`、`WeChatSettings.tsx`、`en/zh settings.json`(`wechat.reconnect`)

**验证**:renderer `tsc` 0 错;`pnpm test` 310 测试全过(+2);`pnpm build`(tsup + vite)通过;B4 刷新按钮经 3 路对抗式 review 全 clean。

建议分提交(本批,接在上一批 3 个提交之后):
- `fix: keep app settings cache in sync with external settings.json edits` (B9)
- `fix: refresh the Current Config panel on settings change and window focus` (B8)
- `fix: defer WeChat credential decryption until after app ready (Windows)` (B3)
- `fix: fall back to the built-in Claude binary when the custom path is unusable` (C1)
- `fix: stop force-opening the account setup popover on launch` (B1)
- `fix: authenticate WeChat sends and title generation against the in-app gateway` (B4 + B5b)
- `feat: add a WeChat bridge reconnect button` (B4 刷新按钮)
