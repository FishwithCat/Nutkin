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

/**
 * App-level (global) settings — scope is the whole instance, not a project.
 * Edited on the 系统设置 page; persisted as key/value rows in app_state.
 */
export interface AppSettings {
	deepseekApiKey: string; // required for the agent to run
	deepseekModel: string; // empty = default model
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

/** A sandbox the session has created, tracked so the agent reuses it by name. */
export interface SessionSandbox {
	name: string;
	description: string;
}

export type ReviewStatus = "added" | "modified" | "deleted";

/**
 * One changed file in a session's "Ready to Push" review, identifying the repo
 * (inside a sandbox) and its change kind. The before/after text is fetched
 * separately, per file, only when the user opens it (see ReviewFileContent).
 */
export interface ReviewEntry {
	sandboxName: string;
	repoRoot: string;
	path: string;
	status: ReviewStatus;
}

/** The before/after text for one reviewed file (capped; flagged when truncated). */
export interface ReviewFileContent {
	oldText: string;
	newText: string;
	truncated?: boolean;
	// HEAD's commit hash — the immutable snapshot `newText` is read from, so a
	// review diff can anchor a discussion just like a per-turn diff card. Empty
	// when the repo has no HEAD (then the file stays read-only).
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

// One thinking block, pinned to the point in the streamed text where it fired
// (`textOffset` = chars of content streamed when it started), so reasoning
// interleaves with text and tool calls in true stream order.
export interface ReasoningPart {
	text: string;
	textOffset: number;
}

export interface PersistedMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	// Old data stored this as a single string; readers normalize (see fromPersisted).
	reasoning: ReasoningPart[] | string;
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
	// Sandboxes this session has created (name + purpose), so the agent reuses
	// them by name instead of spawning duplicates. Derived from createSandbox.
	sandboxes?: SessionSandbox[];
}

export type KnowledgeType =
	| "background" // 项目背景
	| "architecture" // 架构决策
	| "convention" // 编码规范
	| "glossary"; // 领域术语

/** One stored piece of project knowledge, scoped to a project like tasks are. */
export interface Knowledge {
	id: string;
	projectId: string;
	title: string;
	description: string;
	type: KnowledgeType;
	createdAt: number; // ms epoch
	updatedAt: number; // ms epoch — last content edit, for judging freshness
	isAvailable: boolean;
	// Whether the entry has passed review and joined the active KB. Unreviewed
	// entries are quarantined under the 待审核 category until approved.
	reviewed: boolean;
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
			/**
			 * The list of changed files across the session's sandboxes, for the push
			 * review. The backend discovers the git repos itself; cheap (no per-file
			 * content), so the panel opens fast regardless of how many files changed.
			 */
			reviewList: {
				params: { sessionId: string; sandboxes: string[] };
				response: ReviewEntry[];
			};
			/** The before/after text for one reviewed file, fetched on open. */
			reviewFile: {
				params: { sessionId: string; sandboxName: string; repoRoot: string; path: string };
				response: ReviewFileContent;
			};
			/** Load a project's knowledge entries, newest first. */
			loadKnowledge: { params: { projectId: string }; response: Knowledge[] };
			/** Load global app settings (model + API key). */
			loadSettings: { params: undefined; response: AppSettings };
		};
		messages: {
			userMessage: {
				/** Id of the assistant turn this request should stream into. */
				assistantId: string;
				/** Conversation id; scopes the agent's sandboxes to this session. */
				sessionId: string;
				messages: ChatMessage[];
				/** The session's project context (id + default image + bound repos). */
				project?: { id: string; name: string; image: string; repos: ProjectRepo[] };
				/** Sandboxes already created in this session, injected into the prompt. */
				sandboxes?: SessionSandbox[];
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
			/** Upsert a knowledge entry. */
			saveKnowledge: Knowledge;
			/** Delete a knowledge entry. Payload is the knowledge id. */
			deleteKnowledge: string;
			/** Save global app settings (model + API key). */
			saveSettings: AppSettings;
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
