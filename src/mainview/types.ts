// Shared UI state shapes for the chat view. These mirror what the agent streams
// but carry runtime-only flags (pending/busy) that never get persisted.

export interface ToolEvent {
	toolCallId: string;
	toolName: string;
	input?: unknown;
	output?: unknown;
}

export interface UIMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	reasoning: string;
	tools: ToolEvent[];
	pending: boolean;
	error?: string;
}

// A task is one conversation thread. Everything shown in the UI is derived
// from real task state — there is no placeholder data.
export interface Task {
	id: string;
	title: string;
	messages: UIMessage[];
	busy: boolean;
}
