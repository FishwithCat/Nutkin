# DeepSeek Agent (Electrobun + Vercel AI SDK)

A minimal desktop AI agent: an Electrobun app (React + Tailwind + Vite HMR) whose
Bun main process runs a [Vercel AI SDK](https://github.com/vercel/ai) agent backed
by DeepSeek. The agent can call tools (current time, calculator) in a multi-step
loop, and the result streams live into the chat UI.

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
