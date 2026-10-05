# Agent Sidenote

在 ChatGPT、豆包、Gemini 对话网页选中文字，用便签旁注追问，直接导出 Markdown。

## 安装

1. 打开 `chrome://extensions`，开启 **开发者模式**
2. **加载已解压的扩展程序** → 选择本目录

## 配置

1. 点击扩展图标，模式选 **API**（Mock 模式无需 Key，可体验 UI）
2. 填写 API Key、模型、Base URL → **测试连接** → **保存设置**

API 模式在点击测试或保存时，只申请填写的 API 主机访问权限；拒绝授权不会覆盖原设置。保存新的 API 主机后会撤销旧 API 授权，保存 Mock 模式会清理 API 授权。也可点击 **撤销 API 授权**，再次使用时重新测试或保存即可。

## 使用

1. 打开 [chatgpt.com](https://chatgpt.com)、[doubao.com/chat](https://www.doubao.com/chat/) 或 [gemini.google.com](https://gemini.google.com/)
2. 在 AI 回答中选中文字 → **旁注追问**
3. 便签中提问，设置类型 / 标记 / 标签
4. **Save as Note** 或 Popup **导出 Markdown**

关闭便签只隐藏窗口，仍可导出；Popup 的 **恢复当前页便签** 可重新打开已关闭的便签。请求期间可点击 **停止**，已收到的回答会保留。

## 更新与数据

更新代码后，在 `chrome://extensions` 重新加载扩展，再刷新 AI 对话页面。已有笔记会自动迁移，无需手动转换。新版按文件记录导出状态，首次导出会重新生成文件。

从旧版升级后会清理全部 HTTPS 网站的通配授权；API 模式首次使用前，请重新测试连接或保存设置，为当前 API 主机授权。Chrome 的主机授权覆盖同协议、同主机的各端口和路径。

笔记和 API Key 保存在本机扩展存储中，卸载扩展会清除这些数据。API 模式会把引用、问题、旁注历史和启用的上下文发给你配置的 API 服务；可在设置中关闭完整回答和主对话上下文。回答渲染会过滤 HTML，仅保留基本 Markdown 排版与 HTTP/HTTPS 链接。

## 保存路径

路径填写规则：**相对 Chrome 下载目录的子路径**，不支持 `..` 和绝对路径。

### 默认

留空或填 `Notes` → 文件在 `~/Downloads/Notes/`。

### 写入 Obsidian Inbox（推荐）

一次性设置符号链接，之后插件填 `Note/00_Inbox` 即可：

```bash
mkdir -p ~/Note/00_Inbox ~/Downloads/Note
ln -s ~/Note/00_Inbox ~/Downloads/Note/00_Inbox
```

Popup → **Markdown 保存子目录** 填 `Note/00_Inbox`。

Markdown 文件格式见 [`docs/note-format.md`](docs/note-format.md)。

## 常见问题

**Save as Note 报错？** 重载扩展后重试；检查保存子目录是否含 `..` 或绝对路径。

**豆包无反应？** 确保选中的是 AI 回复正文。

**重载扩展后异常？** 刷新 AI 对话页面。

**提示笔记已在其他窗口更新？** 先保留本窗口尚未保存的内容，再刷新页面加载最新版本。

**API 尚未授权或授权已撤销？** 打开扩展设置，点击 **测试连接** 或 **保存设置**。Base URL 支持 HTTP/HTTPS 的根地址、`/v1` 地址或完整的 `/chat/completions` 地址，请直接填写最终地址；请求不自动跟随重定向。

## 架构

页面适配器提取选区与当前对话，便签通过扩展消息交给 Service Worker。后者统一处理笔记写入、已授权的 API 请求和 Markdown 下载；Popup 负责设置、授权、恢复与导出预览。

| 模块 | 职责 |
| --- | --- |
| `content/adapters/` | 三站点的消息、角色和上下文提取 |
| `content/` | 选区按钮、便签 UI、安全渲染与页面切换 |
| `background/` | 串行保存、流式请求与下载完成确认 |
| `shared/` | 笔记结构、导出规则、消息客户端与 API 权限 |
| `popup/` | 配置、API 授权及导出操作 |

## 验证

扩展直接加载，无需构建。测试使用 Node.js 20 或更新版本；安装的 DOM 测试依赖不参与扩展运行：

```bash
npm ci
npm test
```

回归检查覆盖三站点结构样本、选区与便签恢复、存储并发、导出一致性、流式异常、下载状态和 API 授权流程。样本说明与真实页面检查步骤见 [tests/fixtures/README.md](tests/fixtures/README.md)；自动化样本测试不能替代网站实时 DOM 的浏览器验收。

## 许可

项目代码采用 [MIT License](LICENSE)，Copyright (c) 2026 Haoling Yang。

第三方库保留各自的许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
