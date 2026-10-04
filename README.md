# Agent Sidenote

在 AI 对话网页（ChatGPT、豆包等）选中文字，用便签旁注追问，直接导出 Markdown。

## 安装

1. 打开 `chrome://extensions`，开启 **开发者模式**
2. **加载已解压的扩展程序** → 选择本目录

## 配置

1. 点击扩展图标，模式选 **API**（Mock 模式无需 Key，可体验 UI）
2. 填写 API Key、模型、Base URL → **测试连接** → **保存设置**

## 使用

1. 打开 [chatgpt.com](https://chatgpt.com)、[doubao.com/chat](https://www.doubao.com/chat/) 或 [gemini.google.com](https://gemini.google.com/)
2. 在 AI 回答中选中文字 → **旁注追问**
3. 便签中提问，设置类型 / 标记 / 标签
4. **Save as Note** 或 Popup **导出 Markdown**

关闭便签只隐藏窗口，仍可导出；Popup 的 **恢复当前页便签** 可重新打开已关闭的便签。请求期间可点击 **停止**，已收到的回答会保留。

## 更新与数据

更新代码后，在 `chrome://extensions` 重新加载扩展，再刷新 AI 对话页面。已有笔记会自动迁移，无需手动转换。新版按文件记录导出状态，首次导出会重新生成文件。

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

## 验证

无需安装 npm 依赖，使用 Node.js 20 或更新版本运行：

```bash
node --test tests/*.test.js
```

回归检查覆盖存储迁移与并发、导出一致性、流式异常、便签交互、下载状态和路由生命周期。网站的实时 DOM 适配仍需在浏览器中检查。

第三方库及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
