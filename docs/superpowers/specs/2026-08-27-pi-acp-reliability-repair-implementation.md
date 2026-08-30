# Pi ACP Session 可靠性修复实现 Spec

## 文档状态

- 状态：Implemented in working tree，并作为 Pi-first runtime 的长期可靠性基线；等待三平台 quality/package CI 与 required branch rule 外部确认
- 关联设计：`docs/superpowers/specs/2026-08-27-pi-only-agent-runtime-design.md`
- 基线提交：`374b73347ac4`
- 目标产品：PccAgent / Harnss
- 本文范围：修复 Pi ACP 会话“实际上失败、界面却显示成功”的跨层语义丢失

修复代码、integration harness、Electron recovery E2E、runtime doctor 和 quality workflow 已落地；最终完成仍取决于本地全量门禁、云端三平台 package smoke，以及仓库 branch protection 将 `quality` 设为 required check。

本契约适用于后续所有 Pi runtime 演进：新增 provider、tool、Skill、MCP、session lifecycle 或 retry 行为时，必须延续 canonical outcome、真实 bundled child integration、Electron recovery 和结构化观测要求，不能退回“Promise resolve 即成功”或纯 mock 覆盖。

## 1. 背景和已确认根因

### 1.1 事故表现

Pi 上游请求失败后，用户看到：

```text
Retrying (attempt 1/3, waiting 2s)...
Retrying (attempt 2/3, waiting 4s)...
Retrying (attempt 3/3, waiting 8s)...
Retry finished, resuming.
```

但 Harnss 将这次 turn 保存成了已完成的 assistant 消息，request record 也是 `completed`，没有向 UI 发送失败状态。

### 1.2 根因，不是“错误字符串不够漂亮”

当前问题是跨层语义丢失：

1. Pi 内部记录了 `stopReason: "error"` 和 `errorMessage`。
2. `pi-acp` 将内部 error 映射成 ACP 合法的 `end_turn`，同时把自动重试状态作为 ACP message chunk 发出。
3. Harnss 只看 `connection.prompt()` 是否 resolve，以及 ACP 的 `stopReason`，没有把 Pi 的失败诊断纳入最终判定。
4. renderer 把 retry 文本当成 assistant 正文持久化。

因此，`extractErrorMessage()` 只能负责安全提取文本，不能决定一个 turn 成功还是失败。错误文本提取、协议结果判定、业务状态落库必须是三个不同层次。

### 1.3 本次修复目标

修复后必须保证：

- Pi upstream/runtime 失败不会被标成成功。
- 自动 retry 诊断不会进入 assistant 正文或用户历史。
- main、preload、renderer、background、request tracker 对同一个 turn 使用同一个最终状态。
- Electron 重启后，已持久化的 Pi session 能按契约恢复；恢复失败会显示真实原因。
- 测试真正启动 ACP/Pi 子进程，而不是只 mock `connection.prompt()`。
- runtime、Node、adapter 和测试环境可重复得到同样结果。
- PR 的全量质量门禁不是“建议运行”，而是 required check。

## 2. 范围和非目标

### 2.1 本次包含

1. Pi ACP turn outcome contract。
2. Pi retry/error event 的识别和持久化隔离。
3. ACP child-process integration test。
4. Electron restart-recovery E2E。
5. 结构化错误和运行时观测。
6. runtime manifest、doctor 和 CI 复现环境。
7. full PR quality gate、test map 和 branch protection 配置说明。

### 2.2 本次不包含

- 不为将要移除的 Claude/Codex runtime 增加新的 live integration test。
- 不把旧 Claude/Codex session 自动转换成 Pi session。
- 不把 Pi retry 的任意普通文本都当作失败。
- 不把 `extractErrorMessage()` 扩展成业务状态机。
- 不依赖真实外网 provider 才能通过 required PR gate。
- bundled Pi Runtime 按关联 Pi-only spec 同批实现；本 spec 负责证明它不会被 PATH runtime 假通过。
- 不用一次大重构同时删除所有 Claude/Codex 源码；旧 runtime 下线按 Pi-only spec 分阶段执行。

