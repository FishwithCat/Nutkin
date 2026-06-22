import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { ModelMessage } from "ai";
import { runAgent } from "./agent";
import type { AgentRPC } from "../shared/rpc";

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
		messages: {
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
