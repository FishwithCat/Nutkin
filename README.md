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
```

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

## Sessions

Conversations are stored in `bun:sqlite` so they survive restarts. The webview
ships each finished task to the Bun process (`saveTask`) and loads them on
startup (`loadTasks`); the agent itself stays stateless. The database lives at
`<userData>/sessions.db` (macOS: `~/Library/Application Support/<id>/<channel>/`),
one row per conversation with the messages as a JSON blob.

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
- `stopSandbox(name?)` — pause a sandbox (files preserved; resumes on next command).
- `listSandboxes()` — this session's sandboxes (including persisted ones) with status.

Just ask in chat, e.g. *"create a sandbox and run `uname -a` in it"*.

Requirements: a host with hardware virtualization — macOS on Apple Silicon, or
Linux with KVM. The first `createSandbox` for a given image pulls and caches it,
so the first boot is slower.

> Sandboxes accumulate on disk (one per session/name) since they persist. There
> is no automatic GC tied to deleting a chat yet — remove stale ones with
> `Sandbox.remove(name)` or the `msb` CLI if they pile up.

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