## 3. 跨层成功/失败契约

### 3.1 分层原则

必须区分以下四件事：

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Pi/native | 报告 provider、runtime、retry、agent settled 等事实 | 决定 Harnss UI 文案 |
| ACP adapter | 将事实映射为 ACP protocol event/response | 把错误伪装成成功 |
| Harnss main | 结合 ACP response 和已观察事件形成 canonical outcome | 重新猜测任意模型文本 |
| renderer/background | 按 canonical outcome 更新 UI、工具和 processing 状态 | 再次推断上游是否成功 |

### 3.2 Canonical turn outcome

shared contract 采用显式 discriminated union：

```ts
type ACPPiTurnOutcome =
  | {
      status: "completed";
      turnId: string;
      stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal";
      usage?: { inputTokens?: number; outputTokens?: number } | null;
    }
  | {
      status: "cancelled";
      turnId: string;
      stopReason: "cancelled";
    }
  | {
      status: "failed";
      turnId: string;
      error: {
        code: string;
        message: string;
        source: "harnss" | "acp" | "pi" | "upstream";
        stage: "spawn" | "initialize" | "authenticate" | "prompt" | "settle" | "persist";
        retryable: boolean;
        cause?: string;
      };
    };
```

`session/prompt` 的 IPC return 还要区分“canonical outcome 已通过 event 发出”和“调用本身在 outcome 形成前失败”：

```ts
type ACPPromptResult =
  | { ok: true; outcome: ACPPiTurnOutcome & { status: "completed" | "cancelled" }; outcomeDelivered: true }
  | { ok: false; outcome: ACPPiTurnOutcome & { status: "failed" }; outcomeDelivered: true }
  | { ok: false; status: "transport_error"; error: ACPErrorDetails; outcomeDelivered: false };
```

要求：

- `connection.prompt()` resolve 不能单独代表成功。
- ACP `stopReason` 必须校验；未知值形成 `acp_invalid_stop_reason`。
- `cancelled` 只用于明确的用户取消/adapter cancel，不把 provider error 归入取消。
- `failed` 必须包含稳定 error code；message 是给人看的摘要，不是唯一依据。
- 同一 `turnId` 只能产生一次 terminal outcome。
- renderer 收到 `outcomeDelivered: true` 后，不得再追加第二条相同错误。

### 3.3 Pi retry 规则

先锁定一个事实：当前已验证的 `pi-acp@0.0.33` 不把 Pi 的 `auto_retry_start` / `auto_retry_end` 作为结构化 ACP event 暴露，而是转换为 `agent_message_chunk`。因此本次不能在 spec 里假设“结构化 retry event 已经存在”。实现按以下优先级处理：

1. 若未来锁定的 adapter 版本提供结构化 retry/error metadata，优先读取该 metadata。
2. 对当前锁定版本 `0.0.33`，只在 `agentId/registryId === "pi-acp"` 且 adapter version 已通过兼容矩阵时，识别 adapter 生成的固定 `agent_message_chunk` 文本。
3. 未知 adapter version、消息格式变化或无法确认来源时，形成 `pi_adapter_version_unsupported` 并 fail closed，不能默认为成功。
4. 普通 custom ACP Agent 永远不使用 Pi 专属文本规则。

测试通过 `PI_ACP_PI_COMMAND` 注入确定性的 Pi RPC fixture；这是当前 `pi-acp` source 支持的 child-command 参数。该变量只由 test harness 设置，普通生产启动不注入。

分类条件：

- 只有 retry diagnostics，没有有效 assistant 文本、tool call 或后续成功输出，并以 `end_turn` settle：`failed`，code 为 `pi_retry_exhausted`。
- retry 后出现有效 assistant/tool 输出且没有终态 error：`completed`；retry 过程可以进入诊断日志，但不能进入 assistant 正文。
- Pi stderr 明确报告 runtime/provider error：`failed`，来源按证据标成 `pi` 或 `upstream`。
- 只有普通模型文本包含 “retry” 一词：不得据此失败。
- adapter 版本不在兼容矩阵中：记录 `pi_adapter_version_unsupported`，required integration test fail closed，不得默认为成功。

