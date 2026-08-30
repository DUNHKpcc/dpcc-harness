# Pi-Only 内置 Agent 实现 Spec

## 文档状态

- 状态：Implemented in working tree，并作为后续 Pi-first 实现基线；等待三平台 quality/package CI 终态验证
- 上游设计：`docs/superpowers/specs/2026-08-27-pi-only-agent-runtime-design.md`
- 基线提交：`374b73347ac4`
- 目标产品：PccAgent / Harnss
- 本文范围：把 Pi 设为唯一内置 Agent，并保留旧用户数据的可读兼容性

代码已按本文边界落地；“完成”仍要求全量本地非打包门禁和云端 macOS/Windows/Linux packaged smoke 均通过。

后续新增 Agent 功能默认在 `engine: "acp"` + protected `agentId: "pi-acp"` 路径实现。不得重新引入 Claude/Codex live engine；custom ACP Agent 只能通过通用 ACP contract 共享能力。涉及 Pi runtime 的变更必须继续保持 bundled offline、lazy materialization、slash command 提前加载和 live catalog 校正这些既有契约。

## 1. 目标与边界

### 1.1 目标

完成后，产品的运行时规则必须是：

1. 新建会话只能创建 `engine: "acp"` 的 session。
2. 内置 Agent 只有稳定身份 `id: "pi-acp"`，显示名为 `Pi`。
3. Pi 通过官方 `pi-acp` adapter 启动，ACP 是唯一的会话协议。
4. 用户仍然可以安装和使用 custom ACP Agent；“只保留 Pi”只针对内置 Agent，不是禁止 ACP 扩展。
5. 历史 Claude/Codex session 可以查看和管理，但不再启动旧 runtime，也不在原 session 内发送消息。
6. 安装包内置锁定版本的 `pi` 和 `pi-acp`，built-in Pi 不查询系统 PATH，安装后可离线启动。

### 1.2 明确不做的事

- 不增加 `engine: "pi"`。
- 不把 Claude/Codex 的 resume ID 转换成 ACP `agentSessionId`。
- 不把旧 session 静默切换到 Pi 后继续发送。
- 不删除或重写已有 session、localStorage、AppSettings 和 custom ACP Agent 配置。
- 不在同一批改动中重命名 `window.claude.acp` namespace。
- 不在没有 Pi ACP adapter 之前把 WeChat 的旧 Claude/Codex adapter 静默改指向 Pi。
- 不自动接管用户本机已有的 Pi executable；用户要运行该 executable，必须以不同 Agent ID 创建 custom ACP Agent。

## 2. 不变量和数据契约

### 2.0 当前实现的迁移起点

这不是“把配置默认值改成 Pi”就完成的工作。以基线 `374b73347ac4` 检查，当前仍存在以下硬耦合，实施时必须逐项关闭：

- `electron/src/lib/agent-registry.ts` 仍固定注册 Claude Code 和 Codex，尚未注册受保护的 `pi-acp`。
- `src/hooks/useSessionManager.ts`、`src/hooks/session/useDraftMaterialization.ts` 的默认创建和 prewarm 仍可落到 Claude，ACP 也仍依赖调用方显式提供 `agentId`。
- `src/hooks/session/useSessionPane.ts`、`useSessionLifecycle.ts`、`useSessionRevival.ts`、`useSessionRestart.ts`、`useSessionSettings.ts` 仍允许三引擎运行分支。
- `shared/lib/session-runtime.ts`（若已提前创建）必须接入 session loader、revive、send 和 restart guard；只定义纯函数而不接入调用链不算完成。
- `src/lib/session/records.ts` 和 `shared/lib/session-persistence.ts` 必须区分“旧字段可读”和“新 Pi session 不再写旧字段”。
- `src/types/permissions.ts` 和 `shared/types/engine.ts` 的 shared permission contract 仍可能直接依赖 Claude SDK，必须在删除 Claude runtime 前解耦。
- `electron/src/main.ts`、`electron/src/preload.ts`、`src/types/window.d.ts` 仍注册/暴露旧 IPC；删除顺序必须受 renderer 引用扫描约束。
- `shared/types/wechat.ts`、`electron/src/lib/wechat/router.ts`、`src/lib/session/wechat-continue.ts` 仍以 Claude/Codex 为 WeChat runtime，不能在 Pi adapter 尚未完成时静默改道。
- `package.json`、`electron-builder.config.js`、`.github/workflows/build.yml` 仍可能运输 Codex vendor 和 Claude SDK；必须在 source graph 清零后再删。

