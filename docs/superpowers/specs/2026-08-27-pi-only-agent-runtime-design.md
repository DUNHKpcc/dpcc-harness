# Pi-Only 内置 Agent Runtime 实现 Spec

## 文档状态

- 状态：Approved，并作为长期 Pi-first 产品基线；working tree 已实现，等待三平台 CI 发行验证
- 基线分支：`master`
- 基线提交：`374b73347ac4`
- 日期：2026-08-27
- 目标产品：PccAgent / Harnss

## 背景

PccAgent 当前同时维护三条会话运行链路：

- Claude Code：`engine: "claude"`，由 `@anthropic-ai/claude-agent-sdk` 驱动。
- Codex：`engine: "codex"`，由内置 Codex app-server/RPC 驱动。
- ACP：`engine: "acp"`，由 `@agentclientprotocol/sdk` 驱动，Pi 通过官方 `pi-acp` adapter 接入。

本次改造的最终目标是：

1. PccAgent 只提供一个内置 Agent：Pi。
2. 所有新建会话只走 ACP runtime。
3. Claude Code 和 Codex 不再作为可启动的内置 engine。
4. 最终安装包不再携带 Claude Code runtime、`@anthropic-ai/claude-agent-sdk`、Codex runtime 或 Codex vendor 资源；`@anthropic-ai/sdk` 是否保留需按实际 imports 单独判断。
5. 已有用户数据保持可读取、可管理，不因升级丢失。

## 长期发展原则

- 后续所有 Agent runtime、会话、模型、thinking、permission、tool、Skill、MCP、恢复和观测能力都先完整适配 Pi，再通过通用 ACP contract 扩展给 custom ACP Agent。
- 不恢复 Claude Code 或 Codex live runtime，也不以兼容名义新增它们的启动、resume、认证、模型目录或 utility process。
- Pi 的用户可见身份统一使用名称 `Pi` 和官方 Pi logo；旧品牌只允许出现在历史会话、迁移说明和归档资料中。
- 受保护的 built-in Pi 持续遵守 bundled、离线可用、忽略系统 PATH、首次运行不下载和 lazy materialization 契约。
- 每次 Pi runtime 升级必须同步版本 manifest、lockfile、third-party notice、真实 child integration、Electron recovery E2E 和三平台 packaged smoke。
- custom ACP Agent 是扩展边界，不得通过削弱 Pi 的 protected identity、离线保障或错误契约来换取兼容。

## 术语

### 内置 Agent

由 PccAgent 固定注册、不可删除、无需从 ACP registry 手动添加的 Agent 定义。

本 Spec 使用以下稳定标识：

```ts
const BUILTIN_PI_AGENT_ID = "pi-acp";

const BUILTIN_PI_AGENT = {
  id: "pi-acp",
  name: "Pi",
  engine: "acp",
  builtIn: true,
  registryId: "pi-acp",
  binary: "bundled:pi-acp",
};
```

### 内置 Runtime

用户安装 PccAgent 后，不需要另外安装 `pi` 或 `pi-acp` 即可启动 Pi。

本次实现同时满足“内置 Agent”和“内置 Runtime”：`pi`、`pi-acp` 与 `pi-mcp-adapter` 作为锁定版本的 production dependencies 随安装包交付，由 PccAgent 自身的 Electron runtime 以 `ELECTRON_RUN_AS_NODE=1` 承载。macOS 使用带 `LSUIElement=1` 的 Electron Helper 承载 Node workload，不能直接执行 GUI 主 executable，否则会在 Dock 中生成第二个 `exec` App。首次启动不下载 runtime，也不解析系统 `pi`、`pi-acp`、`node` 或 `npx`。

### Legacy session

历史上以 `engine: "claude"` 或 `engine: "codex"` 保存的会话。升级后仍可查看、重命名、固定、搜索、删除和导出，但不能继续连接原 runtime。

## 已确认目标

- 内置 Claude Code 和内置 Codex 从产品中移除。
- Pi 成为唯一内置 Agent。
- Pi 继续复用现有 ACP session、tool rendering、MCP、permission、config option 和 persistence 能力。
- 不新增 `engine: "pi"`。Pi 的规范身份是 `engine: "acp"` 加 `agentId: "pi-acp"`。
- 最终清理 Claude Code/Codex runtime、IPC、依赖和打包资源。

