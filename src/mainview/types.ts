// Shared UI state shapes for the chat view. These mirror what the agent streams
// but carry runtime-only flags (pending/busy) that never get persisted.
import type {
	Anchor,
	Commit,
	Project,
	ProjectRepo,
	ProjectSummary,
	ReviewEntry,
	ReviewFileContent,
	ReviewStatus,
	SessionSandbox,
} from "../shared/rpc";

export type {
	Anchor,
	Commit,
	Project,
	ProjectRepo,
	ProjectSummary,
	ReviewEntry,
	ReviewFileContent,
	ReviewStatus,
	SessionSandbox,
};

export interface ToolEvent {
	toolCallId: string;
	toolName: string;
	input?: unknown;
	output?: unknown;
	// Wall-clock timestamps (ms) for how long the call took: set when the call is
	// streamed in and when its result (or abort) lands.
	startedAt?: number;
	endedAt?: number;
	// How many chars of `content` had streamed when this call fired — used to
	// interleave tool calls with text in stream order. Absent on old data → 0.
	textOffset?: number;
}

export interface UIMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	reasoning: string;
	tools: ToolEvent[];
	pending: boolean;
	error?: string;
	// Set on a thread turn — pins it to the diff card / commit it discusses.
	anchor?: Anchor;
	// Set on a turn that edited files — the commit each changed file landed in.
	commits?: Commit[];
}

// A task is one conversation thread. Everything shown in the UI is derived
// from real task state — there is no placeholder data.
export interface Task {
	id: string;
	title: string;
	projectId: string;
	messages: UIMessage[];
	busy: boolean;
	// Sandboxes created in this session (name + purpose), derived from
	// createSandbox tool calls and replayed into the agent's prompt.
	sandboxes: SessionSandbox[];
}