### 2.1 稳定 Agent 身份

在 shared 层定义唯一常量和类型，所有 main、renderer、测试使用同一来源：

```ts
export const BUILTIN_PI_AGENT_ID = "pi-acp" as const;

export const BUILTIN_PI_AGENT = {
  id: "pi-acp",
  name: "Pi",
  engine: "acp",
  builtIn: true,
  registryId: "pi-acp",
  binary: "bundled:pi-acp",
} as const;
```

运行时类型和持久化兼容类型分开：

```ts
export type RuntimeEngineId = "acp";
export type LegacyEngineId = "claude" | "codex";
export type PersistedEngineId = RuntimeEngineId | LegacyEngineId;
```

禁止通过显示名、binary 名或 UI 位置判断 Pi。Pi-specific launch preparation 只能由 `id`、`engine`、`builtIn`、`registryId` 四项同时匹配的受保护身份触发；只带 `registryId: "pi-acp"` 的 custom Agent 不能进入 built-in 路径。

### 2.2 Session runtime disposition

读取 session 后只派生 disposition，不回写原文件：

```ts
type SessionRuntimeDisposition =
  | { kind: "runtime"; engine: "acp"; agentId: string }
  | { kind: "legacy-read-only"; engine: "claude" | "codex" };
```

规则：

- `engine: "acp"` 且有 `agentId`：进入 ACP runtime。
- `engine: "acp"` 但缺少 `agentId`：按兼容规则解析为 `pi-acp`，同时记录一次可诊断的 legacy normalization，不改写历史数据。
- `engine: "claude"` 或 `engine: "codex"`：只读，不允许进入 start、revive、send、restart 或 background runtime 路径。
- 未知 `engine`：加载失败并给出数据格式错误，不得猜测为 Claude、Codex 或 Pi。

### 2.3 新 session 的持久化

所有新建 session 必须至少包含：

```json
{
  "engine": "acp",
  "agentId": "pi-acp"
}
```

新 Pi session 可以保存 ACP 返回的 `agentSessionId`，但不得新写入：

- `codexThreadId`
- `codexRolloutPath`
- `delegatedFromSessionId`
- Claude-specific effort 或 Codex-specific reasoning state

旧字段在读取 schema 中暂时保留，直到完成至少一个兼容周期和数据审计。

## 3. 分阶段实现

每个阶段必须先通过本阶段验收，再开始删除下一层的旧分支。不得把依赖删除、数据迁移和 renderer 重构压成一个不可回滚提交。

### Phase 0：兼容模型和护栏

**负责范围**

- `shared/types/engine.ts`
- `src/types/session.ts`
- `shared/lib/session-persistence.ts`
- `src/types/permissions.ts`
- `src/lib/session/records.ts`
- 新增的 session runtime disposition helper 及其单元测试
- `electron/src/lib/agent-registry.ts` 的内置身份保护测试

**实现要求**

- 引入 `RuntimeEngineId`、`LegacyEngineId`、`PersistedEngineId`。
- 引入 `BUILTIN_PI_AGENT_ID` 和 `BUILTIN_PI_AGENT`。
- loader 只读取和派生，不主动重写旧 session。
- 增加 legacy read-only 判定，保证旧 session 不会因为缺少新字段被当作运行时 crash。
- shared permission contract 不再以 Anthropic SDK 类型作为跨层公共依赖；具体 SDK 类型只能留在 Claude 兼容实现内部，直到后续删除。

**验收**

- 代表性的 Claude、Codex、ACP/Pi session 文件均能加载。
- 加载前后原始 JSON 字段和字节内容不变。
- 新 session identity、legacy disposition、未知 engine 均有单测。
- `pnpm test` 和 `pnpm typecheck` 通过，或明确记录与本改动无关的 baseline failure。

