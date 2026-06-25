# DeepSeek Agent (Electrobun + Vercel AI SDK)

A minimal desktop AI coding agent. Chat with an agent backed by DeepSeek that can
run commands and edit code inside isolated Linux sandboxes, then review every
change it made — with line-level discussion — before you push. Conversations,
projects, and knowledge all persist locally.

> Developer docs (architecture, code map, how to add a tool) live in
> [CONTRIBUTING.md](./CONTRIBUTING.md).

## Setup

1. Get a DeepSeek API key at <https://platform.deepseek.com/api_keys>.
2. Launch the app, open **系统设置** (gear icon, top-right) → **模型与 API Key**,
   and paste your key (and optionally a model). The config is global — all
   projects share it — and the agent won't run until the key is set.

## Run

```bash
bun install
bun run dev       # launch the app
bun run build     # build for production
```

(See [CONTRIBUTING.md](./CONTRIBUTING.md) for HMR dev mode and the build matrix.)

## Supported platforms

The sandbox needs hardware virtualization **and** a microsandbox native binary
for the host's OS/arch. The binary ships bundled with the app — you do **not**
install anything separately — but it's only published for these targets:

| Platform | Sandbox | Why |
|---|---|---|
| macOS, Apple Silicon (arm64) | ✅ | HVF + `microsandbox-darwin-arm64` |
| Linux x64, glibc + KVM | ✅ | KVM + `microsandbox-linux-x64-gnu` |
| Linux arm64, glibc + KVM | ✅ | KVM + `microsandbox-linux-arm64-gnu` |
| macOS Intel (x64) | ❌ | no `darwin-x64` binary published |
| Windows | ❌ | no Windows binary; needs WSL2 (untested) |
| Linux musl (e.g. Alpine host) | ❌ | no musl binary published |

The rest of the app (chat, review, knowledge base, DeepSeek) runs anywhere
Electrobun does — only the sandbox is gated by this table.

## Features

### Chat with tools

Ask the agent in plain language; it calls tools in a multi-step loop and streams
the result live. While a turn runs, the send button becomes a **中止** (stop)
button that aborts the run — whatever already streamed stays in the chat. Replies
render as Markdown (tables, task lists, code blocks); links open in your default
browser. Each tool call shows up in a collapsible **工具调用** panel.

### Projects

A **项目 (project)** groups chat sessions around one or more code repositories and
a default sandbox image. When no project is open you get a landing page of project
cards (with search and **新建项目**); each card's gear button opens its settings
(name, default image, bound repos, and a **删除项目** danger zone). A top-bar
switcher jumps between projects. The app reopens to the last project you used. A
session's bound repos and image are handed to the agent automatically — it can
`git clone` them on demand and new sandboxes default to the project's image.

### Sessions

Every conversation is saved locally (SQLite) and survives restarts. Sessions are
scoped to their project, so switching projects shows only that project's chats.

### Sandboxes

The agent can spin up isolated Linux microVMs and run commands in them. Sandboxes
are **per chat session** and **persist across restarts** — files written in an
earlier session are still there when the agent comes back. Just ask, e.g.
*"create a sandbox and run `uname -a` in it"*. The first time an image is used it
is pulled and cached, so the first boot is slower.

> Sandboxes accumulate on disk (one per session/name). Deleting a chat removes its
> sandboxes, but orphans (e.g. from a crash) can pile up. Open **系统设置 → 沙箱管理**
> for a global view — every sandbox grouped by session/project, with image, live
> CPU/memory, and uptime — where you can **pause/resume**, view **logs**, or
> **delete** (rootfs included) the stale ones.

### Diffs you can discuss

When the agent edits a file, the change renders as a standalone **diff card** —
unified diff, line numbers, green/red. Drag across any diff's lines to ask the
agent about that exact range: an inline composer opens, and the conversation lives
in a docked **discussion panel** anchored to those lines, so each line range is
its own thread. Because every edited turn is snapshotted into git under the hood,
discussions of older code stay reliable. Discussion turns are **read-only** (the
agent can inspect but not edit) — except you can ask it to refactor the discussed
code, which it hands back to the main chat to actually make the change.

### Ready to Push (review)

The session header's **准备推送 / Ready to Push** button opens a full-screen review
of **every change the session made, across all its sandboxes** — a file list plus
inline diffs. It's review-only; it does **not** push. The same line-level
discussion works here too. Review even covers non-git / no-remote projects: a
directory the agent created is reviewed against where it started.

### Knowledge Base (知识库)

A per-project knowledge store (top-bar **知识库** tab) with four fixed types: 项目
背景 / 架构决策 / 编码规范 / 领域术语. The agent can file knowledge it discovers,
and you can add entries yourself.

**Review gate:** every new entry — yours or the agent's — lands in **待审核**,
quarantined from the active base, until you approve it (驳回 / 编辑后通过 /
通过入库). Only reviewed, enabled entries are taught back to the agent. Each entry
renders as Markdown and can be edited inline, enabled/disabled, or deleted.
