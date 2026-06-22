import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { runAgent } from "./agent";
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
			userMessage: ({ assistantId, messages }) => {
				const modelMessages = messages as ModelMessage[];
				void runAgent(modelMessages, {
					onText: (text) => rpc.send.assistantDelta({ id: assistantId, text }),
					onReasoning: (text) =>
						rpc.send.assistantReasoning({ id: assistantId, text }),
					onToolCall: (call) =>
						rpc.send.toolCall({ id: assistantId, ...call }),
					onToolResult: (result) =>
						rpc.send.toolResult({ id: assistantId, ...result }),
					onError: (message) =>
						rpc.send.assistantError({ id: assistantId, message }),
					onDone: () => rpc.send.assistantDone({ id: assistantId }),
				});
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

console.log("DeepSeek Agent app started!");
