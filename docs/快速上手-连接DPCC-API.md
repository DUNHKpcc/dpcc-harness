# PccAgent 一键配置

> 本教程帮你在几分钟内跑通 PccAgent，**重点是如何连接 DPCC API**。
下载链接
[GitHub Releases]🔗(https://github.com/DUNHKpcc/dpcc-harness/releases)
，国内
Windows：🔗[Windows x64 安装包](https://dpccgaming.xyz/harnss/updates/PccAgent-windows-x64-setup.exe)
macOS：🔗[macOS arm64 压缩包](https://dpccgaming.xyz/harnss/updates/PccAgent-mac-arm64.zip)

PccAgent 不直接调用官方 Claude / Codex，而是通过你的 **DPCC API 网关**调用。所以第一步永远是：**填入网关地址 + 令牌**。配置只保存在本机。

---

## 一、准备凭证（在 DPCC API 后台）

打开后台 [api.dpccgaming.xyz](https://api.dpccgaming.xyz) 并登录，准备好以下信息：

- **网关地址**（必填）：默认 `https://api.dpccgaming.xyz`，一般保持默认即可
- **Claude 密钥 sk-…**（Claude 用户必填）：用于 Claude 会话、模型列表、余额查询
- **Codex 密钥 sk-…**（仅用 Codex 时填）：用于 Codex 会话、模型列表
- **用户 ID + 访问令牌**（选填）：显示账户真实余额（可选增强项）

> 令牌在后台「令牌 / API Key」页面新建并复制；用户 ID 和系统访问令牌在「用户设置」页面获取。

充值入口：[dpccgaming.xyz/payment](https://dpccgaming.xyz/payment)

---

## 二、连接 DPCC API（两种方式，任选其一）
![图片](/uploads/content/docs/assets/pcc-agent/pasted-image-1781877924847-0-586394601.webp)

### 方式 A：账户面板（最快）

1. 点击左侧边栏底部的**账户头像**，打开账户面板。
2. 首次未配置时会显示「**连接你的 DPCC API 账户**」引导卡片。
3. 依次填入：
   - **网关地址**：保持默认 `https://api.dpccgaming.xyz`（或填你的私有网关）。
   - **Claude 密钥（sk-）**：粘贴你的令牌。
   - **Codex 密钥（sk-，可选）**：只用 Claude 可留空。
4. 点击「**连接**」。

### 方式 B：设置页（可填更多选项）

1. 进入 **设置 → 账户**。
2. 展开「**编辑凭证**」。
3. 填写字段：
   - **网关地址**（留空则用默认 DPCC API）
   - **Claude 密钥** / **Codex 密钥**
   - **Claude 默认模型** / **Codex 默认模型**：连接成功后会自动拉取可用模型，从下拉里选即可；选「自动」则由选择器决定。
4. 点击「**保存**」。

> Codex 网关地址会自动追加 `/v1` 后缀，无需手动填写。

---

## 三、（可选）显示账户真实余额

默认余额走计费接口；若要显示精确的账户余额，再补充两项：

- 在账户面板点「**显示账户真实余额 →**」，或在设置页「编辑凭证 → 余额查询」中填写；
- 填入 **用户 ID**（如 `1`）和 **系统访问令牌**，保存即可。

填好后，「Token 活动」卡片也会显示累计用量、连续活跃天数等统计。

---

## 四、确认连接成功

回到账户面板 / 设置页，检查：

- 顶部状态显示绿色「**已连接**」，来源标记为「**DPCC 账户**」。
- 凭证区出现绿色小圆点：**Claude 密钥**、**Codex 密钥**（按你所填）后面带可用模型数量。
- 余额区域显示数字或「无限额度」。

看到这些就表示 DPCC API 已接通，可以新建会话开始对话了。

---

## 常见问题

- **状态一直是「未连接」/ 来源为「默认」**：说明令牌没填或为空。回到「编辑凭证」确认 sk- 令牌已粘贴并保存。
- **「无法获取余额」**：计费接口可能未开启，补充上面的「用户 ID + 访问令牌」即可读取真实余额。
- **模型下拉为空**：检查网关地址和对应密钥是否正确，再点右上角「**刷新**」。
- **凭证安全**：所有令牌仅保存在本机配置文件，不会上传。

![图片](/uploads/content/docs/assets/pcc-agent/pasted-image-1781877941238-0-585685746.webp)