## 已确认决策

以下决策是当前实现和后续开发的稳定约束；如需改变，必须先更新本 Spec 和对应测试：

1. 保留第三方/custom ACP agents。产品的“唯一内置 Agent”是 Pi，但用户仍可安装其他 ACP Agent。
2. 旧 Claude/Codex session 只读，不尝试自动转换 resume ID。
3. 首个 Pi-only release 必须随包内置 `pi` 与 `pi-acp`，安装后可离线启动。
4. 受保护的 built-in `pi-acp` 始终使用 bundled runtime，忽略系统 PATH 中同名命令；用户本机已有 Pi 只通过不同 Agent ID 的 custom ACP Agent 显式使用。
5. DPCC 账号仍保留 Claude provider token 与 Codex provider token，因为 Pi 默认 upstream 当前同时使用 Anthropic Messages 和 OpenAI Completions provider。
6. 第一阶段保留 `window.claude.acp` preload namespace，避免把 runtime 收敛与 API namespace 重命名混在同一改动中。
7. WeChat 在 Pi adapter 完成前不再启动旧 Claude/Codex adapter；不能静默把旧 engine alias 路由到 Pi。
8. Plugin Center 新安装的 Skill 只写 Pi 支持的 project/global `.agents/skills`。历史 Claude/Codex Skill manifest 仅用于安全迁移与删除。
9. Project Skill 通过 Pi 的显式 `--skill` 路径加载，不使用 `--approve`，避免顺带信任项目内可执行的 `.pi` extension。
10. Project MCP 配置通过锁定版本的 bundled `pi-mcp-adapter` 注入；配置文件逐进程生成、权限为 `0600`、退出即删除。MCP 变更对 built-in Pi 采用完整进程重启。

## 非目标

- 不创建 Pi 私有协议或 `engine: "pi"` 分支。
- 不修改 DPCC 服务端账号授权和 `/v1/models` contract。
- 不把 Claude/Codex 的 native resume ID 转换为 ACP `agentSessionId`。
- 不在首阶段重命名所有 `window.claude.*` 通用 IPC namespace。
- 不保证重现 Claude checkpoint/file revert 或 Codex collaboration mode 的全部语义。
- 不删除用户已经保存的 custom ACP Agent 配置。

## 当前架构与主要耦合

### 共享类型

`shared/types/engine.ts` 当前存在以下耦合：

- `EngineId = "claude" | "acp" | "codex"`。
- `SlashCommand.source` 包含 Claude/Codex 专属来源。
- `RespondPermissionFn` 直接引用 `@anthropic-ai/claude-agent-sdk` 的 `PermissionMode` 和 `PermissionUpdate`。
- `AppPermissionBehavior` 包含 Codex 专属 `allowForSession`。

`src/types/session.ts` 和 `shared/lib/session-persistence.ts` 保存：

- `engine`
- `agentId`
- `agentSessionId`
- `codexThreadId`
- `codexRolloutPath`
- `delegatedFromSessionId`
- Claude effort、permission 和 plan 相关字段

当前 `extractSessionMeta()` 直接转换 `data.engine`，没有 schema migration 或 legacy runtime disposition。

### Renderer session 生命周期

`useSessionPane` 当前为每个 pane 无条件调用：

- `useClaude`
- `useACP`
- `useCodex`

以下 hooks 均维护三引擎条件分支：

- `src/hooks/useSessionManager.ts`
- `src/hooks/session/useDraftMaterialization.ts`
- `src/hooks/session/useSessionRevival.ts`
- `src/hooks/session/useSessionLifecycle.ts`
- `src/hooks/session/useSessionPersistence.ts`
- `src/hooks/session/useSessionCrud.ts`
- `src/hooks/session/useSessionSettings.ts`
- `src/hooks/session/useSessionPane.ts`
- `src/hooks/session/useExtraPaneLoader.ts`

当前 draft、session switch、split pane、background event、MCP、model、permission 和 restart 都需要根据 engine 选路。

### Main process

`electron/src/main.ts` 同时注册：

- `claudeSessionsIpc`
- `acpSessionsIpc`
- `codexSessionsIpc`

并维护 Claude 到 Codex 的 visible delegation bridge、三类 active turn 计数和三类 shutdown cleanup。

