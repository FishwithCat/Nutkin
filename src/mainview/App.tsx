import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../shared/rpc";
import {
	abortTurn,
	deleteTask,
	loadTasks,
	saveTask,
	sendUserMessage,
	subscribe,
} from "./rpc";
import type { AgentEvent } from "./rpc";
import {
	deriveTitle,
	fromPersisted,
	makeId,
	routeEvent,
	toPersisted,
} from "./taskState";
import type { Task, UIMessage } from "./types";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { MessageBlock } from "./components/MessageBlock";
import { Sidebar } from "./components/Sidebar";
import { TaskHeader } from "./components/TaskHeader";
import { TopBar } from "./components/TopBar";

function App() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const savedRef = useRef<Map<string, string>>(new Map());
	// Whether the view should keep following new content. Updated on every scroll
	// so we know — *before* the next update grows the container — if the user was
	// sitting at the bottom. Measuring after the update can't tell "user is at the
	// bottom" from "a tall chunk just arrived", which is what broke auto-follow.
	const stickRef = useRef(true);

	const activeTask = tasks.find((t) => t.id === activeId) ?? null;

	// Load persisted conversations once on mount.
	useEffect(() => {
		loadTasks().then((stored) => {
			for (const t of stored) savedRef.current.set(t.id, JSON.stringify(t));
			setTasks(stored.map(fromPersisted));
		});
	}, []);

	// Persist idle tasks whose content changed. Busy tasks are skipped — their
	// completed turn is saved when the stream ends (busy flips false).
	// ponytail: 串流中途崩溃会丢未完成轮次；需要再改成 debounce 中途保存。
	useEffect(() => {
		for (const task of tasks) {
			if (task.busy) continue;
			const persisted = toPersisted(task);
			const serialized = JSON.stringify(persisted);
			if (savedRef.current.get(task.id) === serialized) continue;
			savedRef.current.set(task.id, serialized);
			saveTask(persisted);
		}
	}, [tasks]);

	// Subscribe once. Streamed deltas arrive as separate RPC callbacks (each its
	// own macrotask), so React can't batch them — left alone, every token forces
	// a full render and a Markdown re-parse, which flickers. Coalesce the events
	// into one state update per animation frame instead.
	useEffect(() => {
		let frame: number | null = null;
		const queue: AgentEvent[] = [];
		const flush = () => {
			frame = null;
			if (queue.length === 0) return;
			const batch = queue.splice(0, queue.length);
			setTasks((prev) => batch.reduce(routeEvent, prev));
		};
		const unsubscribe = subscribe((event) => {
			queue.push(event);
			if (frame === null) frame = requestAnimationFrame(flush);
		});
		return () => {
			unsubscribe();
			if (frame !== null) cancelAnimationFrame(frame);
		};
	}, []);

	// Re-evaluate "is the user at the bottom" on every scroll. Our own programmatic
	// jumps land at the bottom too, so they just keep the flag true.
	function onScroll() {
		const el = scrollRef.current;
		if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
	}

	// Opening a conversation lands at its latest message.
	useLayoutEffect(() => {
		stickRef.current = true;
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [activeId]);

	// Follow new content only while stuck to the bottom, so scrolling up to read
	// history isn't yanked back down. useLayoutEffect runs before paint, so the
	// jump is applied in the same frame as the new content — no visible jitter.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (el && stickRef.current) el.scrollTop = el.scrollHeight;
	}, [activeTask?.messages]);

	function send() {
		const text = input.trim();
		if (!text || activeTask?.busy) return;

		// Sending always pulls the view down to the new turn, even if the user had
		// scrolled up into history.
		stickRef.current = true;

		const userMsg: UIMessage = {
			id: makeId(),
			role: "user",
			content: text,
			reasoning: "",
			tools: [],
			pending: false,
		};
		const assistantId = makeId();
		const assistantMsg: UIMessage = {
			id: assistantId,
			role: "assistant",
			content: "",
			reasoning: "",
			tools: [],
			pending: true,
		};

		if (!activeTask) {
			// No active task — start a new one from this message.
			const task: Task = {
				id: makeId(),
				title: deriveTitle(text),
				messages: [userMsg, assistantMsg],
				busy: true,
			};
			setTasks((prev) => [task, ...prev]);
			setActiveId(task.id);
			setInput("");
			sendUserMessage(assistantId, task.id, [{ role: "user", content: text }]);
			return;
		}

		// History sent to the agent = prior complete messages + the new user turn.
		const history: ChatMessage[] = [
			...activeTask.messages
				.filter((m) => m.content.trim().length > 0)
				.map((m) => ({ role: m.role, content: m.content })),
			{ role: "user", content: text },
		];

		setTasks((prev) =>
			prev.map((t) =>
				t.id === activeTask.id
					? { ...t, messages: [...t.messages, userMsg, assistantMsg], busy: true }
					: t,
			),
		);
		setInput("");
		sendUserMessage(assistantId, activeTask.id, history);
	}

	// Stop the active task's in-flight turn. The backend's onDone flips busy
	// false once the abort propagates; the partial reply already streamed stays.
	function abort() {
		if (!activeTask?.busy) return;
		const pending = activeTask.messages.find(
			(m) => m.role === "assistant" && m.pending,
		);
		if (pending) abortTurn(pending.id);
	}

	function newTask() {
		setActiveId(null);
		setInput("");
	}

	function removeTask(id: string) {
		setTasks((prev) => prev.filter((t) => t.id !== id));
		savedRef.current.delete(id);
		if (activeId === id) setActiveId(null);
		deleteTask(id); // backend deletes the row and removes its sandboxes
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		// During IME composition (e.g. Chinese pinyin) Enter confirms the
		// candidate, not the message. WebKit may clear isComposing before this
		// keydown but still reports keyCode 229 while the IME owns the key.
		if (e.nativeEvent.isComposing || e.keyCode === 229) return;
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	return (
		<div className="flex flex-col h-screen bg-stone-50 text-stone-800">
			<TopBar />

			<div className="flex-1 flex min-h-0">
				<Sidebar
					tasks={tasks}
					activeId={activeId}
					onSelect={setActiveId}
					onNew={newTask}
					onDelete={removeTask}
				/>

				<main className="flex-1 flex flex-col min-w-0">
					{activeTask && <TaskHeader task={activeTask} />}

					<div
						ref={scrollRef}
						onScroll={onScroll}
						className="flex-1 overflow-y-auto"
					>
						<div className="w-full px-6 py-6 space-y-4">
							{activeTask ? (
								activeTask.messages.map((m) => (
									<MessageBlock key={m.id} message={m} />
								))
							) : (
								<EmptyState />
							)}
						</div>
					</div>

					<Composer
						input={input}
						setInput={setInput}
						onKeyDown={onKeyDown}
						onSend={send}
						onAbort={abort}
						busy={activeTask?.busy ?? false}
					/>
				</main>
			</div>
		</div>
	);
}

export default App;
