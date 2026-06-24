// Webview-side RPC client. Connects to the Bun process and exposes a tiny
// pub/sub API the React app can subscribe to for streamed agent events.
import { Electroview } from "electrobun/view";
import type {
	AgentRPC,
	ChatMessage,
	Commit,
	PersistedTask,
	Project,
	ProjectRepo,
	ProjectSummary,
	SessionSandbox,
	ToolCallInfo,
	ToolResultInfo,
} from "../shared/rpc";

export type AgentEvent =
	| { type: "delta"; id: string; text: string }
	| { type: "reasoning"; id: string; text: string }
	| { type: "toolCall"; call: ToolCallInfo }
	| { type: "toolResult"; result: ToolResultInfo }
	| { type: "commits"; id: string; commits: Commit[] }
	| { type: "done"; id: string }
	| { type: "error"; id: string; message: string };

type Listener = (event: AgentEvent) => void;

const listeners = new Set<Listener>();

function emit(event: AgentEvent) {
	for (const listener of listeners) listener(event);
}

/** Subscribe to streamed agent events. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const rpc = Electroview.defineRPC<AgentRPC>({
	handlers: {
		messages: {
			assistantDelta: ({ id, text }) => emit({ type: "delta", id, text }),
			assistantReasoning: ({ id, text }) =>
				emit({ type: "reasoning", id, text }),
			toolCall: (call) => emit({ type: "toolCall", call }),
			toolResult: (result) => emit({ type: "toolResult", result }),
			assistantCommits: ({ id, commits }) => emit({ type: "commits", id, commits }),
			assistantDone: ({ id }) => emit({ type: "done", id }),
			assistantError: ({ id, message }) =>
				emit({ type: "error", id, message }),
		},
	},
});

new Electroview({ rpc });

/** Send the full conversation to the agent and stream the reply into `assistantId`. */
export function sendUserMessage(
	assistantId: string,
	sessionId: string,
	messages: ChatMessage[],
	project?: { name: string; image: string; repos: ProjectRepo[] },
	mode: "build" | "discuss" = "build",
	sandboxes: SessionSandbox[] = [],
) {
	rpc.send.userMessage({ assistantId, sessionId, messages, project, mode, sandboxes });
}

/** Abort the in-flight agent turn streaming into `assistantId`. */
export function abortTurn(assistantId: string) {
	rpc.send.abortTurn(assistantId);
}

/** Open a URL in the system default browser. */
export function openExternal(url: string) {
	rpc.send.openExternal(url);
}

/** Load a project's conversations, newest first. */
export function loadTasks(projectId: string): Promise<PersistedTask[]> {
	return rpc.request.loadTasks({ projectId });
}

/** Load every project with its session stats, most recently active first. */
export function loadProjects(): Promise<ProjectSummary[]> {
	return rpc.request.loadProjects();
}

/** Upsert a project. */
export function saveProject(project: Project) {
	rpc.send.saveProject(project);
}

/** Delete a project, its sessions, and their sandboxes. */
export function deleteProject(id: string) {
	rpc.send.deleteProject(id);
}

/** Remember the last project the user had open. */
export function setLastProject(id: string) {
	rpc.send.setLastProject(id);
}

/** The id of the last project the user had open, or null. */
export function getLastProject(): Promise<string | null> {
	return rpc.request.getLastProject();
}

/** Persist a conversation snapshot. */
export function saveTask(task: PersistedTask) {
	rpc.send.saveTask(task);
}

/** Delete a conversation and tear down its sandboxes. */
export function deleteTask(id: string) {
	rpc.send.deleteTask(id);
}