`electron/src/preload.ts` 与 `src/types/window.d.ts` 同时暴露三套 API。

### Pi 当前运行方式

官方 Pi 通过 `electron/src/lib/pi-acp-config.ts` 识别：

```ts
agent.id === "pi-acp"
  && agent.engine === "acp"
  && agent.builtIn === true
  && agent.registryId === "pi-acp"
```

启动流程为：

1. 校验受保护身份同时满足 `id: "pi-acp"`、`builtIn: true`、`registryId: "pi-acp"`。
2. 从安装包解析锁定版本的 `pi-acp` entry、Pi entry、wrapper 与 Electron runtime host，不查询 PATH。
3. 解析 Pi `default`、`local` 或 `gateway` upstream。
4. 在 managed 模式构造隔离的 `PI_CODING_AGENT_DIR`。
5. 写入隔离的 `models.json` 和 `settings.json`。
6. 只向 child process 注入所需 provider credential。
7. 通过 ACP `ClientSideConnection` 启动和管理会话。

此链路应完整保留。

## 目标架构

### Agent 身份

所有新建内置会话必须写入：

```ts
{
  engine: "acp",
  agentId: "pi-acp"
}
```

禁止新增 `engine: "pi"`。built-in Pi 特殊行为只能由完整的受保护身份识别，不能只凭显示名、binary 或 `registryId`；custom ACP Agent 即使运行用户本机 Pi，也保持独立 Agent ID 和自己的启动定义。ACP 仍是唯一 runtime protocol。

### Engine 类型策略

迁移期将 runtime 类型与持久化兼容类型分开：

```ts
export type RuntimeEngineId = "acp";
export type LegacyEngineId = "claude" | "codex";
export type PersistedEngineId = RuntimeEngineId | LegacyEngineId;
```

约束：

- 新 session 只能接收 `RuntimeEngineId`。
- session loader 可以读取 `PersistedEngineId`。
- legacy engine 不得进入 runtime start/revive/send 路径。
- 旧字段暂时保留在 persisted schema 中，以支持展示和回滚。

### Session runtime disposition

加载持久化会话后，派生运行状态：

```ts
type SessionRuntimeDisposition =
  | { kind: "runtime"; engine: "acp"; agentId: string }
  | { kind: "legacy-read-only"; engine: "claude" | "codex" };
```

该状态优先通过纯函数派生，不写回旧 session 文件，避免升级后旧版本无法读取。

## 用户数据兼容

### 新 session

- 默认 `engine` 为 `acp`。
- 默认 `agentId` 为 `pi-acp`。
- 保存 ACP 返回的 `agentSessionId`。
- 不再写入新的 `codexThreadId`、`codexRolloutPath` 或 `delegatedFromSessionId`。
- 不再写入 Claude-specific effort。

### 已有 Pi/ACP session

- 保持现有 `acp:revive-session` 路径。
- 使用保存的 `agentId` 和 `agentSessionId`。
- `agentId: "pi-acp"` 必须始终解析到内置 Pi 定义。
- 如果 Pi 不支持 `session/load`，继续使用已有上下文恢复策略，不伪造 session ID。

### 已有 Claude/Codex session

允许：

- 查看消息和 tool result。
- 搜索、固定、重命名、移动文件夹、删除和导出。
- 复制历史内容后创建新的 Pi session。

禁止：

- 调用 `claude:start` 或 `codex:resume`。
- 将 `codexThreadId` 当作 `agentSessionId`。
- 在旧 session 内直接发送并静默切换 runtime。

UI 必须显示明确的只读状态，并提供“使用 Pi 新建会话”的显式操作。

### 设置兼容

- 保留旧 `harnss-*-model-claude` 和 `harnss-*-model-codex` key，不主动删除。
- 新默认读取 Pi/ACP model 设置。
- 仅当 Pi 设置不存在时，允许使用明确的 fallback；不得覆盖已有 Pi model。
- AppSettings 中 Claude/Codex binary 和 gateway 字段保留一个兼容周期，但不再在普通 UI 中显示或写入。
- 删除持久化字段必须通过独立 schema version migration 完成，不与 runtime 切换同批进行。

## Agent registry 改造

### 内置列表

`electron/src/lib/agent-registry.ts` 最终只注册 `BUILTIN_PI`：