### 3.4 状态传播和持久化

一个 turn 的状态传播顺序固定为：

```text
Pi/native event
  -> ACP session/update + prompt response
  -> main canonical outcome (turnId)
  -> acp:turn_complete
  -> renderer/background state cleanup
  -> request tracker terminal record
  -> session persistence
```

规则：

- failed turn 可以保存用户输入和诊断 system message，但不得保存 retry diagnostics 为 assistant answer。
- failed/cancelled turn 必须关闭 `isProcessing`，清理 pending tools；失败的 tool 不能显示 completed。
- request tracker 的 `status`、`errorCode`、`errorMessage` 必须与 canonical outcome 一致。
- Electron exit、renderer detach、transport reject 都必须最终清理 active turn；若没有 canonical Pi outcome，使用 `transport_error`，不能静默完成。
- background store 和 foreground hook 使用同一 `turnId` 做幂等处理。

### 3.5 持久化字段与 telemetry 字段分界

不能把所有诊断字段塞进 session JSON，也不能只把错误写到日志。字段分层固定如下：

| 载体 | 必须保存 | 明确不保存 |
| --- | --- | --- |
| `src/types/session.ts` 的 `UpstreamRequestRecord` | request id、可选 `turnId`、status、started/completed/duration、requestCount、safe `errorCode`、bounded `errorMessage`、usage | raw stderr、provider key、完整 prompt、堆栈全文 |
| main structured log | session/turn correlation、agent、adapter/Pi version、stage、stopReason、status、error source/code、retry/tool counters、bounded redacted stderr tail | credential value、Bearer token、完整环境变量 |
| renderer state/system message | status、稳定 code、用户可读安全摘要 | runtime secret、未经脱敏的 stderr |

`adapterVersion`、`piVersion` 和 retry/tool 计数是观测字段，不要求写入历史 session；如产品需要在 UI 展示，另加明确的 safe metadata 字段，不能复用 `message` 字符串。

## 4. 实现分层和文件责任

### Phase 0：先固定 contract

**文件/模块**

- `shared/types/acp.ts`
- `src/types/session.ts`
- `shared/lib/acp-turn.ts`
- `shared/lib/error-utils.ts`
- `electron/src/lib/upstream-request-tracker.ts`

**要求**

- 定义 turn status、stop reason、error details 和 prompt result。
- `error-utils` 只做 bounded extraction、cause/metadata 保留和 secret redaction。
- classifier 接受结构化 observation，不直接依赖任意 UI 文本。
- tracker 支持一次性 terminal settle，并记录 error code/message。
- `UpstreamRequestRecord` 的 `turnId`、error 字段与 telemetry 字段边界必须先确定，不能让各层自行扩展同名字段。

**验收**

- unit tests 覆盖 normal、retry-only、retry-then-success、tool-only、cancel、invalid stop reason、stderr、transport error、循环对象和 secret redaction。
- classifier 测试证明“prompt resolve + end_turn”仍可能是 failed。

### Phase 1：main ACP 观测和 canonical outcome

**文件/模块**

- `electron/src/ipc/acp-sessions.ts`
- `electron/src/lib/acp-session-operations.ts`
- `electron/src/lib/acp-renderer-bridge.ts`
- `electron/src/lib/logger.ts`

**要求**

- 每个 prompt 生成 `turnId`，在 spawn/observe/settle/persist 全链路传递。
- 只在当前 turn 窗口内观察 Pi retry/error event，prompt 结束前完成分类。
- 一次 turn 只调用一次 tracker finish、一次 `acp:turn_complete` terminal event。
- preflight/start/auth/transport 错误必须与 prompt failure 区分。
- renderer detach 或 child exit 不能遗留 processing 状态。
- 对 `pi-acp@0.0.33` 使用受版本保护的 retry observation；如果 adapter version 不匹配，测试和运行时都不得静默降级为 completed。

