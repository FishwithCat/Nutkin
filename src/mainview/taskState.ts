// Pure conversation-state logic: how a streamed agent event folds into a
// message, how a task round-trips to persistence, and how an event is routed to
// the task that owns its target message. Kept free of React so it can be reused
// and reasoned about on its own.
import type { PersistedTask } from "../shared/rpc";
import type { AgentEvent } from "./rpc";
import type { Task, UIMessage } from "./types";

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
					t.output === undefined ? { ...t, output: { error: "已中止" } } : t,
				),
			};
		case "error":
			return { ...m, pending: false, error: event.message };
		case "toolCall":
			return {
				...m,
				tools: [
					...m.tools,
					{
						toolCallId: event.call.toolCallId,
						toolName: event.call.toolName,
						input: event.call.input,
					},
				],
			};
		case "toolResult":
			return {
				...m,
				tools: m.tools.map((t) =>
					t.toolCallId === event.result.toolCallId
						? { ...t, output: event.result.output }
						: t,
				),
			};
		default:
			return m;
	}
}

// Drop runtime-only flags before persisting.
export function toPersisted(task: Task): PersistedTask {
	return {
		id: task.id,
		title: task.title,
		messages: task.messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			reasoning: m.reasoning,
			tools: m.tools,
			error: m.error,
		})),
	};
}

// Restore a stored conversation, re-adding runtime flags as idle.
export function fromPersisted(task: PersistedTask): Task {
	return {
		id: task.id,
		title: task.title,
		busy: false,
		messages: task.messages.map((m) => ({ ...m, pending: false })),
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
		return { ...task, messages, busy };
	});
}