```ts
const BUILTIN_IDS = new Set(["pi-acp"]);
```

内置 Pi：

- 不可删除。
- 不可被用户 agent definition 覆盖。
- 必须带 `registryId: "pi-acp"`，确保进入 Pi-specific launch preparation。
- definition 使用不可执行的标记值 `binary: "bundled:pi-acp"`，main process 必须解析 bundled runtime，不能把标记值交给 `spawn()`。
- built-in 启动忽略 definition 中的 binary、args、`PI_ACP_PI_COMMAND` 和系统 PATH；仅显式 recovery E2E test mode 可注入绝对 fixture command。
- custom ACP Agent 继续使用自己的 binary、args 和 env；要运行用户本机 Pi，必须使用不同 Agent ID 明确创建 custom Agent。

### Cached draft metadata

内置 Pi 的可执行 definition 仍由代码固定，但允许在 `agents.json` 中仅持久化安全的 draft cache 字段：

- `cachedConfigOptions` 保存上一次 live runtime 返回的 model/thinking 目录及当前值。
- `cachedSlashCommands` 保存上一次 live runtime 返回的 `/` 命令目录；固定的 pi-acp built-in commands 同时作为 fresh install fallback。
- 读取内置记录时必须丢弃其中的 name、binary、args、env、builtIn 等启动字段，再与代码中的 canonical Pi definition 合并。
- Pi source、gateway 和默认 model 继续存储在 AppSettings；cache 不是第二套上游配置源。

新旧 session 均先用 cache 立即渲染 model、thinking 和 `/` 命令。Pi draft 还会在 main process 直接扫描本地 prompt/Skill 目录补齐 command catalog；该扫描不创建 Pi/ACP 子进程。首次发送才启动或恢复 Pi；`session/new` / `session/load` 返回后，以 live runtime 目录校验用户在 draft 中选择的值，跳过已失效值，并用最终 live 结果覆盖 cache。

custom ACP Agent 继续使用同一套 `agents.json` cache 行为。

## Renderer 实现

### 默认 Agent

以下默认值统一改为 Pi：

- `selectedAgent`
- draft `StartOptions.engine`
- draft `StartOptions.agentId`
- `buildSessionOptions()`
- `handleNewChat()`
- `handleSend()` 的跨 Agent 判断
- keyboard shortcut 的 active runtime
- per-project model selector

禁止继续使用 `null` 表示 Claude。未选择 Agent 时必须显式解析到内置 Pi。

### Session pane

`useSessionPane` 只调用 `useACP`，并移除：

- `claudeSessionId`
- `codexSessionId`
- `codexSessionModel`
- `codexPlanModeEnabled`
- `claude`/`codex` hook return
- engine 三选一逻辑

split pane 每个 pane 仍各自拥有独立 `useACP` 状态。

### Draft materialization

采用历史 Claude Code/Codex 的 lazy materialization 策略：

1. 新建 draft 只设置 project、Agent identity、缓存的 `configOptions` 和预加载的 slash commands，不调用 `acp:start`，也不创建 Pi 上游/MCP 隔离环境。
2. draft 中的 model/thinking 修改只更新本地缓存快照。
3. 首次发送时才读取 project cwd 和 MCP servers，并使用 `agentId: "pi-acp"` 调用 `acp:start`。
4. `session/new` 完成后，按 model 优先顺序应用仍被 live runtime 支持的 draft 选择；live `configOptions` 覆盖缓存值。
5. renderer listeners attach 后发送第一条 prompt，并将 draft materialize 为 persisted Pi session。
6. `/` 命令继续在 draft 阶段提前展示：先使用 pinned built-ins 和 `cachedSlashCommands`，再由不启动子进程的本地 prompt/Skill catalog 补齐；live runtime 返回命令后刷新 cache。
7. draft 在启动前被放弃时不产生子进程；启动过程中被放弃则调用 `acp:abort-pending-start`，认证后已有 session 时调用 `acp:stop`。

旧 session 使用同一策略：打开时只读磁盘消息和 cache，不请求不存在的 session 配置；首次发送时调用 `acp:revive-session`，再由 live 结果校正 cache。

### Revival

只保留 ACP revival：

```ts
window.claude.acp.reviveSession({
  agentId: "pi-acp",
  cwd,
  sessionId,
  agentSessionId,
  mcpServers,
});
```

