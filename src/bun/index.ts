import {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Updater,
	Utils,
} from "electrobun/bun";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { runAgent } from "./agent";
import {
	commitChanges,
	removeSessionSandboxes,
	stopAllSandboxes,
	type ChangedFile,
} from "./sandbox";
import type { AgentRPC, PersistedTask } from "../shared/rpc";

// Persisted conversations live in the per-user app data dir.
mkdirSync(Utils.paths.userData, { recursive: true });
const db = new Database(join(Utils.paths.userData, "sessions.db"));
db.run(
	`CREATE TABLE IF NOT EXISTS tasks (
		id         TEXT PRIMARY KEY,
		title      TEXT NOT NULL,
		data       TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
);
const upsertTask = db.query(
	`INSERT INTO tasks (id, title, data, updated_at) VALUES ($id, $title, $data, $now)
	 ON CONFLICT(id) DO UPDATE SET title = $title, data = $data, updated_at = $now`,
);
const selectTasks = db.query<{ id: string; title: string; data: string }, []>(
	"SELECT id, title, data FROM tasks ORDER BY updated_at DESC",
);
const deleteTaskRow = db.query("DELETE FROM tasks WHERE id = $id");

// In-flight agent turns, keyed by assistantId, so the webview can abort them.
const running = new Map<string, AbortController>();

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// RPC bridge between the webview and the DeepSeek agent. The webview sends the
// conversation via `userMessage`; we run the agent and stream events back.
const rpc = BrowserView.defineRPC<AgentRPC>({
	// Agent turns can run for a while, so never time these out.
	maxRequestTime: Infinity,
	handlers: {
		requests: {
			loadTasks: (): PersistedTask[] =>
				selectTasks.all().map((row) => ({
					id: row.id,
					title: row.title,
					messages: JSON.parse(row.data),
				})),
		},
		messages: {
			saveTask: (task) => {
				upsertTask.run({
					$id: task.id,
					$title: task.title,
					$data: JSON.stringify(task.messages),
					$now: Date.now(),
				});
			},
			deleteTask: (id) => {
				deleteTaskRow.run({ $id: id });
				// Tear down the chat's sandboxes (rootfs included) — fire and forget.
				void removeSessionSandboxes(id);
			},
			userMessage: ({ assistantId, sessionId, messages }) => {
				const modelMessages = messages as ModelMessage[];
				const controller = new AbortController();
				running.set(assistantId, controller);
				// Track which files (and in which sandbox) this turn changed, so we
				// can snapshot the touched repos once the turn ends.
				const sandboxOf = new Map<string, string>(); // toolCallId -> sandbox name
				const changed: ChangedFile[] = [];
				const isEdit = (name: string) => name === "writeFile" || name === "editFile";
				void runAgent(
					sessionId,
					modelMessages,
					{
						onText: (text) => rpc.send.assistantDelta({ id: assistantId, text }),
						onReasoning: (text) =>
							rpc.send.assistantReasoning({ id: assistantId, text }),
						onToolCall: (call) => {
							if (isEdit(call.toolName)) {
								const name = (call.input as { name?: string } | undefined)?.name ?? "default";
								sandboxOf.set(call.toolCallId, name);
							}
							rpc.send.toolCall({ id: assistantId, ...call });
						},
						onToolResult: (result) => {
							if (isEdit(result.toolName)) {
								const out = result.output as { path?: string } | undefined;
								if (out && typeof out.path === "string") {
									changed.push({
										sandboxName: sandboxOf.get(result.toolCallId) ?? "default",
										path: out.path,
									});
								}
							}
							rpc.send.toolResult({ id: assistantId, ...result });
						},
						onError: (message) =>
							rpc.send.assistantError({ id: assistantId, message }),
						onDone: () => {
							running.delete(assistantId);
							// Snapshot the repos this turn touched, then send the hashes
							// (before `done`, so they persist with the turn) and finish.
							void (async () => {
								if (changed.length > 0) {
									const commits = await commitChanges(sessionId, changed).catch(() => []);
									if (commits.length > 0)
										rpc.send.assistantCommits({ id: assistantId, commits });
								}
								rpc.send.assistantDone({ id: assistantId });
							})();
						},
					},
					controller.signal,
				);
			},
			abortTurn: (assistantId) => running.get(assistantId)?.abort(),
			openExternal: (url) => {
				// Only hand http/https links to the OS — never file://, javascript:,
				// or other schemes that could come from untrusted agent output.
				try {
					const { protocol } = new URL(url);
					if (protocol === "http:" || protocol === "https:") {
						Utils.openExternal(url);
					}
				} catch {
					// Ignore malformed URLs.
				}
			},
		},
	},
});

// Create the main application window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "DeepSeek Agent",
	url,
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 200,
	},
	rpc,
});

// Open maximized so the window fills the screen by default
mainWindow.maximize();

// Without an Edit menu, macOS WKWebView never receives the standard
// copy/cut/paste/select-all key equivalents. The roles map to NSResponder
// selectors, so CMD+C/V/X/A start working in the input box.
// macOS treats the FIRST top-level menu as the app menu, so Edit must come
// second or its key equivalents never install as a real Edit menu.
ApplicationMenu.setApplicationMenu([
	{
		label: "Nutkin",
		submenu: [
			{ role: "about" },
			{ type: "divider" },
			{ role: "hide", accelerator: "CmdOrCtrl+H" },
			{ role: "quit", accelerator: "CmdOrCtrl+Q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "CmdOrCtrl+Z" },
			{ role: "redo", accelerator: "CmdOrCtrl+Shift+Z" },
			{ type: "divider" },
			{ role: "cut", accelerator: "CmdOrCtrl+X" },
			{ role: "copy", accelerator: "CmdOrCtrl+C" },
			{ role: "paste", accelerator: "CmdOrCtrl+V" },
			{ role: "selectAll", accelerator: "CmdOrCtrl+A" },
		],
	},
]);

// ponytail: best-effort sandbox cleanup on signals. Ceiling: a hard SIGKILL can
// orphan microVM child processes — add an Electrobun quit hook if that bites.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		void stopAllSandboxes().finally(() => process.exit(0));
	});
}

console.log("DeepSeek Agent app started!");