**验收**

- 事故中的三次 retry 场景落为 `failed/pi_retry_exhausted`。
- 正常 Pi 输出落为 `completed`。
- cancel 落为 `cancelled`，不会显示 upstream error。
- log、request tracker、IPC event 的 `turnId` 一致。

### Phase 2：renderer/background 一致消费

**文件/模块**

- `src/hooks/useACP.ts`
- `src/lib/background/acp-handler.ts`
- `src/lib/background/session-store.ts`
- `src/hooks/session/useSessionPersistence.ts`
- `src/hooks/session/useMessageQueue.ts`
- `src/hooks/session/useSessionRevival.ts`

**要求**

- renderer 以 `acp:turn_complete.status` 为权威，不从 assistant 文本猜成功。
- failed/cancelled/completed 三条路径都清除 `isProcessing` 和 pending tool 状态。
- `outcomeDelivered: true` 时，send caller 不再重复 push error。
- background event 重放按 `turnId` 幂等。
- revive 后如果 child/runtime 失败，UI 显示具体阶段和 error code，不显示通用“连接失败”覆盖真实原因。

**验收**

- 前台和 background session 对同一失败各显示一次错误。
- session JSON 中没有 `Retrying...` assistant message。
- reload/revive 后不会把上一轮 `isStreaming` 当成正在运行。

### Phase 3：真实 ACP/Pi child-process integration

**新增文件建议**

- `scripts/fixtures/pi-rpc-fixture.mjs`
- `scripts/test-pi-acp-integration.mjs`
- `scripts/pi-runtime-versions.json`

**测试层级**

#### Tier A：真实 `pi-acp` child，确定性 Pi protocol fixture

- 测试通过 PccAgent Electron host 启动仓库锁定并将随包交付的真实 `pi-acp` entry，PATH 中的 adapter 不参与。
- 通过当前 `pi-acp` 支持的 `PI_ACP_PI_COMMAND` 指向 fixture Pi RPC process；测试 harness 必须传入绝对路径，不能依赖开发者 PATH 中另一个 `pi`。
- fixture 实现 `get_state`、`get_available_models`、`get_commands`、`prompt`、session load 所需的最小 RPC。
- fixture 提供三种模式：正常文本、retry-only failure、retry-then-success。
- 测试原始 JSON-RPC initialize、session/new、session/prompt、session/load；不 mock ACP `ClientSideConnection`。
- 每次运行使用临时 `PI_CODING_AGENT_DIR`、HOME 和 session directory，不读用户真实 Pi 配置。

#### Tier B：真实 Pi CLI + 本地兼容 provider fixture

- CI 通过 `pnpm install --frozen-lockfile` 使用 production dependencies 中的精确 Pi/adapter 版本，不再全局或临时 prefix 安装第二份 runtime。
- 使用本地 HTTP fixture 模拟 Anthropic Messages/OpenAI Completions 的成功、连接断开和最终恢复。
- 真实 Pi CLI 读取 fixture upstream，验证 native `stopReason`、session file 和 retry 行为。
- 禁止依赖公网、开发者个人 key 或个人 home directory。

**必须断言**

- fresh start 返回 ACP session ID。
- 正常 prompt 的 terminal outcome 是 completed。
- retry-only prompt 的 ACP response 即使为 `end_turn`，Harnss adapter observation 仍判为 failed。
- retry-then-success 不把 retry 文本保存为 assistant message。
- child 非零退出、stdout/stderr 错误、无响应超时分别形成可区分的 error code。
- session/load 能恢复已有 session；若 adapter 返回新 ACP ID，持久化层按明确规则更新，不伪造旧 ID。

**命令**

```bash
pnpm test:pi-integration
```

