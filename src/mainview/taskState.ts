// Pure conversation-state logic: how a streamed agent event folds into a
// message, how a task round-trips to persistence, and how an event is routed to
// the task that owns its target message. Kept free of React so it can be reused
// and reasoned about on its own.
import type { Anchor, ChatMessage, PersistedTask, SessionSandbox } from "../shared/rpc";
import type { AgentEvent } from "./rpc";
import type { Task, UIMessage } from "./types";

// History for a thread turn: a framing message that quotes the discussed code
// and tells the agent how to time-travel the repo at that commit, the prior
// turns of this thread, then the new question. Kept separate from the main
// transcript so a discussion stays focused on its diff card.
export function threadHistory(
	task: Task,
	anchor: Anchor,
	text: string,
): ChatMessage[] {
	const g = `git -C ${anchor.repoRoot}`;
	const framing = [
		`我们在讨论你在提交 ${anchor.commitHash.slice(0, 8)}（沙箱 ${anchor.sandboxName}，仓库 ${anchor.repoRoot}）中对 ${anchor.path} 的修改。`,
		`讨论的代码片段（第 ${anchor.startLine}-${anchor.endLine} 行）：`,
		"```",
		anchor.quotedText,
		"```",
		`需要查看相关代码时，用 runCommand 在沙箱 ${anchor.sandboxName} 里执行（该提交是不可变快照，即使文件后来又改了也能还原）：`,
		`- 看快照里任意文件： ${g} show ${anchor.commitHash}:<相对路径>`,
		`- 列出全部文件： ${g} ls-tree -r --name-only ${anchor.commitHash}`,
		`- 看这一轮的全部改动： ${g} show ${anchor.commitHash}`,
		`- 看此后的变化： ${g} diff ${anchor.commitHash} HEAD -- ${anchor.path}`,
	].join("\n");
	const prior = task.messages
		.filter(
			(m) =>
				m.anchor?.toolCallId === anchor.toolCallId &&
				m.anchor.startLine === anchor.startLine &&
				m.anchor.endLine === anchor.endLine &&
				m.content.trim().length > 0,
		)
		.map((m) => ({ role: m.role, content: m.content }) as ChatMessage);
	return [{ role: "user", content: framing }, ...prior, { role: "user", content: text }];
}

// A build-mode main-conversation message for a refactor handed off from a
// discussion. Carries the anchor's file/line/snapshot context (same framing
// style as threadHistory) plus the discuss-agent's instruction, so the build
// agent can locate the code and actually edit it.
export function refactorPrompt(anchor: Anchor, instruction: string): string {
	const lines =
		anchor.endLine !== anchor.startLine
			? `lines ${anchor.startLine}-${anchor.endLine}`
			: `line ${anchor.startLine}`;
	return [
		`Please refactor ${anchor.path} (${lines}). This was handed off from a code discussion.`,
		`Reference snippet from commit ${anchor.commitHash.slice(0, 8)} (sandbox ${anchor.sandboxName}, repo ${anchor.repoRoot}):`,
		"```",
		anchor.quotedText,
		"```",
		`Inspect the snapshot with runCommand if needed: git -C ${anchor.repoRoot} show ${anchor.commitHash}:${anchor.path}`,
		"",
		`Refactor request: ${instruction}`,
	].join("\n");
}

export function makeId() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function deriveTitle(text: string) {
	const trimmed = text.trim().replace(/\s+/g, " ");
	return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}

// Fold a single streamed agent event into one message.
export function applyEvent(m: UIMessage, event: AgentEvent): UIMessage {
	switch (event.type) {
		case "delta":
			return { ...m, content: m.content + event.text };
		case "reasoning":
			return { ...m, reasoning: m.reasoning + event.text };
		case "done":
			// Close out any tool calls left without a result (e.g. the turn was
			// aborted mid-execution) so their rows stop showing "运行中".
			return {
				...m,
				pending: false,
				tools: m.tools.map((t) =>
					t.output === undefined
						? { ...t, output: { error: "已中止" }, endedAt: Date.now() }
						: t,
				),
			};
		case "error":
			return { ...m, pending: false, error: event.message };
		case "commits":
			return { ...m, commits: event.commits };
		case "toolCall":
			return {
				...m,
				tools: [
					...m.tools,
					{
						toolCallId: event.call.toolCallId,
						toolName: event.call.toolName,
						input: event.call.input,
						startedAt: Date.now(),
						textOffset: m.content.length,
					},
				],
			};
		case "toolResult":
			return {
				...m,
				tools: m.tools.map((t) =>
					t.toolCallId === event.result.toolCallId
						? { ...t, output: event.result.output, endedAt: Date.now() }
						: t,
				),
			};
		default:
			return m;
	}
}

