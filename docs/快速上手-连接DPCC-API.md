# PccAgent 一键配置

> 本教程帮你在几分钟内跑通 PccAgent，**重点是如何连接 DPCC API**。
下载链接
[GitHub Releases](https://github.com/DUNHKpcc/dpcc-harness/releases)
，国内
Windows：🔗[Windows x64 安装包](https://dpccgaming.xyz/harnss/updates/PccAgent-windows-x64-setup.exe)
macOS：🔗[macOS arm64 压缩包](https://dpccgaming.xyz/harnss/updates/PccAgent-mac-arm64.zip)

PccAgent 的 Pi 会话通过 **DPCC API 网关**获取上游能力。首次启动时，通过系统浏览器登录并授权当前设备即可，无需手工复制 API 密钥。

> Pi 是 PccAgent 唯一内置的 live Agent。锁定版本的 `pi`、`pi-acp` 和 MCP adapter 随安装包提供，可离线启动；无需另行安装，也不会调用系统 PATH 中的同名命令。用户自行安装的 Pi 只有在以不同 Agent ID 配置为 custom ACP Agent 时才会使用。

---

## 一、准备 DPCC API 账户

确认你可以登录 [api.dpccgaming.xyz](https://api.dpccgaming.xyz)。PccAgent 会在浏览器中显示本次授权的设备名称、平台与可用模型；授权不会充值、扣费或改变套餐。

> 旧版本中手工填写的密钥会迁移为兼容凭据。建议在升级后点击「重新授权」，改用浏览器授权。

充值入口：[dpccgaming.xyz/payment](https://dpccgaming.xyz/payment)

---

## 二、连接 DPCC API
![图片](/uploads/content/docs/assets/pcc-agent/pasted-image-1781877924847-0-586394601.webp)

1. 启动 PccAgent，在账户入口点击**使用浏览器登录**。
2. 系统浏览器会打开 DPCC API 登录与设备授权页。
3. 登录后核对设备名称与权限，点击允许。
4. 浏览器提示授权完成后返回 PccAgent；应用会完成一次设备凭据确认，再替换本机旧凭据。
5. 账户状态显示**已连接**，Pi 的可用模型会自动加载。重新授权期间，旧连接会保留到新凭据确认成功。

---

## 三、不登录并继续

点击**不登录并继续**可进入访客模式。访客模式不会使用之前保存的 DPCC 设备凭据，Pi 会改用本地或你另行配置的自定义网关。需要恢复默认 DPCC 连接时，再点击**使用浏览器登录**。

---

## 四、确认连接成功

回到账户面板 / 设置页，检查：

- 顶部状态显示「**已连接**」。
- 账户信息中显示当前设备、授权有效期与可用模型。
- 余额和 Token 活动区域可以正常刷新。

看到这些就表示 DPCC API 已接通，可以新建会话开始对话了。

---

## 常见问题

- **浏览器没有打开**：检查系统默认浏览器设置，然后在 PccAgent 中重试。
- **授权页提示请求过期**：回到 PccAgent 点击「重新授权」，不要复用旧页面。
- **状态显示已过期或已撤销**：点击「重新授权」生成新的设备凭据。
- **会话因授权失效而结束**：服务端拒绝或撤销设备凭据后，使用该 DPCC 凭据的 Pi 会话会立即停止；重新授权后再新建会话。
- **模型列表或余额无法刷新**：确认网络可访问 `origin-api.dpccgaming.xyz`，再重新授权。
- **凭证安全**：设备凭据只保存在 Electron `safeStorage` 支持的操作系统安全存储中；PccAgent 不提供再次查看或复制凭据的入口。
- **退出设备**：点击「退出并撤销此设备」会撤销服务端授权并清理本机安全存储。

**旧会话说明**：历史 Claude/Codex session 可以查看、搜索和删除，但旧 runtime 已移除，不会继续发送、恢复或重启。需要继续工作时，请新建 Pi session；旧 resume ID 不会被伪造成 Pi 的 `agentSessionId`。

![图片](/uploads/content/docs/assets/pcc-agent/pasted-image-1781877941238-0-585685746.webp)
