# Zotero 论文代码仓库分析插件

> 基于 [`xuhan-rgb/zotero-ai-sidebar`](https://github.com/xuhan-rgb/zotero-ai-sidebar) 架构扩展的 Zotero 7/8 AI Sidebar。  
> 目标：在 Zotero 阅读论文时，一键导入论文对应的 GitHub 仓库，建立本地工程索引，并生成可写入 Zotero 子笔记、可导入 Obsidian 的中文代码级解读报告。

## 项目定位

传统论文阅读工具通常只能处理论文 PDF；而复现、科研汇报、组会答辩、面试准备真正困难的部分往往是“论文贡献到底在代码里怎么实现”。本项目把 Zotero 论文上下文和 GitHub 工程源码放进同一个 AI 工具循环中，让模型先理解论文，再理解仓库结构，最后基于真实文件路径和真实行号生成报告。

核心使用方式：

1. 在 Zotero 中选中或打开一篇论文。
2. 在右侧 AI Sidebar 的“论文代码仓库”区域粘贴 GitHub URL。
3. 点击 `生成并写入笔记`。
4. 插件自动导入仓库 archive、解压扫描、建立 Repo Workspace 索引。
5. 模型按需读取 Zotero 论文摘要、PDF、标注、仓库结构、符号骨架和关键源码。
6. 完整中文 Markdown 报告自动写入当前论文的 Zotero 子笔记，并保存到本地 report storage。

## 与原版 Zotero AI Sidebar 的关系

本项目不是从零开始的 Zotero 插件，而是在原 `zotero-ai-sidebar` 基础上做的论文代码仓库分析增强版。

保留的原有能力：

- Zotero 侧边栏 AI 对话。
- OpenAI / Anthropic / OpenAI-compatible 模型预设。
- Zotero 当前条目、PDF 文本、PDF 检索、用户标注、截图等 AgentTool。
- 流式输出、工具调用轨迹、聊天历史。
- Zotero 子笔记写入和 PDF 标注辅助。
- 快捷提示词、翻译模式、WebDAV 同步等原有功能。

新增的核心能力：

- GitHub 仓库 URL 解析与标准化。
- GitHub archive 下载主链路，而不是逐文件 raw API 抓取。
- 本地 Repo Workspace 缓存。
- 全工程 manifest、语言统计、role tag、重要性评分。
- Python / TypeScript / JavaScript / 配置文件 / Notebook 的简易符号骨架。
- 模块图、工程索引检索、按角色读取源码。
- 论文上下文 digest、论文段落搜索和章节读取。
- 一键生成代码讲解并写入 Zotero 子笔记。
- 面向 Obsidian 的 Markdown 笔记输出模式。

## 功能亮点

### 一键论文-代码联合分析

用户不需要先手动“绑定仓库”再“生成报告”。粘贴 GitHub URL 后点击 `生成并写入笔记`，插件会自动完成：

```text
GitHub URL
  -> 解析 owner/repo/ref
  -> 下载 GitHub archive
  -> 本地解压
  -> 扫描全工程
  -> 建立 Repo Workspace 索引
  -> 构建论文上下文 digest
  -> 搜索和精读关键源码
  -> 生成中文 Markdown 报告
  -> 写入 Zotero 子笔记
  -> 保存本地 report storage
```

如果当前论文已经导入过同一个仓库，插件会复用本地 workspace；如果需要重新扫描，可以点击 `重建`。

### 稳定的仓库读取策略

早期方案使用 GitHub tree API 和 raw URL 逐文件读取，容易遇到：

- GitHub API rate limit。
- 分支解析失败。
- raw 文件请求超时。
- tree truncated。
- 大文件多次读取导致上下文浪费。

当前主链路改为 GitHub archive：

- 一次下载公开仓库压缩包。
- 本地解压。
- 全量扫描 manifest。
- 后续读取都基于本地 workspace，不再反复请求 GitHub raw 文件。

这更适合代理环境、网络波动和较大的科研代码仓库。

### Repo Workspace 工程索引

导入仓库后，插件会建立结构化索引，而不是把整个仓库直接塞给模型。

索引内容包括：

- 文件路径、扩展名、语言、大小、行数。
- 是否文本文件、是否二进制、是否被忽略。
- 重要性分数和原因。
- role tags，例如 `model_architecture`、`training_entry`、`dataset_pipeline`、`loss_objective`、`evaluation`、`inference`、`config`。
- README、配置文件、入口脚本、训练脚本、模型文件候选。
- Python / TS / JS 符号骨架。
- YAML / JSON / TOML top-level keys。
- Notebook code cell 和 markdown heading 摘要。

模型先看索引、模块图和符号骨架，再决定读取哪些源码行段。

### 真实路径和真实行号

报告中的代码证据必须来自工具实际读取的源码内容。源码读取工具会注入稳定行号：

```text
   1 | import torch
   2 | import torch.nn as nn
   3 |
   4 | class Model(nn.Module):
```

报告要求：

- 不得编造文件名。
- 不得编造类名、函数名。
- 不得编造行号。
- 如果没有直接证据，必须写“未在已读取代码中找到直接实现”。
- 结论要区分“代码证据支持”和“基于结构/文件名的合理推测”。

### 直接写入 Zotero 子笔记

代码讲解报告不再在聊天区完整刷屏。点击 `生成并写入笔记` 后：

- 聊天区只显示简短进度和工具轨迹。
- 完整报告在生成完成后写入当前 Zotero item 的子笔记。
- 不主动弹出笔记窗口，避免打断阅读。
- 本地 report storage 也会保存一份，后续可查看状态。

这避免了大段 Markdown 报告挤占侧边栏，也减少误写到其他论文的风险。

### Obsidian Markdown 笔记模式

写入 Zotero 子笔记时，插件会保留 Markdown 源文本，方便后续导入 Obsidian。

支持的报告元素：

- Markdown 标题。
- 表格。
- Obsidian callout，例如 `> [!warning]`、`> [!tip]`。
- fenced code blocks。
- Mermaid 源文本。
- 文件路径和行号引用。

Zotero 内部会把这段内容作为 Markdown 源文本保存；导入 Obsidian 后可以渲染成更适合长文阅读的报告。

## 代码分析报告内容

默认报告结构包括：

```markdown
# 论文代码仓库解读报告

## 1. 论文与仓库基本信息
## 2. 工程整体结构
## 3. 模型架构代码解读
## 4. 训练流程代码解读
## 5. 论文创新点与代码实现对应关系
## 6. 数据流与调用链
## 7. 复现与阅读建议
## 8. 不确定性与未验证部分
```

分析范围默认包含：

- 模型架构。
- 训练流程。
- 数据处理。
- loss / 优化目标。
- 推理 / 评测。
- 论文创新点与代码对应。

用户可以在折叠的 `分析范围` 区域取消不需要的维度。

## AgentTool 架构

本项目遵循原 `zotero-ai-sidebar` 的工具调用架构：本地插件只暴露结构化工具，模型通过 `tool_choice:auto` 自己决定何时调用。

仓库分析相关工具包括：

| 工具 | 作用 |
|---|---|
| `repo_import_github_archive` | 下载 GitHub archive，解压并建立 Repo Workspace |
| `repo_get_workspace_status` | 查看当前论文是否已有 workspace |
| `repo_get_manifest` | 获取工程 manifest 摘要 |
| `repo_get_module_map` | 获取模块图、语言统计、roleGroups |
| `repo_get_symbol_skeleton` | 获取重要文件符号骨架 |
| `repo_search_files` | 按关键词和 role tag 搜索源码 |
| `repo_read_file_with_lines` | 按真实行号读取指定文件或行段 |
| `repo_read_related_files` | 按角色批量读取关键文件 |
| `paper_build_context_digest` | 构建当前论文上下文摘要 |
| `paper_get_context_digest` | 读取已保存论文 digest |
| `paper_search_sections` | 搜索论文相关段落 |
| `paper_read_section` | 读取论文指定章节 |
| `analysis_save_report` | 保存代码分析报告 |
| `analysis_get_saved_report` | 读取已保存报告 |

旧版 GitHub raw/tree 工具仍保留作为兼容能力，但主流程优先使用 Repo Workspace。

## 本地存储

插件采用本地优先策略，不会把源码索引写入聊天历史。

主要本地文件：

| 文件 | 内容 |
|---|---|
| `zotero-ai-sidebar-chat-history.json` | 每个 Zotero item 的聊天历史 |
| `zotero-ai-sidebar-repo-workspaces.json` | Repo Workspace metadata、manifest、源码索引、论文 digest、报告 |
| `zotero-ai-sidebar-code-analysis.json` | 旧版 code_* 工具的绑定和分析记录 |

Windows 下已使用平台路径分隔符拼接 Zotero profile 文件路径，避免 `NS_ERROR_FILE_UNRECOGNIZED_PATH`。

## 隐私与安全

- API key、base URL、模型名保存在 Zotero 本地 preferences 中，不写死到源码。
- 默认只支持公开 GitHub 仓库。
- 不执行 `git clone`。
- 不执行 shell 命令读取仓库。
- 不引入 Python 后端、FastAPI、Claude Code CLI 或 Obsidian vault 写入。
- 大文件、二进制、权重、数据集、缓存目录会被跳过或限制读取。
- 所有工具失败都返回结构化错误，避免 sidebar 崩溃。

## 安装

### 使用构建好的 XPI

1. 运行构建：

```bash
npm run build
```

2. 找到输出文件：

```text
.scaffold/build/zotero-ai-sidebar.xpi
```

3. 在 Zotero 中安装：

```text
Tools -> Plugins -> 齿轮图标 -> Install Plugin From File...
```

4. 选择 `.xpi` 文件并重启 Zotero。

### 本地开发安装

开发时可以使用 `zotero-plugin serve`：

```bash
npm install
npm run start
```

也可以构建 XPI 后复制到 Zotero profile 的 extensions 目录。

## 配置模型

打开 Zotero AI Sidebar 设置，至少配置一个模型预设：

- Provider：OpenAI、Anthropic 或 OpenAI-compatible。
- API Key：本地保存。
- Base URL：官方或兼容接口。
- Model：所用模型 ID。
- Max tokens / tool iterations：根据模型上下文和工具循环需求调整。

建议使用支持长上下文和工具调用的模型。代码分析需要多次工具调用，模型上下文太短会降低报告质量。

## 使用方法

### 一键生成论文代码讲解

1. 在 Zotero 中打开或选中论文。
2. 在右侧 AI Sidebar 找到 `论文代码仓库`。
3. 粘贴 GitHub URL，例如：

```text
https://github.com/EmbodiedAI-RoboTron/CF-VLA
```

如果需要指定分支、tag 或 commit，可以粘贴：

```text
https://github.com/owner/repo/tree/main
https://github.com/owner/repo/tree/v1.0.0
https://github.com/owner/repo/tree/<commit-sha>
```

4. 点击 `生成并写入笔记`。
5. 等待工具轨迹完成。
6. 在当前 Zotero item 的子笔记中查看完整报告。

### 查看状态

点击 `状态` 可以查看当前论文是否已有 Repo Workspace、仓库规模、语言分布和 warnings。

### 重建索引

当仓库更新、导入失败或索引异常时，点击 `重建`。重建会重新下载 archive 并扫描工程。

## 开发

安装依赖：

```bash
npm install
```

运行测试：

```bash
npm test
```

构建：

```bash
npm run build
```

类型检查包含在构建命令中：

```bash
zotero-plugin build && tsc --noEmit
```

## 关键源码目录

```text
src/modules/sidebar.ts                  # Zotero sidebar UI、聊天流、代码仓库面板
src/context/agent-tools.ts              # Zotero AgentTool 注册与工具会话
src/context/repo/                       # V2 Repo Workspace 主实现
src/context/repo/github-url.ts          # GitHub URL 解析
src/context/repo/github-client.ts       # GitHub API、archive 下载、ref 解析
src/context/repo/repo-indexer.ts        # archive 解压扫描和 workspace 构建
src/context/repo/file-classifier.ts     # 文件过滤、role tag、重要性评分
src/context/repo/symbol-extractor.ts    # 简易符号骨架提取
src/context/repo/line-number.ts         # 稳定行号注入
src/context/repo/repo-tools.ts          # repo_* / paper_* / analysis_* 工具
src/settings/repo-workspace-storage.ts  # workspace、digest、report 本地存储
src/settings/profile-path.ts            # Zotero profile 文件路径兼容处理
src/context/code-*                      # 旧版 GitHub raw/tree code_* 工具
```

## 测试覆盖

已覆盖的重点：

- GitHub URL 解析。
- archive import mock。
- 文件分类、skip dir、role tag。
- 符号骨架提取。
- 行号注入和截断策略。
- Repo Workspace storage。
- 旧版 code_* 工具。
- `Message.apiContent` 显示内容 / 模型内容分离。
- Windows profile 路径拼接。
- OpenAI provider 工具循环回归。

当前验证命令：

```bash
npm test
npm run build
```

## 已知限制

- 首版只支持 GitHub 公开仓库。
- 私有仓库 OAuth 尚未实现。
- 不做本地 `git clone`。
- 不做 AST 级完整调用图。
- 对超大仓库会保留 manifest，但源码索引受预算限制。
- 对超大单文件仍可能显式截断；模型应继续按行段读取关键区域。
- Zotero 子笔记写入的是 Markdown 源文本，主要服务后续 Obsidian 导入。

## Roadmap

- GitHub token / OAuth 配置，用于私有仓库和更高 rate limit。
- 更强的 ref 解析和 release/tag 选择 UI。
- 更细粒度的文件范围读取和 symbol-level reading。
- 可选 AST 解析器，提高调用链构建质量。
- Repo Workspace 文件系统缓存，减少大型 workspace JSON 体积。
- Obsidian 导出辅助命令。
- 报告模板自定义。

## License

本项目继承原项目许可证：AGPL-3.0-or-later。

## 致谢

- 原始架构来自 [`xuhan-rgb/zotero-ai-sidebar`](https://github.com/xuhan-rgb/zotero-ai-sidebar)。
- 代码仓库分析思路参考了论文代码分析工具的常见 workflow：先建工程索引，再按需精读关键源码，而不是一次性把整个仓库塞进模型上下文。