legacy session 必须在进入 revival 前被拦截。

### Model 与 Thinking

- Pi model 与 thinking 以 ACP `configOptions` 为 session runtime authoritative source。
- 用户修改通过 `acp:set-config` 提交。
- AppSettings 中 `dpccUpstream.piModel` 继续保存启动前默认值。
- 不使用 Claude effort 或 Codex reasoning effort 作为 Pi runtime 状态。
- capability metadata 仅用于提供合法默认值和展示，不覆盖 Agent 返回的实际 config options。

### Permission 与 mode

- 继续使用 ACP permission request/option response。
- `acpPermissionBehavior` 继续支持 ask 和现有安全自动响应策略。
- 删除 Claude `PermissionMode` 和 Codex `allowForSession` 依赖。
- plan/safe/auto 等 UI 只有在 Pi ACP 明确暴露对应 mode/config 时显示。
- 不根据旧 engine 模式猜测 Pi 配置。

### 功能下线或变化

- Claude checkpoint/file revert：移除对应按钮和调用；如需恢复，后续设计 engine-neutral Git checkpoint。
- Codex collaboration mode/plan events：移除 Codex 专属状态；Pi task/plan 仅按 ACP events 展示。
- Claude to Codex delegation：删除 bridge toggle、split orchestration 和 delegation session metadata 新写入。

## Main process 与 IPC

### 保留

- `electron/src/ipc/acp-sessions.ts`
- ACP process spawn、initialize、authenticate、prompt、cancel、stop、reload 和 revival
- MCP server 注入
- ACP config options 和 available commands
- Pi-specific `preparePiAcpLaunch()`
- `PI_CODING_AGENT_DIR` 隔离和 child-only credential injection

### 删除

最终阶段删除：

- `electron/src/ipc/claude-sessions.ts`
- `electron/src/ipc/codex-sessions.ts`
- `electron/src/lib/sdk.ts`
- Claude binary、gateway env、model cache 和 MCP isolation helpers
- Codex binary、RPC、utility prompt 和 generated protocol runtime consumers
- Claude to Codex bridge controller、MCP helper 和 IPC channels
- main process 的 Claude/Codex active turn count 与 shutdown cleanup

删除顺序必须在 renderer 不再引用相关 IPC 之后。

### Preload 兼容

第一阶段：

- 保留 `window.claude.acp`。
- 删除 renderer 引用后，再移除顶层 Claude 和 `window.claude.codex` 方法。
- `src/types/window.d.ts` 与 preload 实现必须同批更新。

后续可单独设计：

```ts
window.agent.acp
```

本 Spec 不要求第一阶段完成 namespace 重命名。

## Title 与 commit message

### Chat title

- 已有 live Pi session 时使用 `acpUtilityPrompt()`。
- 没有 live Pi session 或 utility prompt 失败时，使用确定性的本地 title fallback。
- 禁止回退到 Claude SDK 或 Codex utility process。

### Git commit message

- 有 active Pi session 时使用 ACP utility prompt。
- 没有 active Pi session 时返回明确的 unavailable 状态，由 UI 提示先启动 Pi session。
- 不为 commit message 隐式启动未展示的 Claude/Codex process。

## Background session 与 Task

- `BackgroundSessionStore` 只保留 ACP event handler。
- Claude/Codex background handler 在兼容期不再接收新 session，最终删除。
- Pi Task/subagent 继续复用 ACP `tool_call`、`tool_call_update` 和 task adapter。
- 若 ACP/Pi 不提供单个 subagent cancel，Stop 操作必须明确表示会取消整个当前 turn。
- 不再调用 Claude `stopTask`。
- 不再依赖 Claude background-agent JSONL output 作为 Pi 的权威状态。

## WeChat

### 迁移要求

最终目标：

```ts
type WeChatTool = "pi";
```

需要新增 Pi ACP WeChat adapter：

- 使用同一 `preparePiAcpLaunch()`。
- 每个 WeChat user 维护独立 ACP `agentSessionId`。
- 使用 ACP permission/config 语义。
- `session-sink` 保存 `engine: "acp"` 和 `agentId: "pi-acp"`。
- 不再依赖 Claude session ID 或 Codex `--last`。

