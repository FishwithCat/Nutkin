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

/** A git repository bound to a project. */
export interface ProjectRepo {
	url: string; // clone URL, e.g. https://github.com/org/repo.git
	name: string; // display name derived from the URL, e.g. org/repo
	branch: string; // default branch to work on, e.g. main
}

/**
 * A project groups a set of chat sessions around one or more code repositories
 * and a default sandbox image. Sessions (tasks) belong to exactly one project.
 */
export interface Project {
	id: string;
	name: string;
	repos: ProjectRepo[];
	image: string; // default sandbox image for this project's sessions
	createdAt: number;
	updatedAt: number;
}

/** A project plus the live stats shown on the project list cards. */
export interface ProjectSummary extends Project {
	sessionCount: number;
	lastActivity: number | null; // ms epoch of the newest session, or null
}

/**
 * A code region under discussion, pinned to the immutable per-turn git commit
 * the change was snapshotted into. The commit lets the agent time-travel the
 * whole repo (`git show <hash>:<file>`) to look at related code, while the
 * frozen `quotedText` is shown without a round-trip.
 */
export interface Anchor {
	toolCallId: string; // the diff card this thread hangs on (grouping key)
	sandboxName: string; // sandbox to run git in
	repoRoot: string; // `git -C` root
	commitHash: string; // immutable whole-repo snapshot for that turn
	path: string; // discussed file
	startLine: number; // 1-based line range in the new file
	endLine: number;
	quotedText: string; // frozen snippet
}

/** Per-file record of the commit a turn produced, used to build an Anchor. */
export interface Commit {
	path: string;
	sandboxName: string;
	repoRoot: string;
	commitHash: string;
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
	// Set on a thread turn — pins it to the diff card / commit it discusses.
	anchor?: Anchor;
	// Set on a turn that edited files — the commit each changed file landed in.
	commits?: Commit[];
}

export interface PersistedTask {
	id: string;
	title: string;
	projectId: string; // the project this session belongs to
	messages: PersistedMessage[];
}

export type AgentRPC = {
	// Messages the Bun process receives (sent by the webview).
	bun: RPCSchema<{
		requests: {
			/** Load every project with its session stats, most recently active first. */
			loadProjects: { params: undefined; response: ProjectSummary[] };
			/** Load a project's conversations, newest first. */
			loadTasks: { params: { projectId: string }; response: PersistedTask[] };
			/** The id of the last project the user had open, or null. */
			getLastProject: { params: undefined; response: string | null };
		};
		messages: {
			userMessage: {
				/** Id of the assistant turn this request should stream into. */
				assistantId: string;
				/** Conversation id; scopes the agent's sandboxes to this session. */
				sessionId: string;
				messages: ChatMessage[];
				/** The session's project context (default image + bound repos). */
				project?: { name: string; image: string; repos: ProjectRepo[] };
				/**
				 * How the turn runs. "discuss" (thread turns hanging off a diff card)
				 * gives the agent a read-only tool set — no file edits, no sandbox
				 * create/stop. Defaults to "build" when omitted.
				 */
				mode?: "build" | "discuss";
			};
			/** Upsert a project. */
			saveProject: Project;
			/** Delete a project, its sessions, and their sandboxes. Payload is the project id. */
			deleteProject: string;
			/** Remember the last project the user had open. Payload is the project id. */
			setLastProject: string;
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
			/** Per-turn git snapshot: the commit each changed file landed in. */
			assistantCommits: { id: string; commits: Commit[] };
		};
	}>;
};
