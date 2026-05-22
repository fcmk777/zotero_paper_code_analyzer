# Zotero AI Sidebar 使用指南

[English](USAGE.md) | 中文

本文档面向**使用者**，分两部分：

1. **5 分钟上手**：从零跑通"打开论文 → 问 AI → 收到答案 → 存进笔记"全流程。
2. **功能手册**：按场景列出每个功能的入口、字段、典型用法和注意事项。

> 安装步骤和最简配置已在 [README.zh-CN.md](../README.zh-CN.md) 说明，本文不重复。
> 末尾还有[故障排查](#故障排查)和[相关文档](#相关文档)。

---

## 目录

- [1. 5 分钟上手](#1-5-分钟上手)
- [2. 常见场景](#2-常见场景)
  - [2.1 让 AI 解读论文当前章节](#21-让-ai-解读论文当前章节)
  - [2.2 在 PDF 上逐句翻译（译模式）](#22-在-pdf-上逐句翻译译模式)
  - [2.3 让 AI 给 PDF 加高亮/批注](#23-让-ai-给-pdf-加高亮批注)
  - [2.4 用 Slash 命令检索 arXiv 或 Web](#24-用-slash-命令检索-arxiv-或-web)
  - [2.5 把回答沉淀到论文笔记](#25-把回答沉淀到论文笔记)
  - [2.6 跨设备同步聊天和配置（WebDAV）](#26-跨设备同步聊天和配置webdav)
  - [2.7 备份和迁移配置](#27-备份和迁移配置)
- [3. 功能手册](#3-功能手册)
  - [3.1 模型预设](#31-模型预设)
  - [3.2 侧边栏 UI 速查](#32-侧边栏-ui-速查)
  - [3.3 Agent 工具一览](#33-agent-工具一览)
  - [3.4 Slash 命令](#34-slash-命令)
  - [3.5 PDF 逐句翻译模式](#35-pdf-逐句翻译模式)
  - [3.6 Quick prompts（快速提示词）](#36-quick-prompts快速提示词)
  - [3.7 笔记编辑面板](#37-笔记编辑面板)
  - [3.8 截图与多模态输入](#38-截图与多模态输入)
  - [3.9 PDF 高亮颜色 rubric](#39-pdf-高亮颜色-rubric)
  - [3.10 WebDAV 云同步](#310-webdav-云同步)
  - [3.11 配置导出 / 导入](#311-配置导出--导入)
  - [3.12 聊天历史](#312-聊天历史)
- [故障排查](#故障排查)
- [相关文档](#相关文档)

---

## 1. 5 分钟上手

### Step 1 · 配置第一个模型预设

打开 Zotero `工具 (Tools) → 插件 (Plugins)`，点 Zotero AI Sidebar 的 ⚙️ 进入设置；或者直接打开侧边栏，第一次没有任何预设时会自动进入"添加预设"状态。

最少需要填四项：

| 字段 | 说明 |
|---|---|
| Provider | `anthropic` / `openai` / OpenAI 兼容的任意 endpoint |
| API key | 仅保存在本机 Zotero prefs，不会进 WebDAV 同步 |
| Base URL | 官方端点或自托管反向代理 |
| Model | 该端点支持的任意 model id（如 `claude-opus-4-7`、`gpt-5`） |

填完点 **测试连接**——失败会立刻报错。成功后保存预设。

> 可以保存多个预设；侧边栏底部有一个切换器，对话中途可以换模型。

### Step 2 · 打开侧边栏

侧边栏在 Zotero **条目面板 (Item Pane) / Reader 上下文面板**里以"AI 对话"标签显示。

在主窗口选中任意一篇论文，AI 对话面板就会绑定到这条论文——后续聊天历史、上下文、笔记都按论文分别保存。

### Step 3 · 问第一个问题

最简单的入门提问：

```
帮我用 5 行总结这篇论文，并指出它的核心创新和最大局限。
```

按回车或点 **发送**。如果当前论文有 PDF，模型会自动调用 `zotero_get_current_item`（拿元数据 + 摘要）和 `zotero_get_full_pdf` / `zotero_search_pdf`（拿正文）。**整个工具循环是模型自己决定的，本地不做关键词路由。**

### Step 4 · 看 AI 用了哪些工具

每条 AI 回答上方会展示**思考块**和**工具调用 trace**：

- 思考块默认折叠，点开能看到模型的 reasoning 摘要（取决于 provider 是否提供）。
- Trace 块显示模型这一轮调用了哪些 `zotero_*` / `paper_*` 工具，以及每次调用的参数和返回。

`★ 提示：如果发现 AI 回答凭空发挥，先看 trace 是否有读 PDF 的工具调用。没有的话多半是 max tool iterations 太低或当前 item 没绑定 PDF 附件。`

### Step 5 · 把回答存进笔记

两种方式：

1. **手动**——把鼠标悬到 AI 消息上，点 "复制" 或 "保存到笔记"（按 sidebar 配置，按钮位置和文案可调）。
2. **让 AI 自己写**——直接对模型说"把刚才的总结追加到这条论文的笔记里"。模型会调用 `zotero_append_to_note`，没有子笔记时自动创建。

至此一次完整的"读论文 → AI 解读 → 沉淀进 Zotero"闭环已经跑完。

---

## 2. 常见场景

### 2.1 让 AI 解读论文当前章节

最自然的用法：在 Reader 里**用鼠标选中一段文字**，侧边栏 composer 上方会出现一个**选中片段 chip**（含字符数预览），然后正常发送提问。

模型这一轮会优先看你选中的片段（通过 `zotero_get_current_pdf_selection` / `zotero_get_reader_pdf_text`），而不是从头读 PDF——更省 token，回答更聚焦。

不需要选中片段时点 chip 上的 × 关掉即可，**chip 不会自动消失，UI 不会因为 PDF 选区变化而抖动。**

### 2.2 在 PDF 上逐句翻译（译模式）

适用场景：第一次读非母语论文、想快速建立全文理解。

1. 在 Reader 打开 PDF，点侧边栏工具栏的 **译** 按钮（或对应快捷键）进入译模式。进入后 PDF 区域会高亮当前句。
2. 点击任意一句（默认单击；可在设置里改成双击）即翻译并在原句**就地**叠加显示。
3. 用 **Enter** 跳到下一句，**Shift+Enter** 跳到上一句，连续读完整页/整篇。
4. 再点一次 **译** 按钮关闭译模式，PDF 恢复正常浏览状态。

可调项见 [3.5 PDF 逐句翻译模式](#35-pdf-逐句翻译模式)。

### 2.3 让 AI 给 PDF 加高亮/批注

模型可以**真正写入** Zotero 注释，而不只是文字回答。这一类工具默认在普通模式下被拦截，**需要审批或开启 YOLO 模式**。

写类工具：

- `zotero_add_annotation_to_selection`：把当前 PDF 选区高亮成指定颜色 + 备注
- `zotero_add_text_annotation_to_selection`：在选区位置加文本批注
- `zotero_annotate_passage`：模型在更大段落里自己挑句子高亮（多句批量）

典型 prompt：

```
请你通读 §3 方法部分，把"问题陈述/方法步骤/数据集/结果"四类信息分别用不同颜色高亮标出。
```

模型会先用 `zotero_search_pdf` 或 `zotero_read_pdf_range` 取范围，然后调用高亮工具。每次写入都会在 trace 里**显式标注**，便于事后核对或撤销。

颜色映射规则可在 [3.9 PDF 高亮颜色 rubric](#39-pdf-高亮颜色-rubric) 自定义。

### 2.4 用 Slash 命令检索 arXiv 或 Web

在 composer 输入 `/` 会弹出可选命令。两个内置命令：

| 命令 | 用法 | 行为 |
|---|---|---|
| `/arxiv-search` | `/arxiv-search <query 或 arXiv URL>` | 让模型用 `paper_search_arxiv` 检索，必要时跟进 `paper_fetch_arxiv_fulltext` 拉全文 |
| `/web-search` | `/web-search <query>` | 调用配置的内建 web 搜索工具（需在 provider 端开启） |

不带参数时模型会问你查什么；带参数时直接发给工具。这两个命令不在本地做语义路由，**只是把"用户已经明确选了这个动作"作为 prompt 提示给模型**，由模型决定如何调用工具。

### 2.5 把回答沉淀到论文笔记

笔记面板设计为**和 AI 聊天独立的工作区**：开/关、编辑、保存都不会影响聊天状态、流式输出或 composer 草稿。

- **手动写**：在 Reader 旁边打开笔记面板，直接富文本编辑（用的是 Zotero 官方 EditorInstance，所以 Enter/退格/列表/链接行为和 Zotero 主笔记一致）。
- **AI 写**：让模型调用 `zotero_append_to_note`，自动追加到当前论文的子笔记；没有子笔记时**自动创建一个**。
- **混合**：先让 AI 总结再追加，然后人工调整措辞——和写代码 review 一样。

### 2.6 跨设备同步聊天和配置（WebDAV）

适用场景：在台式机和笔记本之间想保留一致的聊天历史、prompt 库、UI 设置。

1. 在设置里填 WebDAV 端点（URL、用户名、密码）。坚果云、自建 NextCloud 都可以。
2. **Push** 把当前机器的状态打包成单个 `state.json` 上传。
3. **Pull** 从云端拉回 `state.json` 覆盖本地。

`state.json` 包含：

- ✅ 聊天线程（每篇论文的对话、思考块、工具 trace、图片元数据）
- ✅ Quick prompts、UI 设置、模型预设的非敏感字段、tool/MCP 设置
- ✅ 选定论文的批注（用稳定的"线程键"做 portable 标识，跨机迁移）
- ❌ **API key 不上传**（仅保留在本地 prefs）
- ❌ **PDF 文件本身不上传**（PDF 走 Zotero File Sync，独立路径）

`★ 三层同步分工`
- `zotero.org`（免费 300MB 元数据）—— 文献库元数据
- WebDAV（你自己的云）—— 一份给 Zotero 内置 File Sync 同步 PDF；另一份（路径不同）由本插件存 `state.json`
- 三者解耦，删除一层不影响另外两层

### 2.7 备份和迁移配置

不想用 WebDAV 也可以走纯导出/导入：

- **导出**：设置里点导出，下载一个 JSON 文件。包含 UI 设置、模型预设元信息、quick prompts、tool/MCP 设置。
- **导入**：在新机器选择该 JSON。
- API key **不会**进导出文件（安全考虑），需要换机后手动重填。

---

## 3. 功能手册

### 3.1 模型预设

每个预设是一组完整的"provider + endpoint + 模型 + 参数"，可保存多个、命名区分。

| 字段 | 必填 | 说明 |
|---|---|---|
| Provider | ✓ | `anthropic` / `openai`，决定 SDK 路径 |
| Display name | | 在底栏切换器里看到的名字 |
| API key | ✓ | 本地存储；不进 WebDAV、不进导出 |
| Base URL | ✓ | 官方端点或 OpenAI 兼容反向代理 |
| Model | ✓ | model id，如 `claude-opus-4-7`、`gpt-5` |
| Max output tokens | | 输出长度上限 |
| Max tool iterations | | **安全保险丝**——单轮对话允许的工具循环次数。**不是任务路由开关**。设置过低会让 AI 没机会读完 PDF 就被强行截断 |
| Reasoning / Thinking | | 启用 reasoning effort（OpenAI）或 extended thinking（Anthropic）；要求 model 支持 |
| Agent permission mode | | 控制写类工具：默认禁写 / 需审批 / YOLO 直通 |

**测试连接**会发一条最小请求验证 endpoint 与 key。

每个预设独立维护自己的"模型列表"——同一 base URL 下可以快速切换不同 model id。

### 3.2 侧边栏 UI 速查

侧边栏从上到下：

```
┌──────────────────────────────────┐
│  [设置]  [译]  [截图]  ...       │  ← 工具栏
├──────────────────────────────────┤
│  AI: 你好...                     │  ← 消息流
│  ┌─ 思考 (折叠) ─┐                │
│  └────────────────┘                │
│  ┌─ 工具调用 trace (折叠) ─┐       │
│  └─────────────────────────┘       │
│  你: ...                         │
├──────────────────────────────────┤
│  [📎 选中片段: "..." × ]          │  ← composer chip（PDF 选中片段/图片）
│  ┌────────────────────────┐     │
│  │  /                       │     │  ← 输入框；输入 / 触发 slash 提示
│  │  ...                     │     │
│  └────────────────────────┘     │
│   预设切换器  [发送]             │  ← 底栏
└──────────────────────────────────┘
```

要点：

- **流式输出** 自动粘底滚动；如果你手动向上滚到历史，新内容到达时**保留**你的滚动位置而不会强行回到底部。
- **Composer 草稿** 在 sidebar 重渲染、流式输出、tool call、reader 选区变化、预设切换中都会保留，不会丢。
- **复制对话** 提供两种模式：**Clean**（仅论文简介+对话，适合发出去）/ **Debug**（含 thinking、context trace、PDF 片段）。

### 3.3 Agent 工具一览

模型可见的本地工具（实际名字以源码 `src/context/agent-tools.ts` 为准）：

**读类（默认全开）：**

| 工具 | 用途 |
|---|---|
| `zotero_get_current_item` | 拿当前 item 的标题、作者、年份、摘要、tag、文件夹 |
| `zotero_get_annotations` | 列出当前论文的所有现存批注 |
| `zotero_search_pdf` | 在 PDF 全文里关键词搜索，返回命中段落 |
| `zotero_read_pdf_range` | 按页 / 按段落读取 PDF 指定范围 |
| `zotero_get_full_pdf` | 一次取整篇 PDF 文本（受 `policy.ts` 预算限制） |
| `zotero_get_current_pdf_selection` | 拿用户在 Reader 当前选中的文本 |
| `zotero_get_reader_pdf_text` | 拿 Reader 当前页 / 当前可视范围的文本 |
| `chat_get_previous_context` | 让模型显式回看自己之前的上下文（不污染主历史） |
| `paper_search_arxiv` | 在 arXiv 检索 |
| `paper_fetch_arxiv_fulltext` | 取 arXiv 论文全文 |

**写类（默认禁，需审批/YOLO）：**

| 工具 | 用途 |
|---|---|
| `zotero_add_annotation_to_selection` | 在当前选区添加高亮 + 备注 |
| `zotero_add_text_annotation_to_selection` | 在选区位置添加纯文本批注 |
| `zotero_annotate_passage` | 模型在更大段落里自动挑句子批量高亮 |
| `zotero_append_to_note` | 把内容追加到当前论文的子笔记（无则新建） |

**安全语义**：写类工具调用永远在 trace 里可见。"YOLO" 模式仅在你自己开启的预设里生效，不会全局影响其它预设。

### 3.4 Slash 命令

输入 `/` 触发提示。当前两个内置命令：

```
/arxiv-search <query 或 arXiv URL>
/web-search <query>
```

设计上 slash 命令**不在本地执行任何业务逻辑**——它把"用户已明确选这个动作"作为指令注入 prompt，模型决定具体如何调用工具。这是 Codex 风格 agent 的核心约束：**没有本地关键词路由**。

### 3.5 PDF 逐句翻译模式

| 设置 | 选项 |
|---|---|
| 触发模式 | 单击 / 双击 |
| 弹层尺寸 | 紧凑 / 自适应 |
| 弹层位置 | 句子上方 / 句子下方 |
| 上下文 | 仅句子 / 含段落 / 含整页 |
| 下一句 | `Enter`（默认） |
| 上一句 | `Shift+Enter`（默认） |

进入译模式后 Zotero 原生选区菜单会被隐藏，避免和翻译 overlay 冲突。退出译模式自动恢复。

翻译结果会被缓存（按句子内容哈希），同一句重复点击不重复发请求。

### 3.6 Quick prompts（快速提示词）

在 composer 旁边可以放若干**一键发送按钮**——比如"总结全文"、"讲一下方法部分"、"找出实验数据"。每个按钮的文案、对应的 prompt 模板都在设置里编辑。

适合把高频提问做成一键操作。

### 3.7 笔记编辑面板

目标布局：`PDF Reader | 笔记面板 | AI 聊天`。

- **底层引擎**：Zotero 官方 `<note-editor>` / `EditorInstance`。富文本（标题、列表、链接、内联代码、引用）行为和 Zotero 主笔记一致。
- **不与聊天耦合**：开/关/编辑笔记不会触发 sidebar 重渲染、不会重置 composer 草稿、不会打断流式输出。
- **AI 写入**：模型调用 `zotero_append_to_note`，会自动找到（或创建）当前 item 的子笔记，把内容追加到末尾。

### 3.8 截图与多模态输入

工具栏的 **截图** 按钮触发 PDF / Reader 区域的截图，截图会作为图片附件挂在 composer 上。也可以直接拖拽图片到 composer。

发送时图片**真的会**作为 multimodal input 传给 provider（不只是本地展示）——模型必须支持 vision 才有效（Claude 3+, GPT-4o/5 系列等）。

### 3.9 PDF 高亮颜色 rubric

Zotero 默认六色分别由 hex 表示。本插件把每种颜色对应到一个语义标签（背景/问题/方法/数据集/结果/...），并把这套 rubric 作为自然语言 prompt 注入给模型，让 AI 在调用 `zotero_add_annotation_to_selection` 时自己选颜色。

可在设置里**改写 rubric**，比如做文献综述时改成"已知/争议/我的批注/...",AI 会照新规则匹配。

### 3.10 WebDAV 云同步

| 项 | 行为 |
|---|---|
| 端点 | URL + 用户名 + 密码（建议用应用密码） |
| 推送 | Push：把本机当前 `state.json` 上传 |
| 拉取 | Pull：把云端 `state.json` 下载并覆盖本机 |
| 冲突 | 没有自动 merge——后写覆盖先写，谁是 source of truth 由用户掌握 |
| 路径稳定性 | 使用"线程键"做 portable 标识，跨机迁移时不会因 itemID 变化丢线程 |

`★ 提示：和 Zotero 内置 File Sync 走的是不同的 WebDAV 路径，互不干扰。即使共用同一个 WebDAV 账号也安全。`

### 3.11 配置导出 / 导入

| 字段 | 包含 |
|---|---|
| UI 设置（昵称、头像、主题、操作按钮位置） | ✅ |
| 模型预设（除 API key 外） | ✅ |
| Quick prompts | ✅ |
| Tool / MCP 设置 | ✅ |
| API key | ❌（安全） |
| 聊天历史 | ❌（用 WebDAV 同步） |

适合做"换机时把配置带过去，但聊天保留在原机"的场景。

### 3.12 聊天历史

- 每篇论文一条独立线程，绑定到 itemID（跨机靠 portable 线程键迁移）。
- 单条消息保留：文本、思考块（reasoning summary）、工具 trace、图片附件元信息。
- **复制为 Markdown** 两种模式：
  - **Clean**：论文简介 + 对话本身。适合分享、发博客。
  - **Debug**：含完整思考、context trace、PDF 片段、错误日志。适合反馈 bug 或追溯模型决策。

---

## 故障排查

### "API 调用失败 / 401 / 403"

1. 设置里点 **测试连接**，看具体错误码。
2. 检查 base URL 末尾 `/v1` 之类后缀是否正确。
3. 自建反向代理时，确认完整支持 OpenAI Responses API（OpenAI provider）或 Anthropic Messages API（Anthropic provider）的相应字段。

### "AI 没读 PDF / 给的是凭空答案"

1. 确认 Zotero 主面板**确实选中**了一篇有 PDF 附件的条目。
2. 看消息上方 trace——有没有 `zotero_get_current_item` / `zotero_get_full_pdf` 的调用？
3. 如果工具被截断，提高预设的 **Max tool iterations**。
4. Provider 限速时模型可能放弃工具循环，直接答；查看 trace 里有无错误记录。

### "PDF 翻译模式无响应 / 点击没反应"

1. 必须在 Reader 标签里使用，不是 Library 主面板。
2. 检查触发模式是否设为单击/双击和你预期一致。
3. 如果同时开了某些 PDF 标注插件，可能拦截了 click 事件，临时关掉再试。

### "WebDAV 推送失败"

1. URL 末尾要带 `/`。
2. 坚果云、Mailbox 等服务用 **应用专用密码** 而不是登录密码。
3. 服务端权限：写入路径需要可创建子目录。

### "AI 想加批注但被挡住了"

默认禁写。两条解决路径：

- 临时：让 AI 把建议的高亮位置和颜色文本输出，你自己手动加。
- 长期：在该预设里打开 **YOLO 模式** 或对应的 permission mode（仅对该预设生效）。

### "侧边栏在 PDF 选区变化时抖动"

这是设计避免的反模式。如果你遇到，请打开开发者工具看看是不是某个旧版扩展残留——本插件的"选中片段 chip"是显式 UI，不会在 PDF 选区变化时自动重新渲染整个 sidebar。

### "复制按钮丢失思考内容 / 工具调用"

切到 **Debug 复制模式**——Clean 模式刻意只保留论文简介 + 用户/AI 文本，是给分享场景用的。

---

## 相关文档

- [README.zh-CN.md](../README.zh-CN.md) — 项目简介、安装、最简配置
- [docs/HARNESS_ENGINEERING.md](HARNESS_ENGINEERING.md) — Codex 风格 agent 工具循环的设计契约（开发者视角）
- [docs/TOOLS_AND_MCP.md](TOOLS_AND_MCP.md) — Tool / Web Search / MCP 决策指南
- [docs/MATH_RENDERING.md](MATH_RENDERING.md) — 公式渲染说明
- [docs/RELEASE.md](RELEASE.md) — 发布流程
- [CLAUDE.md](../CLAUDE.md) — 项目修改约束与非协商事项
