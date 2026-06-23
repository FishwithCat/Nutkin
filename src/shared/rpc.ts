// Shared RPC contract between the Bun main process and the React webview.
//
// The DeepSeek agent runs in the Bun process (where the API key lives). The
// webview sends the conversation as a fire-and-forget `userMessage`, and the
// Bun process streams the assistant's reply back as a series of messages, each
// tagged with the `id` of the assistant turn so the UI knows what to update.
//
// `import type` only — this file is erased at build time and is safe to import
// from both the Bun side and the Vite-bundled webview.
import type { RPCSchema } from "electrobun/bun";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
	role: ChatRole;
	content: string;
}

/** A tool invocation surfaced to the UI so the agent's steps are visible. */
export interface ToolCallInfo {
	id: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
}

export interface ToolResultInfo {
	id: string;
	toolCallId: string;
	toolName: string;
	output: unknown;
}

// Persisted shape of a conversation — what the webview ships to the Bun process
// to store in sqlite, minus runtime-only flags (busy/pending).
export interface PersistedTool {
	toolCallId: string;
	toolName: string;
	input?: unknown;
	output?: unknown;
	startedAt?: number;
	endedAt?: number;
}

export interface PersistedMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	reasoning: string;
	tools: PersistedTool[];
	error?: string;
}

export interface PersistedTask {
	id: string;
	title: string;
	messages: PersistedMessage[];
}

export type AgentRPC = {
	// Messages the Bun process receives (sent by the webview).
	bun: RPCSchema<{
		requests: {
			/** Load all stored conversations, newest first. */
			loadTasks: { params: undefined; response: PersistedTask[] };
		};
		messages: {
			userMessage: {
				/** Id of the assistant turn this request should stream into. */
				assistantId: string;
				/** Conversation id; scopes the agent's sandboxes to this session. */
				sessionId: string;
				messages: ChatMessage[];
			};
			/** Upsert a conversation snapshot. */
			saveTask: PersistedTask;
			/** Delete a conversation and remove its sandboxes. Payload is the task id. */
			deleteTask: string;
			/** Abort an in-flight agent turn. Payload is the assistantId. */
			abortTurn: string;
			/** Open a URL in the system default browser. Payload is the URL. */
			openExternal: string;
		};
	}>;
	// Messages the webview receives (sent by the Bun process).
	webview: RPCSchema<{
		messages: {
			assistantDelta: { id: string; text: string };
			assistantReasoning: { id: string; text: string };
			toolCall: ToolCallInfo;
			toolResult: ToolResultInfo;
			assistantDone: { id: string };
			assistantError: { id: string; message: string };
		};
	}>;
};