### Phase 1：Pi 成为唯一内置 Agent

**负责范围**

- `electron/src/lib/agent-registry.ts`
- `src/lib/engine/acp-agent-registry.ts`
- `src/hooks/app-layout/session-utils.ts`
- `src/hooks/session/useDraftMaterialization.ts`
- `src/hooks/session/useSessionCrud.ts`
- `src/hooks/useSessionManager.ts`
- `src/hooks/session/useSessionSettings.ts`
- `src/hooks/session/useSessionRestart.ts`
- Agent picker、settings 和新建会话相关组件

**实现要求**

- registry 只固定注册 `BUILTIN_PI_AGENT`；Pi 不可删除、不可被用户 definition 覆盖。
- custom ACP Agent 继续来自现有 `agents.json`，与内置 Pi 分组展示。
- 未选择 Agent 时显式解析为 `pi-acp`，禁止继续用 `null` 隐式代表 Claude。
- draft、first prompt、split pane、keyboard shortcut 和跨 Agent 创建路径统一使用 `engine: "acp"`、`agentId: "pi-acp"`。
- 新建 draft 不启动 Pi；立即读取 registry 中缓存的 config catalog，并用 pinned built-ins、缓存及本地 prompt/Skill 扫描预加载 slash catalog，首次发送才执行 `acp:start`。
- Pi-specific launch preparation 只在 `registryId === "pi-acp"` 时执行。
- 设置页隐藏 Claude/Codex runtime controls，但保留旧设置键的读取兼容；不主动删除旧键。

**验收**

- Agent picker 中只有一个 built-in 项：Pi。
- 新建、复制历史创建和 split 新 pane 的 persisted identity 均为 ACP/Pi。
- 尝试覆盖或删除 Pi 不改变 registry。
- custom ACP Agent 的安装、显示和启动路径不受影响。

### Phase 2：Renderer ACP-only

**负责范围**

- `src/hooks/session/useSessionPane.ts`
- `src/hooks/session/useDraftMaterialization.ts`
- `src/hooks/session/useSessionRevival.ts`
- `src/hooks/session/useSessionLifecycle.ts`
- `src/hooks/session/useSessionPersistence.ts`
- `src/hooks/session/useSessionSettings.ts`
- `src/hooks/session/useExtraPaneLoader.ts`
- `src/hooks/useSessionManager.ts`
- `src/lib/background/session-store.ts`
- `src/lib/background/acp-handler.ts`
- 相关 session pane、composer、tool 和 legacy banner UI

**实现要求**

- `useSessionPane` 只保留 `useACP` 的 active runtime 状态；可以暂时保留兼容数据类型，但不能继续创建 Claude/Codex runtime。
- revival 只调用 `window.claude.acp.reviveSession()`。
- legacy session 在进入 revival、send、restart 前被拦截，显示“runtime 已移除，只读”，并提供“使用 Pi 新建会话”操作。
- 只读拦截必须发生在 IPC 调用之前；不得先启动旧 process 再在 renderer 报错。
- background store 只接收 ACP/Pi 新事件；旧 background 数据可以读取和关闭，但不再创建新 Claude/Codex background session。
- model、thinking、permission、MCP 和 slash command 以 ACP config/events 为权威，不从旧 Claude/Codex 状态猜测。
- 新旧 Pi session 在 dormant 状态使用缓存目录；draft 选择在首次 `session/new` / `session/load` 后按 live catalog 校验并应用，最终 live 结果覆盖 cache。
- 去除 Claude checkpoint/file revert、Codex collaboration mode 和 Claude-to-Codex delegation 的新入口；替代能力另立 engine-neutral spec。

**验收**

- 单 pane 和 split pane 均只能启动 ACP child。
- legacy session 的 send/revive/restart 都在调用 IPC 前返回只读结果。
- ACP session 的切换、队列、取消、失败清理和持久化不依赖 Claude/Codex hook 返回值。
- 旧 session 仍能查看、搜索、重命名、固定、移动、导出和删除。

### Phase 3：Main 和 preload ACP-only

**负责范围**

