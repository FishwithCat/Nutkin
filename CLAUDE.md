# CLAUDE.md

Default to Bun, not Node.js.

- Run/test/build/install/exec with `bun`, `bun test`, `bun build`, `bun install`, `bun run`, `bunx`.
- Bun auto-loads `.env` — no `dotenv`.
- Prefer Bun APIs over npm equivalents: `Bun.serve()` (not express), `bun:sqlite` (not better-sqlite3), `Bun.redis`, `Bun.sql` (not pg), built-in `WebSocket` (not ws), `Bun.file` (not node:fs), `Bun.$` (not execa).
- Frontend: HTML imports with `Bun.serve()` (not vite/webpack). HTML can import `.tsx`/`.css` directly; Bun bundles and transpiles. React/Tailwind supported.

Bun API docs: `node_modules/bun-types/docs/**.mdx`.

## TypeScript

- Avoid `as any`. Type it properly, or use `unknown` + a narrowing check.

## Workflow

- After implementing a new feature, update `README.md`.
