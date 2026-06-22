import { useEffect, useRef, useState } from "react";
import {
	ArrowUp,
	Box,
	Calculator,
	Check,
	ChevronRight,
	Clock,
	List,
	Loader2,
	Plus,
	Square,
	Terminal,
	Trash2,
	Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChatMessage, PersistedTask } from "../shared/rpc";
import {
	deleteTask,
	loadTasks,
	saveTask,
	sendUserMessage,
	subscribe,
} from "./rpc";
import type { AgentEvent } from "./rpc";

interface ToolEvent {
	toolCallId: string;
	toolName: string;
	input?: unknown;
	output?: unknown;
}

interface UIMessage {
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
interface Task {
	id: string;
	title: string;
	messages: UIMessage[];
	busy: boolean;
}

function makeId() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function deriveTitle(text: string) {
	const trimmed = text.trim().replace(/\s+/g, " ");
	return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed;
}

// Fold a single streamed agent event into one message.
function applyEvent(m: UIMessage, event: AgentEvent): UIMessage {
	switch (event.type) {
		case "delta":
			return { ...m, content: m.content + event.text };
		case "reasoning":
			return { ...m, reasoning: m.reasoning + event.text };
		case "done":
			return { ...m, pending: false };
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
function toPersisted(task: Task): PersistedTask {
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
function fromPersisted(task: PersistedTask): Task {
	return {
		id: task.id,
		title: task.title,
		busy: false,
		messages: task.messages.map((m) => ({ ...m, pending: false })),
	};
}

function App() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const savedRef = useRef<Map<string, string>>(new Map());

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

	// Subscribe once; route each event to the task that owns the target message.
	useEffect(() => {
		return subscribe((event) => {
			// The target message id is top-level for text events but nested under
			// `call`/`result` for tool events — pull it out either way.
			const id =
				event.type === "toolCall"
					? event.call.id
					: event.type === "toolResult"
						? event.result.id
						: event.id;
			if (!id) return;
			setTasks((prev) =>
				prev.map((task) => {
					if (!task.messages.some((m) => m.id === id)) return task;
					const messages = task.messages.map((m) =>
						m.id === id ? applyEvent(m, event) : m,
					);
					const busy =
						event.type === "done" || event.type === "error"
							? false
							: task.busy;
					return { ...task, messages, busy };
				}),
			);
		});
	}, []);

	// Auto-scroll the active conversation to the latest content.
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
	}, [activeTask?.messages]);

	function send() {
		const text = input.trim();
		if (!text || activeTask?.busy) return;

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

					<div ref={scrollRef} className="flex-1 overflow-y-auto">
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
						busy={activeTask?.busy ?? false}
					/>
				</main>
			</div>
		</div>
	);
}

function TopBar() {
	return (
		<header className="flex items-center gap-3 px-5 h-14 border-b border-stone-200 bg-white shrink-0">
			<div className="w-8 h-8 rounded-lg bg-clay-500 flex items-center justify-center text-white font-bold text-sm">
				N
			</div>
			<span className="font-semibold text-stone-900">Nutkin</span>
			<span className="text-stone-300">|</span>
			<span className="text-sm text-stone-500">Agent</span>
		</header>
	);
}

function Sidebar({
	tasks,
	activeId,
	onSelect,
	onNew,
	onDelete,
}: {
	tasks: Task[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
}) {
	return (
		<aside className="w-72 shrink-0 border-r border-stone-200 bg-white flex flex-col">
			<div className="flex items-center justify-between px-5 h-16 shrink-0">
				<h2 className="text-base font-semibold text-stone-900">任务</h2>
				<button
					type="button"
					onClick={onNew}
					className="w-7 h-7 rounded-lg bg-clay-500 text-white flex items-center justify-center hover:bg-clay-600 transition-colors"
					title="新建任务"
				>
					<Plus size={16} aria-hidden="true" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-3 pt-1 pb-4 space-y-1">
				{tasks.length === 0 ? (
					<p className="px-3 py-6 text-sm text-stone-400 text-center">
						还没有任务，点击 + 开始
					</p>
				) : (
					tasks.map((task) => (
						<TaskCard
							key={task.id}
							task={task}
							selected={task.id === activeId}
							onClick={() => onSelect(task.id)}
							onDelete={() => onDelete(task.id)}
						/>
					))
				)}
			</div>
		</aside>
	);
}

function TaskCard({
	task,
	selected,
	onClick,
	onDelete,
}: {
	task: Task;
	selected: boolean;
	onClick: () => void;
	onDelete: () => void;
}) {
	return (
		<div
			className={`group relative rounded-xl transition-colors ${
				selected ? "bg-clay-50 ring-1 ring-clay-200" : "hover:bg-stone-50"
			}`}
		>
			<button
				type="button"
				onClick={onClick}
				className="w-full text-left rounded-xl px-3 py-3 pr-9"
			>
				<StatusLabel busy={task.busy} />
				<p
					className={`mt-1 text-sm leading-snug ${
						selected ? "text-stone-900 font-medium" : "text-stone-700"
					}`}
				>
					{task.title}
				</p>
			</button>
			<button
				type="button"
				onClick={onDelete}
				title="删除任务（同时移除其沙箱）"
				className="absolute top-2.5 right-2 w-6 h-6 rounded-md flex items-center justify-center text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-200 hover:text-red-600 transition"
			>
				<Trash2 size={14} aria-hidden="true" />
			</button>
		</div>
	);
}

function StatusLabel({ busy }: { busy: boolean }) {
	if (busy) {
		return (
			<div className="flex items-center gap-1.5 text-xs text-clay-600">
				<span className="w-1.5 h-1.5 rounded-full bg-clay-500 animate-pulse" />
				<span>运行中</span>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-1.5 text-xs text-stone-400">
			<span className="w-2.5 h-2.5 rounded-full border border-stone-300" />
			<span>就绪</span>
		</div>
	);
}

function TaskHeader({ task }: { task: Task }) {
	const count = task.messages.length;
	return (
		<div className="px-6 pt-6 pb-4 border-b border-stone-200 bg-stone-50 shrink-0">
			<div className="w-full">
				<div className="flex items-center gap-3">
					<h1 className="text-xl font-semibold text-stone-900">{task.title}</h1>
					{task.busy && (
						<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-clay-100 text-clay-700 text-xs font-medium">
							<span className="w-1.5 h-1.5 rounded-full bg-clay-500 animate-pulse" />
							运行中
						</span>
					)}
				</div>
				<p className="mt-1.5 text-sm text-stone-400">{count} 条消息</p>
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="text-center text-stone-400 mt-24">
			<div className="text-3xl mb-3">🐿️</div>
			<p className="text-stone-500">
				告诉 Nutkin 你想做什么 — 试试 “现在几点了？” 或 “(12 + 8) * 3 等于多少？”
			</p>
		</div>
	);
}

function MessageBlock({ message }: { message: UIMessage }) {
	const isUser = message.role === "user";
	const empty =
		!isUser &&
		message.content.length === 0 &&
		message.tools.length === 0 &&
		message.reasoning.length === 0 &&
		!message.error;

	if (isUser) {
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] rounded-2xl rounded-br-sm bg-clay-500 text-white px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
					{message.content}
				</div>
			</div>
		);
	}

	return (
		<div className="flex gap-3">
			<div className="w-7 h-7 shrink-0 rounded-lg bg-clay-500 text-white flex items-center justify-center text-xs font-bold mt-0.5">
				N
			</div>
			<div className="min-w-0 flex-1 space-y-3">
				{message.reasoning && (
					<details className="text-xs text-stone-500">
						<summary className="cursor-pointer select-none hover:text-stone-700">
							思考过程
						</summary>
						<pre className="whitespace-pre-wrap mt-1.5 p-3 rounded-lg bg-stone-100 text-stone-500">
							{message.reasoning}
						</pre>
					</details>
				)}

				{message.tools.length > 0 && <ToolPanel tools={message.tools} />}

				{message.content && (
					<div className="text-sm leading-relaxed text-stone-800 whitespace-pre-wrap">
						{message.content}
					</div>
				)}

				{empty && (
					<div className="flex gap-1 py-1.5">
						<Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
					</div>
				)}

				{message.error && (
					<div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
						⚠️ {message.error}
					</div>
				)}
			</div>
		</div>
	);
}

// Per-tool display metadata: which icon to show and a one-line summary of the
// call's primary argument. Falls back to the first string field / raw JSON for
// any tool not listed here, so new tools render sensibly without changes.
function toolMeta(tool: ToolEvent): { icon: LucideIcon; summary: string } {
	const input = (tool.input ?? {}) as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === "string" ? v : "");
	switch (tool.toolName) {
		case "getCurrentTime":
			return { icon: Clock, summary: str(input.timeZone) || "now" };
		case "calculate":
			return { icon: Calculator, summary: str(input.expression) };
		case "createSandbox":
			return {
				icon: Box,
				summary: [str(input.name) || "default", str(input.image) || "alpine"].join(" · "),
			};
		case "runCommand":
			return {
				icon: Terminal,
				summary: [str(input.command), ...(Array.isArray(input.args) ? input.args.map(String) : [])]
					.join(" ")
					.trim(),
			};
		case "stopSandbox":
			return { icon: Square, summary: str(input.name) || "default" };
		case "listSandboxes":
			return { icon: List, summary: "" };
		default: {
			const first = Object.values(input).find((v) => typeof v === "string");
			return { icon: Wrench, summary: str(first) || JSON.stringify(tool.input ?? {}) };
		}
	}
}