旧 `@claude`、`@cc`、`@codex`、`@cx` alias：

- 不静默映射到 Pi。
- 返回迁移提示，告知使用 `@pi`。
- 一个兼容周期后删除。

在 Pi adapter 完成之前，Pi-only build 不得启动旧 WeChat adapters。

## Account 与 upstream

### 保留当前账号 contract

Pi `default` source 当前需要两个 provider：

- `pcc-agent-dpcc-claude`，API 为 `anthropic-messages`。
- `pcc-agent-dpcc-codex`，API 为 `openai-completions`。

因此本次 engine 删除不改变：

- `StoredAccountCredential.accessTokens.claude`
- `StoredAccountCredential.accessTokens.codex`
- browser authorization token exchange response
- DPCC `/v1/models` 的分 provider catalog 获取

这些名称描述 provider credential，不再表示用户可选择的内置 Agent。

### Current Config

- 普通 UI 只展示 Pi effective config。
- 内部兼容期可以保留 `{ claude, codex, pi }` IPC response shape。
- renderer 完成迁移后再收敛为 Pi-only response，避免同批破坏 preload、settings 和 tests。

## Settings UI

删除或隐藏：

- Claude binary source、custom path 和 update controls。
- Codex binary source、custom path、client name 和 update controls。
- Claude/Codex gateway source cards。
- Claude to Codex bridge toggle。
- Claude effort 和 Codex collaboration controls。

保留：

- Pi source：`default`、`local`、`gateway`。
- Pi gateway URL、API key、model mappings。
- DPCC Pi default model。
- Pi runtime status。
- ACP permission behavior。
- custom ACP Agent 管理入口。

Pi runtime status 必须明确显示：

- runtime source 固定为 `bundled`，以及是否 `offlineReady`。
- bundled Pi entry、`pi-acp` entry、`pi-mcp-adapter` entry、MCP bridge、headless Electron host 和 wrapper 是否存在。
- 实际版本与锁定版本。
- 缺失或损坏时提示重新安装/更新 PccAgent，不引导用户全局安装 npm package。

## Packaging 与依赖清理

### 删除 Claude/Codex 发行内容

- 从 `package.json` 删除 `bundle:codex` 和 dist 脚本中的 Codex bundling。
- 删除 `scripts/bundle-codex.js`。
- 删除 `build/codex-vendor` 相关 electron-builder 配置。
- 删除 GitHub Actions 中各平台的 Codex bundle step。
- 在无 runtime consumer 后删除 `@anthropic-ai/claude-agent-sdk` 及其 optional platform packages。
- 检查 `@anthropic-ai/sdk` 的实际 imports 后决定是否删除。
- 保留 `@agentclientprotocol/sdk`。
- 更新 `pnpm-lock.yaml`、产品描述、i18n、release docs 和 test map。

### 内置 Pi Runtime 发行 contract

- `package.json` 和 `pnpm-lock.yaml` 锁定 Pi `0.84.1`、`pi-acp` `0.0.33`、`pi-mcp-adapter` `2.31.0` 及同版本 Pi 家族依赖，并保留 registry integrity。
- Pi CLI 与 adapter JS 位于 packaged `app.asar/node_modules`；wrapper 与 third-party notice 位于 `extraResources/pi-runtime`。
- PccAgent Electron runtime 是唯一 Node host；macOS 必须解析到 headless Helper，其他平台使用应用 Electron executable。wrapper 不执行系统 `node`、`pi`、`pi-acp` 或 `npx`。
- native `.node` 与 WASM 资源通过 `asarUnpack` 交付；macOS arm64/x64、Windows x64、Linux arm64/x64 分别由云端构建验证。
- 安装和首次启动不下载 runtime。runtime 升级跟随 PccAgent 版本、签名、回滚和 auto-update，不建立第二套在线更新器。
- packaged smoke 必须在空 PATH 下实际执行 bundled Pi `--version`，并验证 main process 报告 `offlineReady: true`。

## 分阶段实施

### Phase 0：兼容模型和测试护栏

目标：在不改变用户可见行为前，建立 legacy/runtime 边界。

主要改动：

- 引入 `RuntimeEngineId`、`LegacyEngineId`、`PersistedEngineId`。
- 增加 session runtime disposition helper。
- 为 legacy session 增加只读派生状态和测试。
- 将 shared permission 类型与 Anthropic SDK 解耦。

