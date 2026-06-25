# Contributing

Developer docs for the DeepSeek Agent app. User-facing docs (setup, features,
supported platforms) are in [README.md](./README.md).

## Architecture

```
React webview  ──userMessage(conversation)──▶  Bun main process
   (UI only)                                    (holds API key)
       ▲                                              │
       │                                       Vercel AI SDK
       │                                    streamText + tools
       │                                    stopWhen: stepCountIs(50)
       │                                              │  (DeepSeek)
       └──assistantDelta / toolCall / toolResult / done──┘
                          (abortTurn ──▶ stops the run)
```

The agent core is a model + a set of tools + a multi-step loop. `streamText` with
`stopWhen: stepCountIs(50)` lets the model call tools, observe results, and keep
going until it produces a final answer (or hits the 50-step budget). Everything
runs in the Bun process so the `DEEPSEEK_API_KEY` never reaches the renderer.
`abortTurn(assistantId)` aborts the `streamText` run via an `AbortController`;
turns are tracked by `assistantId` in `index.ts` with no global lock, so multiple
sessions run concurrently.

## Code map

- `src/bun/agent.ts` — the agent: DeepSeek model, tool definitions, the multi-step
  `streamText` loop, and `buildSystemPrompt` (appends the project's bound repos and
  default image). The API key lives only here.
- `src/bun/index.ts` — Electrobun RPC + SQLite: receives the conversation, runs the
  agent, streams events back; prepared queries + RPC handlers for tasks, projects,
  knowledge.
- `src/bun/sandbox.ts` — microVM lifecycle, file edit tools, git snapshotting, and
  review-diff discovery.
- `src/shared/rpc.ts` — the typed RPC contract shared by both sides.
- `src/mainview/rpc.ts` + `src/mainview/App.tsx` — RPC client and chat UI.
- `src/mainview/taskState.ts` — conversation/thread state helpers (`threadHistory`,
  `refactorPrompt`).
- `src/mainview/components/` — UI: `DiffView`, `MessageBlock`, `DiscussionPanel`,
  `ReviewPanel`, `KnowledgeBase`, `ProjectList`/`ProjectSettings`/`ProjectSwitcher`,
  `Markdown`, etc.

## Adding a tool

Add an entry to the `tools` object in `src/bun/agent.ts` (zod input schema +
`execute`). Tool calls surface in the chat's **工具调用** panel automatically; new
tools get a sensible icon and argument summary from `toolMeta` in `App.tsx`.

Steer the agent to change files with `writeFile`/`editFile` rather than shell
redirection (`echo >`, `sed -i`) — those tools capture the file's before/after
text so the change can render as a diff.

### Tool reference (`agent.ts`, backed by `sandbox.ts`)

- `createSandbox(name?, image?)` — boot a sandbox (default name `default`, default
  image `alpine`). Adopts a same-named sandbox left on disk by an earlier run.
- `runCommand(name?, command, args?)` — run a command; returns stdout/stderr/exit
  code. Lazily re-attaches after a restart.
- `writeFile(name?, path, content)` — create/overwrite a file; returns before/after.
- `editFile(name?, path, oldString, newString, replaceAll?)` — replace a snippet;
  returns before/after.
- `stopSandbox(name?)` — pause a sandbox (files preserved; resumes on next command).
- `listSandboxes()` — this session's sandboxes (including persisted) with status.
- `webFetch(url)` — fetch an http(s) URL as plain text (HTML stripped, truncated).
  Read-only, so also available in discuss mode. Plus `getCurrentTime(timeZone?)`.
- `addKnowledge(title, description, type)` — file project knowledge
  (`background` / `architecture` / `convention` / `glossary`). Always written
  `reviewed:false`. The persistence callback is injected from `index.ts` so
  `agent.ts` stays DB-agnostic.

## Persistence

Conversations are stored in `bun:sqlite` and survive restarts. The webview ships
each finished task to the Bun process (`saveTask`) and loads the active project's
sessions on open (`loadTasks(projectId)`); the agent itself stays stateless. The
DB lives at `<userData>/sessions.db` (macOS: `~/Library/Application Support/<id>/<channel>/`),
one row per conversation with messages as a JSON blob and a `project_id` FK.

Projects live in a `projects` table; `tasks` has a `project_id` column. On first
run after upgrading, pre-project conversations migrate into a `默认项目`. Deleting
a project removes its sessions and their sandboxes.

Knowledge entries are `{ id, projectId, title, description, type, createdAt, isAvailable, reviewed }`
in the `knowledge` table, scoped per project. Storage follows the tasks/projects
pattern: prepared queries + RPC handlers in `index.ts`, client wrappers
(`loadKnowledge` / `saveKnowledge` / `deleteKnowledge`) in `rpc.ts`, types in
`shared/rpc.ts`, UI in `KnowledgeBase.tsx`. New entries enter unreviewed and
appear only under **待审核**; approving sets `reviewed = true`. The 全部 and type
tabs count only reviewed entries. (Pre-existing rows migrate as `reviewed = 1`.)

## Sandboxes (implementation)