// One bordered panel grouping every tool call in a turn. History stays folded;
// the latest (or any still-running) call is expanded by default.
function ToolPanel({ tools }: { tools: ToolEvent[] }) {
	// Per-row open overrides. A row with no override falls back to "is the latest
	// call", so history stays folded and the newest auto-expands — but any number
	// of rows can be toggled open independently.
	const [open, setOpen] = useState<Record<string, boolean>>({});
	const lastId = tools[tools.length - 1]?.toolCallId;
	return (
		<div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-100">
				<div className="flex items-center gap-2">
					<Wrench size={15} className="text-stone-400" aria-hidden="true" />
					<span className="text-sm font-medium text-stone-800">工具调用</span>
					<span className="text-xs text-stone-400">{tools.length}</span>
				</div>
				<span className="text-xs text-stone-400">默认折叠历史 · 仅展开最新</span>
			</div>
			<div className="divide-y divide-stone-100">
				{tools.map((t) => {
					const isOpen = open[t.toolCallId] ?? t.toolCallId === lastId;
					return (
						<ToolRow
							key={t.toolCallId}
							tool={t}
							open={isOpen}
							onToggle={() => setOpen((o) => ({ ...o, [t.toolCallId]: !isOpen }))}
						/>
					);
				})}
			</div>
		</div>
	);
}