验收：

- 当前 session 文件全部可加载。
- 未发生持久化数据重写。
- 新增 migration/helper tests 通过。

### Phase 1：Pi 成为唯一内置 Agent

目标：新用户路径只出现 Pi。

主要改动：

- `agent-registry.ts` 注册 `BUILTIN_PI`，移除 Claude/Codex built-in definitions。
- renderer 默认 agent 改为 `pi-acp`。
- Agent picker 将 Pi 作为唯一内置 Agent；custom ACP 单独分组。
- Settings UI 隐藏 Claude/Codex controls。
- 所有新建 session 写入 `engine: "acp"`、`agentId: "pi-acp"`。

兼容：

- Claude/Codex runtime 暂时仍存在，但新 UI 不可启动。
- old session 已进入 legacy read-only 行为。

### Phase 2：Renderer ACP-only

目标：renderer 会话运行逻辑只依赖 `useACP`。

主要改动：

- 简化 `useSessionPane` 和 `useSessionManager`。
- 删除 draft/materialization/revival/persistence/settings 中 Claude/Codex 分支。
- split pane、background routing、MCP、permission、model、thinking 只走 ACP。
- 删除 bridge UI 和 Codex plan/Claude revert UI。

### Phase 3：Main 和 preload ACP-only

目标：运行时不再启动 Claude/Codex process。

主要改动：

- 停止注册 Claude/Codex session IPC。
- 删除 Claude to Codex bridge。
- title/commit message 改为 Pi ACP/fallback。
- main lifecycle、active turn count 和 shutdown 只处理 ACP。
- 删除 preload 与 `window.d.ts` 中已无消费者的 API。

### Phase 4：旁路功能迁移

目标：消除外围 Claude/Codex runtime dependency。

主要改动：

- WeChat Pi ACP adapter。
- ACP-only background agents/task cancel 行为。
- Claude Code import 调整为历史 transcript import。
- Current Config 收敛为 Pi。
- 清理旧 settings UI、notifications、analytics 和 docs 中 engine 分支。

### Phase 5：依赖与发行包清理

目标：构建产物不再包含 Claude/Codex runtime。

主要改动：

- 删除 SDK、Codex vendor、bundle script 和 CI step。
- 删除无消费者的 Claude/Codex source、tests 和 generated protocol types。
- 更新 lockfile、产品描述、release history、i18n 和打包 smoke。

### Phase 6：随包内置 Pi Runtime（必做）

目标：用户无需预装 `pi`、`pi-acp`、`pi-mcp-adapter` 或 Node；built-in Pi 在空 PATH 与离线环境中可启动。实现包括依赖锁定、wrapper、headless Electron host、MCP bridge、`extraResources`、`asarUnpack`、runtime doctor、packaged smoke 和三平台 CI。

## 建议提交边界

1. `refactor(session): define runtime and legacy engine boundaries`
2. `feat(pi): make Pi the only built-in agent`
3. `refactor(session): make renderer sessions ACP-only`
4. `refactor(electron): remove Claude and Codex runtime IPC`
5. `feat(wechat): route WeChat sessions through Pi ACP`
6. `chore(packaging): remove Claude and Codex distribution assets`
7. `chore(docs): document Pi-only runtime and migration`

每层独立验证，不把依赖删除与 session migration 混在同一提交。

## 测试计划

### Unit tests

- built-in registry 只返回 Pi，并保护 Pi 不被覆盖或删除。
- official Pi detection 使用稳定 `registryId`。
- legacy session disposition 不修改原始数据。
- 新 session 规范写入 ACP/Pi identity。
- model/thinking config 使用 ACP config option。
- permission response 不依赖 Anthropic/Codex 类型。
- local/default/gateway Pi upstream 保持隔离和 fail-closed 行为。
- legacy localStorage 不覆盖已有 Pi 设置。

### Integration tests