// Fold a createSandbox tool call into the session's sandbox registry: add the
// sandbox when its name is new, or refresh its description when a new non-empty
// one is given. Any other event leaves the list (referentially) untouched.
export function reduceSandboxes(
	sandboxes: SessionSandbox[],
	event: AgentEvent,
): SessionSandbox[] {
	if (event.type !== "toolCall" || event.call.toolName !== "createSandbox")
		return sandboxes;
	const input = event.call.input as { name?: string; description?: string } | undefined;
	const name = input?.name ?? "default";
	const description = input?.description ?? "";
	const existing = sandboxes.find((s) => s.name === name);
	if (!existing) return [...sandboxes, { name, description }];
	if (description && description !== existing.description)
		return sandboxes.map((s) => (s.name === name ? { ...s, description } : s));
	return sandboxes;
}

// Rebuild the sandbox registry from a conversation's createSandbox tool calls.
// The history is the source of truth (it's always persisted), so a reloaded
// session recovers its sandboxes even though the live registry isn't stored.
// Mirrors reduceSandboxes, but folds over persisted tool calls instead of events.
export function sandboxesFromMessages(messages: UIMessage[]): SessionSandbox[] {
	let sandboxes: SessionSandbox[] = [];
	for (const m of messages) {
		for (const t of m.tools) {
			if (t.toolName !== "createSandbox") continue;
			const input = t.input as { name?: string; description?: string } | undefined;
			const name = input?.name ?? "default";
			const description = input?.description ?? "";
			const existing = sandboxes.find((s) => s.name === name);
			if (!existing) sandboxes = [...sandboxes, { name, description }];
			else if (description && description !== existing.description)
				sandboxes = sandboxes.map((s) => (s.name === name ? { ...s, description } : s));
		}
	}
	return sandboxes;
}

// Drop runtime-only flags before persisting. Sandboxes aren't stored — they're
// re-derived from the message history on load (see sandboxesFromMessages).
export function toPersisted(task: Task): PersistedTask {
	return {
		id: task.id,
		title: task.title,
		projectId: task.projectId,
		messages: task.messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			reasoning: m.reasoning,
			tools: m.tools,
			error: m.error,
			anchor: m.anchor,
			commits: m.commits,
		})),
	};
}

// Restore a stored conversation, re-adding runtime flags as idle and rebuilding
// the sandbox registry from the createSandbox calls in its history.
export function fromPersisted(task: PersistedTask): Task {
	const messages = task.messages.map((m) => ({ ...m, pending: false }));
	return {
		id: task.id,
		title: task.title,
		projectId: task.projectId,
		busy: false,
		sandboxes: sandboxesFromMessages(messages),
		messages,
	};
}

// The target message id is top-level for text events but nested under
// `call`/`result` for tool events — pull it out either way.
export function eventTargetId(event: AgentEvent): string | undefined {
	return event.type === "toolCall"
		? event.call.id
		: event.type === "toolResult"
			? event.result.id
			: event.id;
}

// Fold one streamed event into the task that owns its target message. Tasks and
// messages that aren't the target keep their identity, so a memoized
// MessageBlock can skip re-rendering everything but the streaming message.
export function routeEvent(tasks: Task[], event: AgentEvent): Task[] {
	const id = eventTargetId(event);
	if (!id) return tasks;
	return tasks.map((task) => {
		if (!task.messages.some((m) => m.id === id)) return task;
		const messages = task.messages.map((m) =>
			m.id === id ? applyEvent(m, event) : m,
		);
		const busy =
			event.type === "done" || event.type === "error" ? false : task.busy;
		return { ...task, messages, busy, sandboxes: reduceSandboxes(task.sandboxes, event) };
	});
}