Sandboxes use [microsandbox](https://github.com/microsandbox/microsandbox),
namespaced `<sessionId>__<name>`. microsandbox keeps each sandbox's filesystem on
the host under `~/.microsandbox/`, so sandboxes persist. The in-memory map only
caches handles started this run; anything else is re-attached lazily from disk by
`reattach()` in `sandbox.ts`. Command output and diff content are capped at 10k
chars (truncation flagged).

The `msb` binary ships as an npm **optionalDependency** platform package
(`@superradcompany/microsandbox-<triple>`) and is copied into the app bundle by
`electrobun.config.ts` (it's a NAPI module, marked `external`, so it can't be
flat-bundled). Consequence for releases: **only the build host's arch gets its
binary** — a distributable build must be produced on (or with the optional deps
for) its target arch, or the sandbox won't load there. Consider a CI check that
asserts `bin/msb` is present in each platform's bundle.

## Diffs, threads, and git snapshots

Each completed file edit renders as its own white standalone **diff card**,
separate from the grouped tool-call panel — a unified diff via
[`diff`](https://github.com/kpdecker/jsdiff) (jsdiff). See `DiffView`; the split
between diff cards and the tool panel happens in `MessageBlock.tsx` (`toSegments`),
preserving chronological order. A still-running or errored edit stays in the tool
panel until it succeeds.

Any diff card can be discussed in an inline-anchor + side-panel layout. Drag
across diff lines (shift-click extends) to open an inline composer; the first
question docks the **discussion panel** (`DiscussionPanel.tsx`) on the right. Each
thread leaves a slim inline anchor chip; clicking it (or **查看代码**) re-scrolls
to the anchor. Threads stay out of the main transcript and save with the
conversation.

To make discussion of *historical* code reliable, every file-editing turn is
**snapshotted into git**: after the turn, `commitChanges` (`sandbox.ts`) commits
each repo the turn touched inside the sandbox (one commit per sandbox+repo;
`git init`s on demand, installs git if missing). The commit hash rides back as
`assistantCommits` and is stored on the turn. A thread turn is a normal message
carrying an `anchor` (`{ toolCallId, sandboxName, repoRoot, commitHash, path,
startLine, endLine, quotedText }`), reusing the whole streaming/persistence
pipeline. Its `threadHistory` (`taskState.ts`) quotes the snippet and tells the
agent how to browse the repo *at that commit* (`git show <hash>:<file>`,
`git ls-tree -r <hash>`, `git diff <hash> HEAD`). Because the anchor pins an
immutable commit, threads never need re-anchoring and add no extra storage.

### Discuss mode

Thread turns run **read-only**: `runAgent` filters the tool set to
`getCurrentTime`, `runCommand`, `listSandboxes`, `webFetch`, `addKnowledge`,
`refactor` and swaps in a discussion-focused system prompt. Mutating tools
(`writeFile`, `editFile`, `createSandbox`, `stopSandbox`) are withheld. The mode
rides on the `userMessage` RPC (`mode: "build" | "discuss"`, default `build`);
`App.tsx` sends `"discuss"` for any anchored turn.

The one write-adjacent discuss tool is `refactor`: when the user wants the
discussed code changed, the agent calls `refactor({ instruction })` instead of
dead-ending. `App.tsx` watches for the completed call and — once the discuss turn
finishes — fires a real **build-mode turn** in that session's main conversation
(`refactorPrompt` re-attaches the anchored file, range, and snapshot commit). The
`refactor` tool itself never edits; it only hands off.

## Ready to Push (review panel)

`ReviewPanel` opens a full-screen `base..HEAD` review of every change the session
made, across all sandboxes (`DiffView` reused). It's review-only. The backend
(`sandbox.ts`) **discovers repos itself** rather than trusting per-turn commit
records (which only cover files an edit tool touched): it scans each sandbox for
`.git` dirs (bounded `find`), then diffs each repo's `HEAD` against a base ref —
the branch's upstream (`@{u}`) if any, else our session-start baseline
(`refs/nutkin/base`), else git's empty tree.

The baseline ref is anchored on a repo's first auto-commit (before staging),
capturing its pre-app `HEAD`. This makes review work for non-git / no-remote
projects. A repo is included only if it has a remote **or** our baseline ref,
which keeps stray `git init`s in system dirs (e.g. `/etc`) out unless we committed
there. Content loads lazily: `reviewList` returns just the changed-file list
(`git diff --name-status` per repo); `reviewFile` fetches one file's before/after
(capped at 10k, truncation flagged) on open, and `reviewFile` returns HEAD's hash
so review diffs anchor line-level discussion exactly like per-turn diff cards
(synthetic `review:<file>` toolCallId). A repo with no HEAD stays read-only.

## Rendering notes

Replies render via `react-markdown` + `remark-gfm` (GFM tables/task lists/
strikethrough). Elements are restyled to the stone/clay palette via
`markdownComponents` in `App.tsx`. Links open in the system browser: WKWebView
ignores `target="_blank"`, so clicks route over RPC (`openExternal`) to Bun, which
calls `Utils.openExternal` after an http/https scheme check.

## HMR

`bun run dev:hmr`:

1. **Vite dev server** starts on `http://localhost:5173` with HMR enabled.
2. **Electrobun** starts and detects the running Vite server.
3. The app loads from Vite instead of bundled assets.
4. React component changes update instantly without a full reload.

`bun run dev` (no HMR): Electrobun loads from `views://mainview/index.html`;
rebuild (`bun run build`) to see changes.

## Project structure

```
├── src/
│   ├── bun/                 # main process: agent, RPC, SQLite, sandbox
│   ├── shared/              # typed RPC contract
│   └── mainview/            # React UI (App, components, state)
├── electrobun.config.ts     # Electrobun config + bundle copy rules
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Customizing

- **React components**: `src/mainview/`
- **Tailwind theme**: `tailwind.config.js`
- **Vite settings**: `vite.config.ts`
- **Window settings**: `src/bun/index.ts`
- **App metadata**: `electrobun.config.ts`
