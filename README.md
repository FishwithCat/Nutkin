# DeepSeek Agent (Electrobun + Vercel AI SDK)

A minimal desktop AI agent: an Electrobun app (React + Tailwind + Vite HMR) whose
Bun main process runs a [Vercel AI SDK](https://github.com/vercel/ai) agent backed
by DeepSeek. The agent can call tools (current time, calculator, and isolated
sandboxes) in a multi-step loop, and the result streams live into the chat UI.
Conversations persist across restarts in a local SQLite database.

## Setup

1. Get a DeepSeek API key at <https://platform.deepseek.com/api_keys>.
2. Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY`. Bun auto-loads `.env`.

```bash
cp .env.example .env   # then edit .env and paste your key
```

## Getting Started

```bash
# Install dependencies
bun install

# Development without HMR (uses bundled assets)
bun run dev

# Development with HMR (recommended)
bun run dev:hmr

# Build for production
bun run build

# Build for production release
bun run build:prod
```

## How the agent works

```
React webview  ──userMessage(conversation)──▶  Bun main process
   (UI only)                                    (holds API key)
       ▲                                              │
       │                                       Vercel AI SDK
       │                                    streamText + tools
       │                                    stopWhen: stepCountIs(8)
       │                                              │  (DeepSeek)
       └──assistantDelta / toolCall / toolResult / done──┘
                          (abortTurn ──▶ stops the run)
```

While a turn is running the send button becomes a **中止** (stop) button;
clicking it sends `abortTurn(assistantId)`, which aborts the `streamText`
run via an `AbortController`. Whatever already streamed stays in the chat.

- `src/bun/agent.ts` — the agent: DeepSeek model, tool definitions, and the
  multi-step `streamText` loop. The API key lives only here.
- `src/bun/index.ts` — Electrobun RPC: receives the conversation, runs the
  agent, streams events back to the webview.
- `src/shared/rpc.ts` — the typed RPC contract shared by both sides.
- `src/mainview/rpc.ts` + `src/mainview/App.tsx` — RPC client and chat UI.

Add a tool by adding an entry to the `tools` object in `src/bun/agent.ts`.

Tool calls are surfaced in the chat under a collapsible **工具调用** panel: one
compact row per call (icon + name + argument summary + running/done status),
with history folded and the latest call expanded. New tools get a sensible icon
and summary automatically (`toolMeta` in `src/mainview/App.tsx`).

Assistant replies are rendered as Markdown (`react-markdown` + `remark-gfm`, so
GFM tables/task lists/strikethrough work). Elements are restyled to the
stone/clay palette via the `markdownComponents` map in `src/mainview/App.tsx`;
code blocks/inline code are themed there too. Links open in the system default
browser: WKWebView ignores `target="_blank"`, so clicks are routed over RPC
(`openExternal`) to the Bun process, which calls `Utils.openExternal` after an
http/https scheme check.

## Projects

A **项目 (project)** groups a set of chat sessions around one or more code
repositories and a default sandbox image (**alpine**). Every session belongs to
exactly one project.

- **Landing page** (`ProjectList.tsx`): when no project is open, the app shows
  every project as a card (name, primary repo, session/repo counts, last
  activity) with a search box and a **新建项目** entry point. Each card has a
  **设置** (gear) button that opens its settings page. The app opens to the
  **last project you had open** (persisted via `setLastProject` / `getLastProject`);
  if there is none, it lands here.
- **Create** (`CreateProjectModal.tsx`): name the project and paste one or more
  Git URLs, each with an editable default branch. The repo list is the only
  required field (the name falls back to the first repo). The new project is
  saved with `saveProject` and opened immediately.
- **Settings** (`ProjectSettings.tsx`): a full-screen page (reached from a card's
  gear button) to edit an existing project's name, default sandbox image (a preset
  dropdown — `IMAGE_PRESETS` — or a custom value), and bound repos. Edits persist
  via `saveProject` (an upsert that keeps `id`/`createdAt`). A danger zone at the
  bottom holds the confirmed **删除项目** action that removes the project, its
  sessions, and their sandboxes.
- **In-workspace switcher** (`ProjectSwitcher.tsx`, in the top bar): search and
  switch projects, or jump to **新建项目 / 管理全部项目**.
- **Repos & image reach the agent**: a session's `userMessage` carries its
  project context. `buildSystemPrompt` in `src/bun/agent.ts` appends the bound
  repositories (which the agent can `git clone` on demand) and makes the
  project's image the default for `createSandbox`.

Projects live in a `projects` table; `tasks` gained a `project_id` column. On
first run after upgrading, any pre-project conversations are migrated into a
`默认项目`. Deleting a project removes its sessions and their sandboxes.

## Sessions

Conversations are stored in `bun:sqlite` so they survive restarts. The webview
ships each finished task to the Bun process (`saveTask`) and loads the **active
project's** sessions when it opens (`loadTasks(projectId)`); the agent itself
stays stateless. The database lives at `<userData>/sessions.db` (macOS:
`~/Library/Application Support/<id>/<channel>/`), one row per conversation with
the messages as a JSON blob and a `project_id` foreign key.

## Sandboxes

The agent can spin up isolated Linux microVMs and run commands in them, via
[microsandbox](https://github.com/microsandbox/microsandbox). Sandboxes are
**scoped to the chat session** (namespaced `<sessionId>__<name>`) and **persist
across restarts** — microsandbox keeps each sandbox's filesystem on the host
under `~/.microsandbox/`. While the app is idle between turns the sandbox stays
running; on shutdown it is stopped (files preserved). The next time the agent
touches a sandbox it doesn't have a live handle for, `src/bun/sandbox.ts`
re-attaches to the persisted one and resumes it (`reattach()`), so files written
in an earlier session are still there.

Tools (in `src/bun/agent.ts`, backed by `src/bun/sandbox.ts`):

- `createSandbox(name?, image?)` — boot a sandbox (default name `default`, default image `alpine`). Adopts a same-named sandbox left on disk by an earlier run.
- `runCommand(name?, command, args?)` — run a command, returns stdout/stderr/exit code. Lazily re-attaches after a restart.
- `writeFile(name?, path, content)` — create or overwrite a file with the given content. Returns the before/after text so the change shows as a diff.
- `editFile(name?, path, oldString, newString, replaceAll?)` — replace a snippet within an existing file. Also returns before/after text for the diff.
- `stopSandbox(name?)` — pause a sandbox (files preserved; resumes on next command).
- `listSandboxes()` — this session's sandboxes (including persisted ones) with status.
- `webFetch(url)` — fetch an http(s) URL and return its content as plain text (HTML stripped, long pages truncated). Read-only, so it's also available in discuss mode. Plus `getCurrentTime(timeZone?)`.

The agent is steered to change files with `writeFile`/`editFile` rather than shell
redirection (`echo >`, `sed -i`), because those tools capture the file's content
before and after the edit. Each completed file edit renders as its own **white,
standalone diff card** in the chat — separate from the grouped tool-call panel —
showing a **unified diff** (line-number gutter, green additions / red deletions)
with the path and +/− counts. See `DiffView` in `src/mainview/components/DiffView.tsx`;
the split between diff cards and the tool panel happens in `MessageBlock.tsx`
(`toSegments`), preserving chronological order. A file edit that is still running
or errored stays in the tool panel until it succeeds. Diffs are computed with
[`diff`](https://github.com/kpdecker/jsdiff) (jsdiff); file content is capped at
10k chars, and a truncated diff is flagged.

Just ask in chat, e.g. *"create a sandbox and run `uname -a` in it"*.

Requirements: a host with hardware virtualization — macOS on Apple Silicon, or
Linux with KVM. The first `createSandbox` for a given image pulls and caches it,
so the first boot is slower.

> Sandboxes accumulate on disk (one per session/name) since they persist. There
> is no automatic GC tied to deleting a chat yet — remove stale ones with
> `Sandbox.remove(name)` or the `msb` CLI if they pile up.

## Discussing a change (diff threads + git snapshots)

Any diff card can be discussed with the agent in an **inline-anchor + side-panel**
layout. Drag across the diff lines to select them (IDE-style; shift-click extends
the range) — a small **inline composer** opens under the selection. Only once you
send the first question does the docked **discussion panel** (`DiscussionPanel.tsx`)
appear on the right, where the multi-turn conversation lives so the diff stays
continuous. Each thread then leaves a **slim inline anchor chip** at its lines
(finding + status + 展开讨论), and selected / commented lines get a thin left
side-bar. Clicking a chip (or **查看代码** in the panel) reopens/scrolls to that
anchor. The agent replies in a thread anchored to those lines,
with a **回复** affordance to continue it — each line range is its own
conversation. Threads stay out of the main transcript and are saved with the
conversation. Lines that carry a thread are never folded, so their comment box
always has a row to hang under.

To make discussion of *historical* code reliable, every turn that edits files is
**snapshotted into git**: after the turn ends, `commitChanges` (in
`src/bun/sandbox.ts`) commits each repo the turn touched inside the sandbox (one
commit per sandbox+repo; `git init`s a workspace on demand, installs git if the
image lacks it). The commit hash is sent back (`assistantCommits`) and stored on
the turn, so each diff card knows its immutable snapshot.

A thread turn is just a normal message carrying an `anchor`
(`{ toolCallId, sandboxName, repoRoot, commitHash, path, startLine, endLine,
quotedText }`), so it reuses the whole streaming/persistence pipeline. Its
history (`threadHistory` in `taskState.ts`) quotes the selected snippet and tells
the agent how to browse the repo *at that commit* — `git show <hash>:<file>`,
`git ls-tree -r <hash>`, `git diff <hash> HEAD` — so it can pull up related code
from the same batch even if the files have changed since. Because the anchor
pins an immutable commit, threads never need re-anchoring; no extra storage is
added (anchors and commits ride in the existing SQLite JSON).

A thread turn also runs in **read-only "discuss" mode**: because the user is
asking *about* a change rather than for more edits, the agent gets a restricted
tool set — just `getCurrentTime`, `runCommand`, and `listSandboxes`. The mutating
tools (`writeFile`, `editFile`, `createSandbox`, `stopSandbox`) are withheld, so
a discussion can inspect the snapshot (`git show …`, `cat`, `grep`) but can never
edit files or create/stop sandboxes from the side panel. The mode rides on the
`userMessage` RPC (`mode: "build" | "discuss"`, defaulting to `build`); `App.tsx`
sends `"discuss"` for any anchored turn, and `runAgent` (`src/bun/agent.ts`) both
filters the tools and swaps in a discussion-focused system prompt.

The discuss-agent does get one write-adjacent tool, `refactor`. When the user asks
to refactor / rewrite / optimize the discussed code, the agent calls
`refactor({ instruction })` instead of dead-ending ("ask in the main
conversation"). The discussion lives in the *same session* as the marked code, so
`App.tsx` watches for the completed `refactor` call and — once the discussion turn
finishes — automatically fires a real **build-mode turn in that session's main
conversation** (`refactorPrompt` in `taskState.ts` re-attaches the anchored file,
line range, and snapshot commit). The refactor then runs as a normal editing turn
with diffs; the tool itself never edits, it only hands off the request.

## Ready to Push (review panel)

The session header has a **准备推送 / Ready to Push** button (disabled while the
agent is running or before any sandbox exists). It opens a full-screen review of
**every change the session made, across all its sandboxes** — a two-column panel:
a file list on the left, the selected file's inline diff on the right (reusing
`DiffView`). It's review-only; it does **not** push.

The review diffs support the **same multi-line discussion** as the main chat: drag
across a file's line numbers to ask the agent about that range. This works because
the diff is `base..HEAD` and **HEAD is a real commit** — `reviewFile` returns its
hash, so the selection anchors to it exactly like a per-turn diff card (synthetic
`review:<file>` toolCallId for grouping; threads persist with the session). A repo
with no HEAD just stays read-only.

The backend (`src/bun/sandbox.ts`) **discovers the repos itself** rather than
trusting per-turn commit records — those only cover files an edit tool touched,
so a repo cloned/built purely via `runCommand` would be missed. It scans each
sandbox for `.git` dirs (bounded `find` from common roots), then for each repo
diffs its current `HEAD` against a base ref. The base is the branch's **upstream**
(`@{u}`) if it has one, else our **session-start baseline** (`refs/nutkin/base`),
else git's empty tree (whole project reads as added).

The baseline ref is anchored on a repo's first auto-commit (before staging),
capturing its pre-Nutkin `HEAD`. This is what makes review work for **non-git /
no-remote projects**: a directory the agent creates or a locally-`init`'d repo
is reviewed against where it started, with no remote required. A repo is included
in review if it has a remote **or** our baseline ref, which also keeps stray
`git init`s in system dirs (e.g. editing `/etc`) out unless Nutkin committed there.

Content loads lazily so the panel opens fast regardless of how many files
changed, via two RPC requests: `reviewList` returns just the changed-file list
(one `git diff --name-status` per repo, no content), and `reviewFile` fetches one
file's before/after text (capped at 10k chars, truncation flagged) only when it's
opened. The panel auto-selects the first file, so its diff still loads on open;
opened files are cached client-side, so switching back is instant.

## Knowledge Base (知识库)

The top bar has **任务 / 知识库** view tabs. 知识库 is a project-level knowledge
store. Knowledge is split into four fixed **types** — 项目背景 / 架构决策 /
编码规范 / 领域术语 — shown in the left column; the right column lists the entries
of the selected type and supports full CRUD: add (the 新增 button), edit (click a
card), delete, and toggle `isAvailable` (the per-entry switch). A title search
filters the visible list.

Each entry is `{ id, projectId, title, description, type, createdAt, isAvailable }`,
persisted to the `knowledge` table in SQLite and **scoped per project** (like
sessions), so switching projects shows only that project's knowledge. The storage
follows the same pattern as tasks/projects: prepared queries + RPC handlers in
`src/bun/index.ts`, client wrappers (`loadKnowledge` / `saveKnowledge` /
`deleteKnowledge`) in `src/mainview/rpc.ts`, types in `src/shared/rpc.ts`, UI in
`src/mainview/components/KnowledgeBase.tsx`.

## How HMR Works

When you run `bun run dev:hmr`:

1. **Vite dev server** starts on `http://localhost:5173` with HMR enabled
2. **Electrobun** starts and detects the running Vite server
3. The app loads from the Vite dev server instead of bundled assets
4. Changes to React components update instantly without full page reload

When you run `bun run dev` (without HMR):

1. Electrobun starts and loads from `views://mainview/index.html`
2. You need to rebuild (`bun run build`) to see changes

## Project Structure

```
├── src/
│   ├── bun/
│   │   └── index.ts        # Main process (Electrobun/Bun)
│   └── mainview/
│       ├── App.tsx         # React app component
│       ├── main.tsx        # React entry point
│       ├── index.html      # HTML template
│       └── index.css       # Tailwind CSS
├── electrobun.config.ts    # Electrobun configuration
├── vite.config.ts          # Vite configuration
├── tailwind.config.js      # Tailwind configuration
└── package.json
```

## Customizing

- **React components**: Edit files in `src/mainview/`
- **Tailwind theme**: Edit `tailwind.config.js`
- **Vite settings**: Edit `vite.config.ts`
- **Window settings**: Edit `src/bun/index.ts`
- **App metadata**: Edit `electrobun.config.ts`