缺少 bundled host、Pi package、adapter package、wrapper 或版本不匹配时必须返回各自稳定 code，不能回退到 PATH 或 silently skip。required CI 不允许 optional pass。

Tier A 证明真实 `pi-acp` adapter 的 ACP child 边界和 Harnss 的失败分类；Tier B 才证明真实 Pi CLI 与本地 provider fixture 的 native session 行为。二者报告中必须分别标明，不能用 Tier A 的 fixture 结果冒充生产 provider 验证。

### Phase 4：Electron restart-recovery E2E

**新增文件建议**

- `scripts/test-electron-acp-recovery.mjs`
- `electron/src/lib/e2e/acp-recovery-harness.ts`（仅 test mode 使用）
- 必要的 test-only IPC/renderer bridge 测试入口

**测试约束**

- 必须启动真实 Electron 主进程、preload、renderer、ACP child；不能只调用 React hook 或 mock IPC。
- 使用临时 `userData`、project、agent registry 和 `PI_CODING_AGENT_DIR`。
- test mode 必须由显式环境变量/argv 开启，普通 packaged app 不暴露测试入口。

**场景 A：成功恢复**

1. 第一进程创建 Pi ACP session，发送 prompt 并等待 completed。
2. 确认 session JSON、agentSessionId、request record 已写盘。
3. 在 session 空闲时结束第一 Electron 进程。
4. 第二进程使用同一 userData 启动并 revive。
5. 断言 session 内容、agent identity、ACP load/new fallback 行为符合契约。
6. 再发送一条 prompt，断言第二轮完成且没有重复历史消息。

**场景 B：中途异常退出**

1. 第一进程启动 prompt 后，在 child/turn 活跃期间强制结束 Electron。
2. 第二进程启动并恢复同一 session。
3. 断言不会永久显示 processing，不会把未完成 tool 标成 completed。
4. 恢复失败时必须出现 stage、error code 和安全摘要。
5. 退出后确认没有遗留 ACP/Pi child process。

**命令**

```bash
pnpm test:electron-recovery
```

该测试不是单纯的 package smoke：package smoke 验证资源和基础 UI，recovery E2E 验证跨进程 session contract，二者不能互相替代。

E2E harness 的最低可执行入口必须能：

1. 通过临时 `userData` 启动第一份 Electron，并从 renderer 真实调用 preload API。
2. 读取一个由 main test mode 写出的 JSON result，而不是通过 stdout 猜测状态。
3. 结束第一进程后，用同一 `userData` 启动第二份 Electron，执行真实 `acp:revive-session`。
4. 对成功恢复、ID replacement、失败清理和 orphan child process 分别返回非零失败码。

### Phase 5：runtime 版本和环境复现

**当前已验证的初始兼容矩阵**

- Node：`22.19.0`（Pi `0.84.1` 的最低 Node 22 patch contract）。
- Harnss `@agentclientprotocol/sdk`：以仓库 `pnpm-lock.yaml` 的实际版本为准，当前代码为 `0.15.0`。
- `@earendil-works/pi-coding-agent`：`0.84.1`，binary `pi`。
- `pi-acp`：`0.0.33`，binary `pi-acp`。

上述值写入 `scripts/pi-runtime-versions.json`，并由 exact `package.json` dependency、Pi 家族 transitive override 与 `pnpm-lock.yaml` integrity 共同保证；manifest 同时记录 bundled mode、entry、Node minimum、平台、first-run download policy 和系统 PATH policy。升级任一值必须先更新 manifest、integration fixture、打包 contract 和兼容测试。

**runtime doctor**

新增 `pnpm pi:runtime:check`，分别检查：

- bundled Electron host、wrapper、Pi entry、adapter entry 是否存在且版本匹配。
- dependency 是否 exact、lockfile 是否有 integrity、distribution 是否声明不下载且忽略 PATH。
- adapter 是否能启动并完成 initialize。
- `PI_CODING_AGENT_DIR` 是否为临时隔离目录。
- 运行时缺失、catalog 缺失、credential 缺失、provider 不可达必须使用不同 code。

