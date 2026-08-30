# Harnss 全项目性能、兼容性与稳定性复审

> [!NOTE]
> 本文是 2026-07-26 的历史快照，其中 Claude/Codex runtime 结论不再代表当前产品方向。当前开发以 Pi 为唯一内置 live Agent，并保留 custom ACP 与 legacy session 的兼容边界。

- 日期：2026-07-26
- 基线：`master` / `2c70947`
- 范围：`src/`、`electron/`、`shared/`、构建配置及相关测试
- 方法：Harnss agent workflow、多轮独立 reviewer、Serena 语义检索、code-review-graph、Vitest、TypeScript、Vite/tsup build、Semgrep

## 结论

本轮完成了多轮全仓审查、修复和回归验证。工作树包含 43 个已跟踪文件的修改和 3 个新增文件，重点收敛了会话生命周期竞态、持久化一致性、跨平台命令探测、主进程资源清理和高成本前端加载。

最终自动化结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，renderer 与 Electron TypeScript 均无错误 |
| `pnpm test` | 118 个测试文件、716 个测试全部通过 |
| `pnpm build` | 通过，Electron 与 renderer production build 成功 |
| Semgrep | 2 条本地规则扫描 1093 个目标，0 findings |
| `git diff --check` | 通过 |
| code-review-graph | 43 个已跟踪变更文件、128 个变更 symbol，风险分 0.60；未报告具体缺陷 |

基线测试为 118 个文件、708 个测试；本轮新增或扩展回归覆盖后为 716 个测试。

## 性能修复

### 启动与 bundle

- 将 Mermaid、Transformers、Monaco、DOMPurify 等依赖拆分为独立 chunk。
- Mermaid 与 Transformers 保持 lazy-load，最终 `dist/index.html` 不再为它们生成首屏 `modulepreload`。
- 当前主要 chunk：
  - `index`：约 1,170 kB，gzip 约 325 kB。
  - `vendor-mermaid`：约 2,500 kB，gzip 约 704 kB，仅在图表功能使用时加载。
  - `vendor-transformers`：约 893 kB，gzip 约 232 kB，仅在语音识别功能使用时加载。
- 构建仍会提示部分 chunk 超过 500 kB，但最大的可选依赖已不进入首屏预加载路径。

### Renderer 热路径

- `ThinkingBlock` 从持续 `requestAnimationFrame` 循环改为有边界的追随更新，完成时只执行一次最终滚动和深度同步。
- Codex streaming command output 改为按动画帧合并更新，降低高频 stdout 引起的 React render 次数。
- `SimpleStreamingBuffer` 改为增量字符串累积，避免持续 `join()` 造成的重复复制。
- split pane 持久化改为稳定的 quiet-window debounce，避免 streaming 期间频繁重写完整历史。
- session search 增加主进程 generation 取消、结果上限和文件间 event-loop yield；renderer 同步增加过期请求保护。
- 进程树终止优先复用一次 `ps` 快照，减少对子进程逐个执行命令的开销。

## 兼容性修复

- Git 文件列表和 status 改用 NUL-delimited 输出，正确处理空格、Tab、换行、反斜杠、Unicode 和 rename 路径。
- MCP executable 探测遵循 `PATH` 与 Windows `PATHEXT`，并确认候选项为普通文件，避免目录或不允许扩展名的误判。
- Linux terminal 默认 shell 增加 `/bin/sh` fallback。
- legacy data migration 在 Linux 遵循 `XDG_CONFIG_HOME` / Electron `appData`。
- MCP OAuth callback 使用系统分配的可用端口并处理 bind error、非法 callback URL；redirect host 继续使用 `localhost`，兼容既有 OAuth client 注册。
- Codex managed binary 更新保留完整 vendor 目录，采用 backup、替换、失败回滚和启动恢复，避免非原子更新损坏安装。
- file watcher 增加 subscriber 计数，并在主 frame 导航、renderer crash 和应用退出时释放；in-place navigation 不再误释放 watcher。

## 稳定性修复

### 会话创建、发送与恢复