- `electron/src/main.ts`
- `electron/src/preload.ts`
- `src/types/window.d.ts`
- `electron/src/ipc/acp-sessions.ts`
- `electron/src/ipc/claude-sessions.ts`
- `electron/src/ipc/codex-sessions.ts`
- Claude/Codex utility、binary、RPC 和 shutdown 代码

**实现要求**

- 只有在 renderer 已无引用后，停止注册 Claude/Codex IPC。
- 删除 main 的 Claude/Codex active turn count、delegation bridge 和对应 shutdown cleanup。
- 保留 ACP 的 spawn、initialize、authenticate、prompt、cancel、stop、reload、revive、MCP、permission 和 config option 能力。
- 第一阶段继续保留 `window.claude.acp`，只删除已无消费者的顶层 Claude/Codex API。
- 不允许旧 session 的请求绕过 renderer 直接调用 Claude/Codex IPC。

**验收**

- 开发和 packaged app 运行期间不会创建 Claude/Codex child process。
- 未注册旧 IPC channel 不会影响旧 session 的读取和管理。
- preload 类型、实现和 renderer 使用点一致。
- 应用退出时 ACP child、pending permission、pending turn 和未完成 tool 状态均被清理。

### Phase 4：旁路功能迁移

**负责范围**

- `electron/src/lib/wechat/**`
- `src/lib/session/wechat-continue.ts`
- `electron/src/lib/acp-utility-prompt.ts`
- `electron/src/lib/codex-utility-prompt.ts`（迁移完成后删除）
- `shared/types/wechat.ts`
- `electron/src/lib/wechat/router.ts`
- `src/lib/background/**`
- title、commit message、通知和导入流程

**实现要求**

- 新增 Pi ACP WeChat adapter 前，Pi-only build 不得启动旧 WeChat adapter。
- WeChat 每个用户使用独立 ACP `agentSessionId`，保存 `engine: "acp"`、`agentId: "pi-acp"`。
- `@claude`、`@cc`、`@codex`、`@cx` 不得静默映射到 Pi；兼容期返回迁移提示，目标 alias 为 `@pi`。
- title generation 和 commit message 只使用 active Pi ACP utility path 或确定性的本地 fallback；禁止隐式启动 Claude/Codex。
- Claude transcript import 可以保留，但语义明确为历史导入，不是可恢复的 Claude runtime。

**验收**

- WeChat 没有旧 adapter 可启动路径。
- Pi ACP session 的用户隔离、resume、cancel 和错误回传有集成测试。
- utility prompt 失败不会阻塞普通 Pi session，也不会偷偷拉起旧 runtime。

### Phase 5：依赖、发行物和文档清理

**负责范围**

- `package.json`
- `pnpm-lock.yaml`
- `scripts/bundle-codex.js`
- `electron-builder.config.js`
- `.github/workflows/**`
- 产品描述、i18n、release history、test map

**实现要求**

- 删除 Codex vendor、`bundle:codex` 和各平台 Codex bundling step。
- 在 source graph 确认无消费者后删除 `@anthropic-ai/claude-agent-sdk` 及 optional platform packages。
- 单独检查 `@anthropic-ai/sdk` 的实际 imports，再决定是否删除；不能按包名猜测。
- 保留 `@agentclientprotocol/sdk`。
- 更新 lockfile、打包配置、release docs、i18n 和测试关系图。
- 添加 exact production dependencies、Pi 家族 transitive overrides、lockfile integrity、bundled wrapper、third-party notice、`extraResources` 和 native/WASM `asarUnpack`。
- runtime status 必须报告 `source: "bundled"`、`offlineReady`、Electron host、Pi/adapter entry、实际版本和稳定错误码。

**验收**

- packaged app 不包含 Codex vendor。
- source/build graph 不再加载 Claude Agent SDK。
- macOS、Windows、Linux build 和 packaged smoke 各自通过。
- packaged smoke 在空 PATH 下实际执行随包 Pi，并验证 `offlineReady: true`。

### Phase 6：bundled Pi Runtime（必做，已实现）