输出中禁止出现 API key、Bearer token、完整 credential env value 或 session secret；只输出存在性、路径、版本和安全摘要。

**CI 环境**

- 使用固定 Node patch version 和 `corepack pnpm`。
- 使用 `pnpm install --frozen-lockfile`。
- runtime doctor 和 integration 在空 PATH/伪造 PATH 下仍必须命中 bundled entry。
- `HOME`、Pi data dir、app userData、project 都使用临时目录。
- 明确 `CI=true`、locale、shell 和 timeout，避免依赖开发者机器配置。
- runtime manifest 变化必须触发 integration job。

### Phase 6：结构化观测

每个 ACP turn 至少记录以下字段：

```json
{
  "event": "ACP_TURN_COMPLETE",
  "sessionId": "redacted-or-short-id",
  "turnId": "uuid",
  "agentId": "pi-acp",
  "adapterVersion": "0.0.33",
  "piVersion": "0.84.1",
  "stage": "prompt",
  "status": "failed",
  "stopReason": "end_turn",
  "errorCode": "pi_retry_exhausted",
  "errorSource": "upstream",
  "retryNoticeCount": 3,
  "toolCallCount": 0,
  "usage": null,
  "durationMs": 1234
}
```

要求：

- 使用稳定 event name 和 error code，避免只写自然语言日志。
- stderr 只保留 bounded、redacted tail；日志中不打印 provider key。
- `ACP_SPAWN`、`ACP_INIT`、`ACP_AUTH`、`ACP_TURN_START`、`ACP_EVENT`、`ACP_TURN_COMPLETE`、`ACP_EXIT` 使用同一 session/turn correlation。
- renderer 收到的错误是安全摘要；main log 保留足够诊断字段。
- persisted request record 至少保存 status、errorCode、safe errorMessage、duration 和 request ID。
- legacy read-only 是产品状态，不记为 runtime crash。

## 5. 测试矩阵和 test map

### Unit

- `shared/lib/acp-turn.ts`：状态分类和 retry 规则。
- `shared/lib/error-utils.ts`：提取/脱敏/循环对象。
- `electron/src/lib/upstream-request-tracker.ts`：成功、失败、重复 finish。
- `electron/src/ipc/__tests__/acp-sessions.test.ts`：preflight、event、terminal outcome、cleanup。
- `src/lib/background/**`：幂等和 pending tool cleanup。
- `shared/lib/session-runtime.ts`：legacy read-only，作为 Pi-only 兼容契约。

### Required integration / E2E

- `scripts/test-pi-acp-integration.mjs`
- `scripts/test-electron-acp-recovery.mjs`
- fresh start/prompt/completion/failure/cancel/stop。
- session load、ID replacement、persistence 和异常退出恢复。

### 不再作为本次门槛的测试

- Claude/Codex live child-process success test。
- Claude/Codex provider-specific recovery test。
- 为即将删除的 engine 分支继续扩充 UI 快照。

保留的 legacy 测试只证明：旧 session 可读、可管理、只读拦截生效，不证明旧 runtime 还能运行。

### test map

在 `shared/contracts/code-review-map.json` 增加至少以下关系：

```json
{
  "contract": "pi-acp-turn-outcome",
  "sources": [
    "shared/types/acp.ts",
    "shared/lib/acp-turn.ts",
    "electron/src/ipc/acp-sessions.ts",
    "electron/src/lib/upstream-request-tracker.ts",
    "src/hooks/useACP.ts",
    "src/lib/background/acp-handler.ts",
    "src/lib/background/session-store.ts",
    "src/hooks/session/useSessionRevival.ts",
    "src/hooks/session/useSessionPersistence.ts",
    "src/types/session.ts"
  ],
  "tests": [
    "src/lib/engine/__tests__/acp-turn.test.ts",
    "electron/src/ipc/__tests__/acp-sessions.test.ts",
    "scripts/test-pi-acp-integration.mjs",
    "scripts/test-electron-acp-recovery.mjs"
  ]
}
```