- Claude、ACP、Codex draft materialization 增加 generation/cancellation，防止已放弃的异步启动覆盖新 draft。
- 首条用户消息在暴露 live session ID 前写入初始状态，减少切换会话时的消息丢失。
- Codex 首条消息直接使用 materialization 返回的不可变 model/plan 配置，不再依赖尚未完成 React commit 的 `sessionsRef`。
- 显式 session ID 的首条发送不再因用户在 50 ms listener 绑定窗口内切换 pane 而被取消。
- 新增 target-aware send failure 路由：失败会写入真正的目标会话或 split pane，并停止对应 processing 状态。
- Claude model restart 在新 transport 准备成功前保留旧 transport；pending restart 被停止时不会提前破坏旧连接。
- Claude session 切换恢复 slash commands，并重新获取 MCP status，同时屏蔽旧异步响应。
- ACP/Codex revival 在 runtime ID 变化时先复制持久化记录，再提交 UI ID，并删除旧记录，避免重启后出现重复会话。
- Codex 首次 send 失败不再错误移除仍存活的 runtime 标记，后续可以复用或由真实 exit 事件清理。

### split pane 与后台路由

- split pane 的事件归属从“请求可见”改为“engine listeners 已绑定并声明 routing-ready”。
- bootstrap 期间事件继续进入 background store；pane ready 后再原子接管，避免 streaming token、permission 和 turn-complete 丢失。
- split pane state 与 notification snapshot 使用同一 publish-ready gate，防止旧 pane 状态被标记为新 session。
- live snapshot 用于切换和持久化，减少 split pane 卸载时的状态回退。

### 持久化与删除

- session 文件写入增加 per-session lock、临时文件加原子 rename，降低并发覆盖和半写文件风险。
- 删除操作先写 tombstone，再进入文件锁；晚到的 autosave 无法重新创建已删除会话。
- 显式 restore 在同一文件锁内解除 tombstone；写入失败会恢复 tombstone。
- 删除 renderer session 时先移除本地状态，再执行异步 stop/delete；后台 session 的 debounce 不再误清除 active session timer。
- 删除失败会恢复 sidebar entry 并显示本地化错误提示。
- 应用退出前 main process 发起 renderer persistence flush，等待 active、split 和已发出的持久化写入完成；2.5 秒 timeout 防止退出永久阻塞。
- `sessions:update-meta` 只忽略 `ENOENT`，权限、磁盘、JSON 或原子 rename 错误会正确返回失败。
- WeChat 成功回复与本地持久化解耦：桌面端删除会话导致的保存失败不会覆盖已经成功的模型回复。
- 已删除的 WeChat session 在下一轮轮换为新的 Pcc session ID，迟到的 finalize 无法复活旧 ID。

### 主进程与资源生命周期

- renderer crash 或 app teardown 会停止 Claude/ACP/Codex session、terminal 和 file watcher。
- MCP OAuth server 对同步及异步 callback 异常均返回受控错误，避免 unhandled rejection。
- search generation 使用 `WeakMap<WebContents, monotonic generation>`，消除旧请求 generation 重用导致的 ABA 竞态。

## 回归覆盖

本轮新增或强化的测试包括：

- Git NUL-delimited path 与 rename 解析。
- draft materialization 取消、MCP 失败后 guard 释放。
- Claude restart transport 延迟 teardown。
- process-tree 单快照与 fallback。
- Codex managed vendor backup、rollback、启动恢复和成功清理。
- toast i18n 静态检查。

完整测试、typecheck、production build 和 Semgrep 均在最终修改后重新执行。

## 剩余风险

以下是本轮有意保留、需要单独设计或真实平台验证的事项：

- `ChatView` 仍使用 progressive hydration，而不是完整 virtualization。超长历史的 DOM 和 Markdown 成本仍是主要 renderer 性能上限。
- `ThinkingBlock` streaming 期间仍会重新解析增长中的 Markdown；本轮移除了永久 rAF，但没有重写 Markdown 增量渲染架构。
- session persistence 仍保存完整历史。quiet-window、锁和原子写入解决了频率与一致性问题，但超大历史的序列化和磁盘写入成本仍会增长。
- `index` 与 `vendor-ui` 仍超过 Vite 默认 500 kB warning；需要基于真实 startup profile 再决定是否继续拆分，避免为了数字制造网络和运行时开销。
- 当前环境完成了 macOS 本机构建和自动化验证，但未执行 Windows/Linux packaged binary 的真实安装、通知、shell、OAuth 和 updater smoke test。
- code-review-graph 报告 110 个结构化 coverage gap；其中部分是 Electron 生命周期和跨 pane 交互，现有单元测试无法完整模拟。建议后续增加 packaged E2E 与 renderer/main shutdown integration test。

本报告不宣称项目“无缺陷”；结论是本轮发现的高置信度问题已修复并通过现有自动化门禁，剩余风险已明确记录。