- Pi `0.84.1`、`pi-acp` `0.0.33` 由 `pnpm-lock.yaml` 的 integrity 与 exact dependency 共同锁定。
- adapter 和 Pi entry 保留在 `app.asar/node_modules`，wrapper 位于 `extraResources/pi-runtime/bin`。
- wrapper 使用 PccAgent Electron executable 和 `ELECTRON_RUN_AS_NODE=1`，不调用系统 Node/Pi/npx。
- `default` / `gateway` 使用隔离的 managed Pi 配置；`local` 读取用户 Pi 配置和 provider env，但 executable 仍是 bundled Pi。
- runtime 更新、签名、回滚跟随 PccAgent release，不在首版增加运行时在线下载器。
- 三平台 artifact 与签名结论只能由云端 release/quality job 给出；本机不打包。

## 4. 兼容、升级和回滚

- 首个 Pi-only release 不删除或重写旧 session 文件。
- 首个 Pi-only release 不清理旧 localStorage/AppSettings 键。
- custom ACP Agent definition 和缓存配置不迁移、不删除。
- legacy banner 说明“原 runtime 已移除，只能查看”，不能显示为普通连接失败。
- 回滚到旧版本时，旧版本仍应能读取原始 session/settings 数据。
- 至少一个兼容周期后，完成 session/settings 审计，才允许另立 migration spec 删除 legacy 字段。

## 5. 测试矩阵

### Unit

- built-in registry 只有 Pi，且不能覆盖/删除。
- official Pi detection 只认 `registryId`。
- 新 session identity 是 ACP/Pi。
- legacy disposition 不修改原始数据。
- legacy send/revive/restart 在 IPC 前被拦截。
- ACP config option 是 Pi model/thinking 的权威来源。
- permission contract 不依赖 Anthropic/Codex 类型。
- `default`、`local`、`gateway` Pi upstream 隔离，缺配置时 fail closed。

### Integration / E2E

- fresh Pi start、first prompt、completion、failure、cancel、stop。
- Pi session revive、agentSessionId、persistence copy 和 split pane。
- MCP、permission、config option、thinking、model、slash command。
- background completion、unread state、title、commit message。
- legacy session 查看/复制/搜索/删除，且不启动旧 runtime。
- WeChat Pi isolation、resume、cancel 和旧 alias 迁移提示。

### Packaging

- 无 Codex vendor。
- 无 Claude Agent SDK runtime consumer。
- built-in 忽略 PATH、agent binary/args/env command override；custom ACP 仍使用自己的 definition。
- bundled Pi / pi-acp package、wrapper、host、版本和 native/WASM 资源契约。
- 三平台 app 启动、空 PATH bundled Pi launch 和 packaged smoke。

## 6. 建议提交边界

1. `refactor(session): define Pi runtime and legacy boundaries`
2. `feat(pi): make Pi the only built-in agent`
3. `refactor(renderer): make sessions ACP-only`
4. `refactor(electron): remove legacy runtime IPC`
5. `feat(wechat): route supported sessions through Pi ACP`
6. `chore(packaging): remove Claude and Codex distribution assets`
7. `docs: document Pi-only migration and bundled runtime contract`

每个提交都要能单独说明：改了哪一层、旧数据如何兼容、验证命令是什么、失败时如何回滚。不要把 runtime 删除和数据迁移放进同一提交。

## 7. 完成标准

- Agent picker 中 Pi 是唯一 built-in Agent，custom ACP 仍可管理。
- 新建、发送、恢复、重启和 split session 只走 ACP/Pi。
- 历史 Claude/Codex session 可读可管理，但不会触发旧 runtime。
- 运行期间没有 Claude/Codex child process。
- Pi 的 model、thinking、permission、MCP、tool、slash command 和三种 upstream source 均有对应验证。
- built-in Pi 在没有系统 `pi`、`pi-acp`、`node` 或 `npx` 时仍能由安装包离线启动。
- 用户本机 Pi 不会覆盖 built-in；只有独立 custom ACP Agent 会运行用户指定 executable。
- WeChat 未迁移完成前不会启动旧 adapter。
- 测试、typecheck、build、test map、docs check、package smoke 和三平台验证结果可追溯。