同时增加 `pi-runtime-reproducibility` relationship，覆盖 `scripts/pi-runtime-versions.json`、runtime doctor、CI workflow 和 runtime integration test；这些路径必须在实现提交中真实存在，不能先把关系加入 test map 再让检查脚本失效。

## 6. PR 必过门禁

新增 `.github/workflows/quality.yml`，稳定 check name 为 `quality`，在 `pull_request` 和 `master` push 触发。至少运行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm test:pi-integration
pnpm test:electron-recovery
pnpm test-map:check
pnpm docs:check
pnpm exec electron-builder --linux --dir --publish never
pnpm package:smoke -- release/$(node -p "require('./package.json').version")
git diff --check
```

要求：

- 任一命令失败，quality job 失败。
- runtime 缺失、integration 被 skip、E2E 被 skip 都是失败，不是 warning。
- package smoke 使用本次构建产物，不使用开发者旧产物。
- release workflow 的 test job 也必须调用同一套 required quality workflow 或复用同一脚本，不能只跑 `pnpm test`。
- GitHub branch protection 中手动把 `quality` 设置为 required status check；workflow 文件本身不能自动完成 repository settings 配置，必须在交付记录中提供截图/API 验证。
- branch protection 验证至少记录 `required_status_checks.contexts` 中包含 `quality`；没有该 repository setting 证据时，只能说 workflow 已创建，不能说“PR 门禁已完成”。

## 7. 实施顺序和提交边界

1. `test(contract): define Pi ACP turn outcomes`
2. `fix(acp): preserve Pi failure semantics across layers`
3. `test(acp): add real adapter and Pi process integration`
4. `test(electron): add restart recovery E2E`
5. `chore(runtime): pin and diagnose Pi test environment`
6. `chore(ci): require full quality gate`
7. `docs: record Pi-only reliability contract`

每个提交都必须有对应 focused test 和验证命令。不得先删除日志再补测试；不得先把旧 Claude/Codex 代码大面积删掉，导致无法区分 Pi 修复回归和架构迁移回归。

## 8. 验收标准

### 必须通过

- 事故 retry-only 场景最终状态是 `failed`，不是 `completed`。
- UI、request tracker、background store 和 session persistence 状态一致。
- retry diagnostics 不出现在 assistant 历史正文。
- 正常完成、取消、runtime error、upstream error、invalid protocol、transport error 有不同可测试 code。
- 真实 `pi-acp` child integration 通过。
- Electron 两进程恢复 E2E 通过，并验证异常退出清理。
- runtime doctor 能区分 bundled host、wrapper、Pi、`pi-acp`、catalog、credential 和 provider reachability 问题，并证明 PATH 不参与。
- PR quality check required 且全量命令失败会阻断合并。

### 明确不接受

- 只断言 `connection.prompt()` resolve。
- 只断言最终 `stopReason === "end_turn"`。
- 用 `extractErrorMessage()` 的非空结果当作成功/失败依据。
- integration test 在 bundled runtime 缺失或损坏时自动 skip/回退 PATH。
- 只测 mock ACP connection，不启动真实 child process。
- 只做 package resource smoke，却声称完成 restart recovery E2E。
- 把“日志里有一段错误文本”当作可观测性完成。

## 9. 交付后回滚和残余风险

- 本修复不改写旧 session 文件；失败可回滚到旧 renderer/main，不影响读取数据。
- 新增字段保持 optional，旧版本忽略未知字段时仍能读取基础 session。
- 若 Pi adapter 版本升级改变 retry event 形状，compatibility matrix 和 integration gate 必须先失败，禁止静默退回成功。
- 外网 provider 的真实 SLA 不属于本地 required gate；本地 fixture 只能证明状态契约，不证明生产 provider 可用性。
- Pi-only engine 删除按另一份 spec 的阶段验收推进；本 spec 只保证 Pi ACP 可靠性和迁移期兼容边界。