function ToolRow({
	tool,
	open,
	onToggle,
}: {
	tool: ToolEvent;
	open: boolean;
	onToggle: () => void;
}) {
	const running = tool.output === undefined;
	const { icon: Icon, summary } = toolMeta(tool);

	return (
		<div>
			<button
				type="button"
				onClick={onToggle}
				className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-stone-50 transition-colors"
			>
				<ChevronRight
					size={14}
					className={`shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
					aria-hidden="true"
				/>
				<Icon size={15} className="shrink-0 text-stone-500" aria-hidden="true" />
				<span className="text-sm font-medium text-stone-800 shrink-0">{tool.toolName}</span>
				<span className="text-xs text-stone-400 truncate font-mono">{summary}</span>
				<span className="ml-auto shrink-0">
					{running ? (
						<span className="flex items-center gap-1 text-xs text-clay-500">
							<Loader2 size={13} className="animate-spin" aria-hidden="true" />
							运行中
						</span>
					) : (
						<Check size={15} className="text-emerald-600" aria-hidden="true" />
					)}
				</span>
			</button>

			{open && (
				<div className="bg-stone-900 px-4 py-3 font-mono text-xs leading-relaxed">
					<div className="text-stone-400">
						<span className="text-emerald-400">$</span> {tool.toolName}{" "}
						<span className="text-stone-500">{summary}</span>
					</div>
					<div className="text-stone-300 mt-1 break-all">in: {JSON.stringify(tool.input)}</div>
					{tool.output !== undefined ? (
						<div className="text-emerald-400 mt-1 break-all">out: {JSON.stringify(tool.output)}</div>
					) : (
						<div className="text-clay-400 mt-1">运行中…</div>
					)}
				</div>
			)}
		</div>
	);
}

function Composer({
	input,
	setInput,
	onKeyDown,
	onSend,
	busy,
}: {
	input: string;
	setInput: (v: string) => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onSend: () => void;
	busy: boolean;
}) {
	return (
		<div className="border-t border-stone-200 bg-stone-50 shrink-0">
			<div className="w-full px-6 py-4">
				<div className="flex items-end gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-2 focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition-colors">
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={onKeyDown}
						rows={1}
						placeholder="让 Agent 继续做点什么…"
						className="flex-1 resize-none bg-transparent outline-none text-sm text-stone-800 placeholder:text-stone-400 max-h-40 py-1.5"
					/>
					<button
						type="button"
						onClick={onSend}
						disabled={busy || input.trim().length === 0}
						className="shrink-0 w-9 h-9 rounded-xl bg-clay-500 text-white flex items-center justify-center hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
						title="发送"
					>
						{busy ? (
							<span className="text-sm">…</span>
						) : (
							<ArrowUp size={18} aria-hidden="true" />
						)}
					</button>
				</div>
			</div>
		</div>
	);
}

function Dot({ delay = "0ms" }: { delay?: string }) {
	return (
		<span
			className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce"
			style={{ animationDelay: delay }}
		/>
	);
}

export default App;