- fresh Pi session start、first prompt 和 completion。
- Pi session revive、session ID replacement 和 persistence copy。
- split pane 同时运行两个 Pi session。
- interrupt、cancel、stop、reload 和 MCP reconnect。
- Plugin Center project/global Skill 安装后，真实 Pi 子进程能发现 Skill；不能只断言目录写入成功。
- 真实 bundled Pi + `pi-mcp-adapter` + MCP stdio 子进程启动，并向模型暴露配置的 tool。
- authentication required 和 permission response。
- 新旧 session 在无 Pi 子进程时立即显示缓存的 config option、model、thinking 和 slash commands；首次发送后由 live runtime 校正缓存。
- background session completion 和 unread state。
- title generation live-session path 和 local fallback。
- Git commit message 有/无 active Pi session。
- old Claude/Codex session 只读、复制、删除和搜索。
- WeChat Pi session isolation、resume 和 cancel。

### Packaging tests

- packaged app 不包含 Codex vendor。
- packaged app 不加载 Claude Agent SDK。
- macOS、Windows 和 Linux build 均能启动。
- source/runtime tests 证明 built-in 忽略 PATH 和用户 agent binary。
- macOS source/runtime tests 证明 Pi 使用 `LSUIElement` Helper，不把 GUI Electron executable 作为 Node host。
- packaged smoke 验证 runtime entries、wrapper、版本和空 PATH 离线启动；macOS 必须校验 packaged Helper 的 `LSUIElement=true`，并通过该 Helper 启动 Pi，而不是通过 GUI executable。
- 云端 macOS、Windows 和 Linux artifact 分别验证架构、签名与启动；本机不以未签名临时包替代该门禁。

### Required commands

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test-map:check
pnpm docs:check
pnpm package:smoke
git diff --check
```

## 升级与回滚

- 首个 Pi-only release 不删除或重写旧 session 文件。
- 首个 Pi-only release 不清理旧 localStorage/AppSettings 字段。
- 不删除用户保存的 custom ACP Agent 配置。
- legacy session banner 必须说明 runtime 已移除，而不是报告普通连接失败。
- 若 release 回滚，旧版本仍能读取原始 session/settings 数据。
- 只有在完成至少一个兼容周期和数据审计后，才允许删除 legacy persisted fields。

## 日志与错误要求

- bundled host、wrapper、Pi package、`pi-acp` package、`pi-mcp-adapter` package、MCP bridge 和版本不匹配必须是不同稳定错误码。
- Pi upstream catalog 缺失、credential 缺失和 runtime 缺失必须区分。
- 不在 renderer、日志或 session 文件中输出明文 provider key。
- legacy session 的只读状态不是 runtime crash，不记录为异常退出。
- ACP exit 必须清除 `isConnected`、`isProcessing` 和未完成 tool 状态。

## 成功标准

- Agent picker 中 Pi 是唯一内置 Agent。
- 新建、发送、重启、恢复和 split session 全部只走 ACP/Pi。
- 运行期间不会生成 Claude Code 或 Codex child process。
- 旧 Claude/Codex session 可查看且不会触发旧 runtime。
- Pi `default`、`local`、`gateway` source 均正常工作。
- Pi model、thinking、permission、MCP、tools 和 slash commands 正常。
- Plugin Center 的 Skill/MCP 只路由到 Pi；project Skill 在 ACP/RPC 非交互模式中真实可见，MCP 使用 bundled adapter 真实启动。
- macOS 启动 Pi 时不产生第二个 Dock `exec` App。
- WeChat 不再启动 Claude/Codex adapter。
- 最终安装包不包含 Claude SDK 或 Codex vendor。
- 全量测试、typecheck、build、test-map、docs 和 packaged smoke 通过。
- Windows、macOS 和 Linux 发行物分别完成验证。

## 实现前决策门

以下事项需要在 Phase 1 开始前确认：

1. “只保留 Pi”是否仍允许用户安装 custom ACP Agent。本 Spec 默认允许。
2. 旧 Claude/Codex session 是否采用只读加“使用 Pi 新建会话”。本 Spec 默认采用。
3. 首个 Pi-only release 必须 bundled `pi` 与 `pi-acp`，不接受 PATH-managed built-in；该决策已确认。
4. WeChat 是否必须与首个 Pi-only release 同时可用。本 Spec 默认先禁止旧 adapter，Pi adapter 在 Phase 4 恢复。
5. DPCC 账号双 provider token contract 是否保持。本 Spec 默认保持。
6. Claude checkpoint/file revert 是否允许下线。本 Spec 默认下线，后续另做 engine-neutral Git checkpoint。
