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

export type AgentRPC = {
	// Messages the Bun process receives (sent by the webview).
	bun: RPCSchema<{
		messages: {
			userMessage: {
				/** Id of the assistant turn this request should stream into. */
				assistantId: string;
				messages: ChatMessage[];
			};
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
