# Zotero AI Sidebar — Usage Guide

English | [中文](USAGE.zh-CN.md)

This document targets **end users** and is split in two halves:

1. **5-Minute Quick Start** — install → configure → ask a question with PDF context → save the answer to a Zotero note.
2. **Reference Manual** — every feature, organized by task: where to find it, what each field does, and the gotchas worth knowing.

> Install steps and the bare-minimum config are already in [README.md](../README.md); this guide does not repeat them.
> See [Troubleshooting](#troubleshooting) and [Related docs](#related-docs) at the bottom.

---

## Contents

- [1. 5-Minute Quick Start](#1-5-minute-quick-start)
- [2. Common Workflows](#2-common-workflows)
  - [2.1 Ask the AI to interpret a section](#21-ask-the-ai-to-interpret-a-section)
  - [2.2 Translate a PDF sentence-by-sentence (Translate mode)](#22-translate-a-pdf-sentence-by-sentence-translate-mode)
  - [2.3 Let the AI add highlights / annotations to the PDF](#23-let-the-ai-add-highlights--annotations-to-the-pdf)
  - [2.4 Use slash commands for arXiv or web search](#24-use-slash-commands-for-arxiv-or-web-search)
  - [2.5 Distill answers into a paper note](#25-distill-answers-into-a-paper-note)
  - [2.6 Sync chats and config across devices (WebDAV)](#26-sync-chats-and-config-across-devices-webdav)
  - [2.7 Back up and migrate config](#27-back-up-and-migrate-config)
- [3. Reference Manual](#3-reference-manual)
  - [3.1 Model presets](#31-model-presets)
  - [3.2 Sidebar UI map](#32-sidebar-ui-map)
  - [3.3 Agent tools](#33-agent-tools)
  - [3.4 Slash commands](#34-slash-commands)
  - [3.5 PDF sentence-translation mode](#35-pdf-sentence-translation-mode)
  - [3.6 Quick prompts](#36-quick-prompts)
  - [3.7 Note-editing panel](#37-note-editing-panel)
  - [3.8 Screenshots and multimodal input](#38-screenshots-and-multimodal-input)
  - [3.9 PDF highlight color rubric](#39-pdf-highlight-color-rubric)
  - [3.10 WebDAV cloud sync](#310-webdav-cloud-sync)
  - [3.11 Config export / import](#311-config-export--import)
  - [3.12 Chat history](#312-chat-history)
- [Troubleshooting](#troubleshooting)
- [Related docs](#related-docs)

---

## 1. 5-Minute Quick Start

### Step 1 · Configure your first model preset

Open Zotero `Tools → Plugins`, click the gear icon next to *Zotero AI Sidebar*, and open settings. (Or: open the sidebar with no preset configured — it drops you straight into the "Add preset" form.)

Four fields are required:

| Field | Purpose |
|---|---|
| Provider | `anthropic` / `openai` / any OpenAI-compatible endpoint |
| API key | Stored in Zotero prefs **only on this machine**; never uploaded to WebDAV or exports |
| Base URL | Official endpoint, or your self-hosted reverse proxy |
| Model | Any model id supported by that endpoint (e.g. `claude-opus-4-7`, `gpt-5`) |

Click **Test connection** — failures fail loudly. Save the preset.

> You can save multiple presets. The sidebar footer shows a switcher you can flip mid-conversation.

### Step 2 · Open the sidebar

The sidebar lives in Zotero's **Item Pane / Reader Context Pane** as the *AI* tab.

Pick any paper in the main library. The sidebar binds to that item — chat history, context traces, and notes are kept per-paper.

### Step 3 · Ask your first question

A solid starter prompt:

```
Summarize this paper in 5 lines, then call out its core contribution and biggest limitation.
```

Hit Enter or click **Send**. If the item has a PDF attached, the model will autonomously call `zotero_get_current_item` (for metadata + abstract) and `zotero_get_full_pdf` / `zotero_search_pdf` (for body text). **The tool loop is model-driven — no local keyword routing decides what to fetch.**

### Step 4 · See which tools the AI used

Each AI message renders two collapsible blocks above its body:

- **Thinking** — reasoning summary (when the provider supplies one).
- **Tool trace** — every `zotero_*` / `paper_*` call this turn, with its arguments and return.

`★ Tip — if an answer feels invented, check the trace first. No PDF tool calls means the model never read the paper. Usually that's because (a) max tool iterations is too low, or (b) the item has no PDF attached.`

### Step 5 · Save the answer to a note

Two paths:

1. **Manual** — hover any AI message, click **Copy** or **Save to note** (placement and label are configurable in settings).
2. **Let the AI write it** — say "append this summary to the note for this paper". The model calls `zotero_append_to_note`; if no child note exists, it creates one automatically.

That closes the loop: **read paper → AI interprets → permanent record in Zotero**.

---

## 2. Common Workflows

### 2.1 Ask the AI to interpret a section

The natural pattern: **select text in the Reader with your mouse**. A *selection chip* (with a character-count preview) appears above the composer. Now ask your question normally.

That turn the model prefers `zotero_get_current_pdf_selection` / `zotero_get_reader_pdf_text` over reading the whole PDF — fewer tokens, more focused answer.

To drop the selection, click the × on the chip. The chip never auto-clears, and **the sidebar does not jiggle as the PDF selection changes** — that flicker is an explicit anti-goal of the UI.

### 2.2 Translate a PDF sentence-by-sentence (Translate mode)

Best for: first read of a non-native-language paper, or speed-building whole-paper comprehension.

1. Open the PDF in the Reader. Click **译 (Translate)** on the sidebar toolbar (or its hotkey) to enter Translate mode. Sentences in the PDF become hover-highlightable.
2. Click any sentence (single-click by default; configurable to double-click). The translation overlays in place.
3. **Enter** advances to the next sentence; **Shift+Enter** goes back. Walk through the whole page or paper this way.
4. Click **译** again to exit and return the PDF to its normal scroll/select behavior.

Tunables: see [§3.5](#35-pdf-sentence-translation-mode).

### 2.3 Let the AI add highlights / annotations to the PDF

The model can **actually write** Zotero annotations, not just produce text. These tools are blocked by default — they require **approval or YOLO mode**.

Write tools:

- `zotero_add_annotation_to_selection` — highlight the current selection in a chosen color, with an optional comment.
- `zotero_add_text_annotation_to_selection` — add a text-only annotation at the selection.
- `zotero_annotate_passage` — let the model pick sentences across a larger passage and highlight them in batch.

Sample prompt:

```
Read §3 (Method). Highlight in different colors: problem statement,
method steps, dataset, and headline results.
```

The model first reads context (`zotero_search_pdf` / `zotero_read_pdf_range`), then issues highlight calls. Every write **shows up in the trace** — you can audit or undo retrospectively.

Color mapping: see [§3.9](#39-pdf-highlight-color-rubric).

### 2.4 Use slash commands for arXiv or web search

Type `/` in the composer to surface command suggestions. Two are built-in:

| Command | Usage | Behavior |
|---|---|---|
| `/arxiv-search` | `/arxiv-search <query or arXiv URL>` | Model uses `paper_search_arxiv`, optionally followed by `paper_fetch_arxiv_fulltext` |
| `/web-search` | `/web-search <query>` | Model calls the configured built-in web-search tool (must be enabled provider-side) |

Slash commands **do not run business logic locally**. They only inject a prompt fragment ("the user has explicitly chosen this action") and let the model decide which tool calls to make. This is the Codex-style invariant: **no local keyword routing**.

### 2.5 Distill answers into a paper note

The note panel is designed as a **work area independent from the chat**: opening, editing, or closing it never re-renders chat, resets composer drafts, or interrupts streaming.

- **Manual** — open the note panel beside the Reader and edit rich text directly. The underlying engine is Zotero's official `<note-editor>` / `EditorInstance`, so list behavior, Enter/Backspace, focus, and autosave match the rest of Zotero.
- **AI write** — invoke `zotero_append_to_note`. The tool finds (or creates) the paper's child note and appends.
- **Hybrid** — let the AI summarize, then hand-edit. Same loop as code review.

### 2.6 Sync chats and config across devices (WebDAV)

Use case: keep chat history, prompt library, and UI settings consistent between desktop and laptop.

1. In settings, fill in WebDAV endpoint (URL, user, password). Nutstore, self-hosted Nextcloud, anything WebDAV-compatible works.
2. **Push** packages this machine's state into a single `state.json` and uploads it.
3. **Pull** downloads `state.json` and overwrites local state.

What `state.json` contains:

- ✅ Chat threads (per-paper conversations, thinking, tool traces, image metadata)
- ✅ Quick prompts, UI settings, the non-secret fields of model presets, tool/MCP settings
- ✅ Annotations on selected papers (carried by *portable thread keys* so threads survive itemID changes)
- ❌ **API keys are not uploaded** (kept in local prefs)
- ❌ **PDF files are not uploaded** (those go through Zotero File Sync on a separate WebDAV path)

`★ Three-layer split` — (1) zotero.org for library metadata, (2) Zotero File Sync for PDFs over WebDAV, (3) this plugin for `state.json` over WebDAV. The three layers are decoupled; killing one does not break the others.

### 2.7 Back up and migrate config

If you don't want WebDAV, plain export/import works:

- **Export** writes a JSON file with UI settings, preset metadata (no keys), quick prompts, and tool/MCP settings.
- **Import** loads that JSON on the new machine.
- API keys are **deliberately excluded** for security — re-enter them after import.

---

## 3. Reference Manual

### 3.1 Model presets

Each preset is a complete `provider + endpoint + model + parameters` set. Save as many as you like, named.

| Field | Required | Purpose |
|---|---|---|
| Provider | ✓ | `anthropic` or `openai`; selects the SDK path |
| Display name | | Shown in the footer switcher |
| API key | ✓ | Local prefs only — never uploaded, never exported |
| Base URL | ✓ | Official endpoint or OpenAI-compatible reverse proxy |
| Model | ✓ | Model id, e.g. `claude-opus-4-7`, `gpt-5` |
| Max output tokens | | Output length cap |
| Max tool iterations | | A **safety fuse** — the maximum tool-loop steps per turn. **Not a task-routing knob.** Setting it too low makes the model abandon PDF reads partway through |
| Reasoning / Thinking | | Enable reasoning effort (OpenAI) or extended thinking (Anthropic); the model must support it |
| Agent permission mode | | Governs write tools: blocked / approval-required / YOLO |

**Test connection** issues a minimal request to validate endpoint + key.

Each preset maintains its own model list — same base URL, different model ids, fast switch.

### 3.2 Sidebar UI map

Top to bottom:

```
┌──────────────────────────────────┐
│  [Settings] [Translate] [Screenshot] ...│  ← toolbar
├──────────────────────────────────┤
│  AI: ...                          │  ← message stream
│  ┌─ Thinking (collapsed) ─┐      │
│  └────────────────────────┘      │
│  ┌─ Tool trace (collapsed) ─┐    │
│  └──────────────────────────┘    │
│  You: ...                         │
├──────────────────────────────────┤
│  [📎 Selection: "..." × ]        │  ← composer chip (PDF selection / images)
│  ┌────────────────────────┐     │
│  │  /                       │     │  ← composer; `/` triggers slash menu
│  │  ...                     │     │
│  └────────────────────────┘     │
│   Preset switcher  [Send]        │  ← footer
└──────────────────────────────────┘
```

Notable behaviors:

- **Streaming auto-scroll** sticks to the bottom only if you were already near it. Manually scrolled up? Your scroll position is preserved as new chunks arrive.
- **Composer drafts** survive sidebar re-renders, streaming, tool calls, Reader selection changes, and preset switches.
- **Copy conversation** has two modes: **Clean** (paper intro + dialogue only — for sharing) and **Debug** (includes thinking, context traces, PDF snippets — for bug reports or model-decision audits).

### 3.3 Agent tools

Authoritative names live in `src/context/agent-tools.ts`. Categories:

**Read tools (always enabled):**

| Tool | Purpose |
|---|---|
| `zotero_get_current_item` | Title, authors, year, abstract, tags, collections of the bound item |
| `zotero_get_annotations` | All existing annotations on the current paper |
| `zotero_search_pdf` | Keyword search across the PDF, returns matching passages |
| `zotero_read_pdf_range` | Read a specific page or paragraph range |
| `zotero_get_full_pdf` | Pull the full PDF text in one call (subject to budget in `policy.ts`) |
| `zotero_get_current_pdf_selection` | Whatever the user has currently selected in the Reader |
| `zotero_get_reader_pdf_text` | Text of the current page / visible region |
| `chat_get_previous_context` | Lets the model re-inspect earlier context without polluting main history |
| `paper_search_arxiv` | arXiv search |
| `paper_fetch_arxiv_fulltext` | arXiv full text |

**Write tools (blocked by default, gated by approval / YOLO):**

| Tool | Purpose |
|---|---|
| `zotero_add_annotation_to_selection` | Highlight current selection with color + comment |
| `zotero_add_text_annotation_to_selection` | Text-only annotation at the selection |
| `zotero_annotate_passage` | Batch-pick sentences across a passage and highlight |
| `zotero_append_to_note` | Append content to the paper's child note (creates one if missing) |

**Safety semantics**: every write call is visible in the trace. YOLO mode is per-preset, not global.

### 3.4 Slash commands

Typing `/` opens completion. The two built-in commands:

```
/arxiv-search <query or arXiv URL>
/web-search <query>
```

By design slash commands carry **no local logic** — they inject a "user explicitly chose this" prompt fragment, and the model decides which tool calls to make. This is the Codex-style invariant: **no local keyword router decides intent**.

### 3.5 PDF sentence-translation mode

| Setting | Options |
|---|---|
| Trigger | Single-click / double-click |
| Overlay size | Compact / adaptive |
| Overlay placement | Above / below the sentence |
| Context | Sentence only / include paragraph / include full page |
| Next sentence | `Enter` (default) |
| Previous sentence | `Shift+Enter` (default) |

When Translate mode is active, Zotero's native selection popup is suppressed to avoid colliding with the translation overlay; it returns when you exit the mode.

Translations are cached by sentence-content hash — re-clicking the same sentence does not re-call the model.

### 3.6 Quick prompts

A row of **one-click prompts** beside the composer — e.g. *"Summarize"*, *"Explain the method"*, *"Pull out the experimental numbers"*. Each button's label and its prompt template are editable in settings.

Use it to bind your own high-frequency questions to a single click.

### 3.7 Note-editing panel

Target layout: `PDF Reader | Note panel | AI chat`.

- **Engine** — Zotero's official `<note-editor>` / `EditorInstance`. Rich text (headings, lists, links, inline code, blockquotes) behaves identically to Zotero's main note editor.
- **Decoupled from chat** — opening, closing, or editing the note never re-renders the sidebar, resets composer drafts, or interrupts streaming.
- **AI writes** — `zotero_append_to_note` finds the paper's child note (or creates one) and appends.

### 3.8 Screenshots and multimodal input

The toolbar **Screenshot** button captures a region of the PDF / Reader and attaches the result to the composer. You can also drag-drop image files directly.

On send, images are passed as **real multimodal inputs** to the provider (not just shown locally). The model must support vision (Claude 3+, GPT-4o/5, etc.).

### 3.9 PDF highlight color rubric

Zotero's six default annotation colors are exposed by hex code. This plugin maps each color to a semantic label (background / problem / method / dataset / results / …) and injects the rubric as a natural-language prompt so the model can pick a color when calling `zotero_add_annotation_to_selection`.

The rubric is editable in settings — for a literature review you might switch to *"established / contested / my critique / …"*; the model will follow.

### 3.10 WebDAV cloud sync

| Item | Behavior |
|---|---|
| Endpoint | URL + user + password (use an *app password* where the service offers one) |
| Push | Uploads the current `state.json` |
| Pull | Downloads `state.json` and overwrites local state |
| Conflict policy | No automatic merge — last write wins; *you* are the source of truth |
| Path stability | Threads carry portable keys, so cross-machine migration survives itemID drift |

`★ The plugin uses a different WebDAV path from Zotero's built-in File Sync. Sharing the same WebDAV account is safe.`

### 3.11 Config export / import

| Field | Included |
|---|---|
| UI settings (nicknames, avatars, theme, action-button placement) | ✅ |
| Model presets (excluding API keys) | ✅ |
| Quick prompts | ✅ |
| Tool / MCP settings | ✅ |
| API keys | ❌ (security) |
| Chat history | ❌ (use WebDAV for this) |

Right tool when you want to *carry config to a new machine but leave conversations behind*.

### 3.12 Chat history

- One thread per paper, bound to itemID (carried across machines via portable thread keys).
- Each message preserves: text, thinking (reasoning summary), tool trace, image attachment metadata.
- **Copy as Markdown** has two modes:
  - **Clean** — paper intro + dialogue. For sharing or blog posts.
  - **Debug** — full thinking, context traces, PDF snippets, error logs. For bug reports or auditing model decisions.

---

## Troubleshooting

### "API call fails / 401 / 403"

1. Click **Test connection** to surface the exact error code.
2. Check the base URL — `/v1` suffix or trailing `/` mismatches are common.
3. For self-hosted reverse proxies, verify the corresponding API surface (OpenAI Responses for `openai`, Anthropic Messages for `anthropic`) is fully implemented.

### "AI didn't read the PDF / answer feels invented"

1. Confirm an item with a PDF attachment is selected in the main pane.
2. Open the trace — is `zotero_get_current_item` / `zotero_get_full_pdf` actually there?
3. If tools were truncated, raise the preset's **Max tool iterations**.
4. Provider rate-limited? The model may bail on the tool loop and answer cold; the trace will show the error.

### "Translate mode is unresponsive / clicks do nothing"

1. You must be in a Reader tab — not the main library pane.
2. Verify the trigger (single-click / double-click) matches your habit.
3. Other PDF-annotation extensions can intercept click events; disable temporarily and retry.

### "WebDAV push fails"

1. URL must end with `/`.
2. Nutstore, Mailbox, etc. require an **app-specific password**, not your login password.
3. The destination path must be writable, including subdirectory creation.

### "AI tries to annotate but is blocked"

Default is no-write. Two paths forward:

- Short-term: ask the AI to *describe* the highlights it wants (text + color), then add them by hand.
- Long-term: enable **YOLO mode** or the appropriate permission mode on that preset (per-preset, not global).

### "Sidebar jitters when the PDF selection changes"

That's an explicit anti-goal of the design. If you see it, suspect a stale extension or an old build — the selection chip is *explicit* UI and should not trigger a sidebar re-render.

### "Copy button drops thinking / tool calls"

Switch to **Debug** copy mode. **Clean** mode intentionally strips them — it is the share-friendly variant.

---

## Related docs

- [README.md](../README.md) — project intro, install, minimal config
- [docs/HARNESS_ENGINEERING.md](HARNESS_ENGINEERING.md) — design contract for the Codex-style agent loop (developer-facing)
- [docs/TOOLS_AND_MCP.md](TOOLS_AND_MCP.md) — Tool / Web Search / MCP decision guide
- [docs/MATH_RENDERING.md](MATH_RENDERING.md) — math rendering details
- [docs/RELEASE.md](RELEASE.md) — release flow
- [CLAUDE.md](../CLAUDE.md) — project modification constraints and non-negotiables
