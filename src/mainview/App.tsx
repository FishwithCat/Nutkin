import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Anchor, ChatMessage, Project, ProjectRepo } from "../shared/rpc";
import {
	abortTurn,
	deleteProject,
	deleteTask,
	getLastProject,
	loadProjects,
	loadTasks,
	saveProject,
	saveTask,
	sendUserMessage,
	setLastProject,
	subscribe,
} from "./rpc";
import type { AgentEvent } from "./rpc";
import {
	deriveTitle,
	fromPersisted,
	makeId,
	refactorPrompt,
	routeEvent,
	threadHistory,
	toPersisted,
} from "./taskState";
import type { ProjectSummary, Task, UIMessage } from "./types";
import { Composer } from "./components/Composer";
import { CreateProjectModal, buildProject } from "./components/CreateProjectModal";
import { DiscussionPanel } from "./components/DiscussionPanel";
import { EmptyState } from "./components/EmptyState";
import { MessageBlock } from "./components/MessageBlock";
import { ProjectList } from "./components/ProjectList";
import { ProjectSettings } from "./components/ProjectSettings";
import { Sidebar } from "./components/Sidebar";
import { TaskHeader } from "./components/TaskHeader";
import { TopBar } from "./components/TopBar";

function App() {
	const [projects, setProjects] = useState<ProjectSummary[]>([]);
	// The open project's id, or null while on the project-list landing page.
	const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	// The project whose settings page is open on the landing view (null = closed).
	const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
	const [tasks, setTasks] = useState<Task[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [input, setInput] = useState("");
	// The code anchor whose discussion is open in the side panel (null = closed).
	const [openAnchor, setOpenAnchor] = useState<Anchor | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const savedRef = useRef<Map<string, string>>(new Map());
	// Whether the view should keep following new content. Updated on every scroll
	// so we know — *before* the next update grows the container — if the user was
	// sitting at the bottom. Measuring after the update can't tell "user is at the
	// bottom" from "a tall chunk just arrived", which is what broke auto-follow.
	const stickRef = useRef(true);

	const activeTask = tasks.find((t) => t.id === activeId) ?? null;
	const activeProject =
		projects.find((p) => p.id === activeProjectId) ?? null;
	// `tasks` is a cross-project pool (busy tasks survive project switches); the
	// sidebar shows only the open project's tasks.
	const projectTasks = tasks.filter((t) => t.projectId === activeProjectId);

	// Open a project's workspace: load its sessions, remember it as the last
	// project, and switch the view. Seeds the save cache so freshly-loaded tasks
	// aren't re-persisted on first render.
	const openProject = useCallback((id: string) => {
		setActiveProjectId(id);
		setLastProject(id);
		setActiveId(null);
		loadTasks(id).then((stored) => {
			for (const t of stored) savedRef.current.set(t.id, JSON.stringify(t));
			const loaded = stored.map(fromPersisted);
			// Keep in-memory busy tasks alive across the switch instead of replacing
			// the whole array. A running task would otherwise be dropped, orphaning its
			// still-arriving stream events and losing the unsaved partial turn (busy
			// tasks aren't persisted). The live busy copy must WIN over any loaded DB
			// row: an in-flight turn on an already-saved task has a stale row, so we
			// drop the loaded version by id. The sidebar filters by project, so busy
			// tasks from other projects stay in the pool but hidden.
			setTasks((prev) => {
				const busy = prev.filter((t) => t.busy);
				const busyIds = new Set(busy.map((t) => t.id));
				return [...busy, ...loaded.filter((t) => !busyIds.has(t.id))];
			});
		});
	}, []);

	// Bootstrap: load every project, then reopen the last one (if it still
	// exists), otherwise land on the project list.
	useEffect(() => {
		(async () => {
			const [list, lastId] = await Promise.all([loadProjects(), getLastProject()]);
			setProjects(list);
			if (lastId && list.some((p) => p.id === lastId)) openProject(lastId);
		})();
	}, [openProject]);

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

	// Opening a conversation lands at its latest message and closes any open
	// discussion (it belonged to the previous task).
	useLayoutEffect(() => {
		stickRef.current = true;
		setOpenAnchor(null);
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
		sendMessage(input);
	}

	// Send a turn. With `anchor` it's a thread turn discussing a diff card: it
	// stays out of the main transcript and gets a snapshot-focused history so the
	// agent can `git show` the commit to look at related code. Returns whether the
	// message was actually sent (false if empty or the task is busy).
	function sendMessage(text: string, anchor?: Anchor): boolean {
		const trimmed = text.trim();
		if (!trimmed || activeTask?.busy || !activeProjectId) return false;

		// Project context handed to the agent: default sandbox image + bound repos.
		const projectCtx = activeProject
			? {
					name: activeProject.name,
					image: activeProject.image,
					repos: activeProject.repos,
				}
			: undefined;

		// A main turn pulls the view down; a thread reply renders in its card, so
		// it shouldn't yank the main transcript around.
		if (!anchor) stickRef.current = true;

		const userMsg: UIMessage = {
			id: makeId(),
			role: "user",
			content: trimmed,
			reasoning: "",
			tools: [],
			pending: false,
			anchor,
		};
		const assistantId = makeId();
		const assistantMsg: UIMessage = {
			id: assistantId,
			role: "assistant",
			content: "",
			reasoning: "",
			tools: [],
			pending: true,
			anchor,
		};

		if (!activeTask) {
			// No active task — start a new one from this message. (Thread turns
			// always have an active task, so this is the plain-message path.)
			const task: Task = {
				id: makeId(),
				title: deriveTitle(trimmed),
				projectId: activeProjectId,
				messages: [userMsg, assistantMsg],
				busy: true,
				sandboxes: [],
			};
			setTasks((prev) => [task, ...prev]);
			setActiveId(task.id);
			setInput("");
			sendUserMessage(
				assistantId,
				task.id,
				[{ role: "user", content: trimmed }],
				projectCtx,
				"build",
				[],
			);
			return true;
		}

		const history: ChatMessage[] = anchor
			? threadHistory(activeTask, anchor, trimmed)
			: // Main history = prior plain turns (anchored thread turns excluded).
				[
					...activeTask.messages
						.filter((m) => !m.anchor && m.content.trim().length > 0)
						.map((m) => ({ role: m.role, content: m.content })),
					{ role: "user", content: trimmed },
				];

		setTasks((prev) =>
			prev.map((t) =>
				t.id === activeTask.id
					? { ...t, messages: [...t.messages, userMsg, assistantMsg], busy: true }
					: t,
			),
		);
		if (!anchor) setInput("");
		// Thread turns (anchored to a diff card) are discussions: the agent gets a
		// read-only tool set so it can inspect the change but not edit from here.
		sendUserMessage(
			assistantId,
			activeTask.id,
			history,
			projectCtx,
			anchor ? "discuss" : "build",
			activeTask.sandboxes,
		);
		return true;
	}

	// Stable handlers passed to diff cards so memoized MessageBlocks don't
	// re-render every frame. The side panel only appears once a first question is
	// actually sent from the inline composer (onCreateThread); a chip just reopens
	// an existing thread (onOpenThread).
	const sendMessageRef = useRef(sendMessage);
	sendMessageRef.current = sendMessage;

	// When a discuss-agent calls the `refactor` tool, hand the work to this
	// session's main build conversation: fire a build turn (no anchor) once the
	// discussion turn finishes. Tracked per tool-call id so each call dispatches
	// exactly once; marked dispatched only on a successful send so a busy moment
	// never silently drops the hand-off.
	const dispatched = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (!activeTask || activeTask.busy) return;
		for (const m of activeTask.messages) {
			if (!m.anchor || m.pending) continue;
			const t = m.tools.find(
				(t) =>
					t.toolName === "refactor" &&
					t.output !== undefined &&
					!dispatched.current.has(t.toolCallId),
			);
			if (!t) continue;
			const instruction = String(
				(t.input as { instruction?: unknown })?.instruction ?? "",
			);
			if (sendMessageRef.current(refactorPrompt(m.anchor, instruction)))
				dispatched.current.add(t.toolCallId);
		}
	}, [activeTask]);

	const onOpenThread = useCallback((anchor: Anchor) => setOpenAnchor(anchor), []);
	const onCreateThread = useCallback((anchor: Anchor, text: string) => {
		if (sendMessageRef.current(text, anchor)) setOpenAnchor(anchor);
	}, []);

	// Messages belonging to the open anchor's thread (same card + same line range).
	const openThread = openAnchor
		? (activeTask?.messages ?? []).filter(
				(m) =>
					m.anchor?.toolCallId === openAnchor.toolCallId &&
					m.anchor.startLine === openAnchor.startLine &&
					m.anchor.endLine === openAnchor.endLine,
			)
		: [];

	// Thread turns grouped by the diff card they hang on. Recomputed only when a
	// thread message actually changes (not on every streamed main-turn token), so
	// it stays referentially stable and the MessageBlock memo keeps holding.
	const threadSig = (activeTask?.messages ?? [])
		.filter((m) => m.anchor)
		.map((m) => `${m.id}:${m.content.length}:${m.tools.length}:${m.pending}`)
		.join("|");
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const threads = useMemo(() => {
		const map: Record<string, UIMessage[]> = {};
		for (const m of activeTask?.messages ?? []) {
			if (m.anchor) (map[m.anchor.toolCallId] ??= []).push(m);
		}
		return map;
	}, [threadSig]);

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

	// Leave the workspace for the project list, refreshing each project's stats
	// (session counts / last activity may have changed while a project was open).
	function gotoProjectList() {
		setActiveProjectId(null);
		setActiveId(null);
		loadProjects().then(setProjects);
	}

	// Create a project from the modal, persist it, and open its (empty) workspace.
	function createProject(
		name: string,
		repos: ProjectRepo[],
		image: string,
	) {
		const project = buildProject(makeId(), name, repos, image);
		saveProject(project);
		setProjects((prev) => [
			{ ...project, sessionCount: 0, lastActivity: null },
			...prev,
		]);
		setShowCreate(false);
		openProject(project.id);
	}

	// Persist edits from the settings page. `...project` overwrites
	// name/image/repos/updatedAt while keeping the summary's session stats.
	function updateProject(project: Project) {
		saveProject(project);
		setProjects((prev) =>
			prev.map((p) => (p.id === project.id ? { ...p, ...project } : p)),
		);
		setSettingsProjectId(null);
	}

	function removeProject(id: string) {
		deleteProject(id); // backend deletes its sessions + sandboxes too
		setProjects((prev) => prev.filter((p) => p.id !== id));
		setSettingsProjectId(null);
		if (activeProjectId === id) gotoProjectList();
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

	// No project open → the project-list landing page (or a project's settings
	// page, an exclusive full-screen view over the list).
	if (!activeProjectId) {
		const settingsProject = settingsProjectId
			? projects.find((p) => p.id === settingsProjectId)
			: null;
		if (settingsProject) {
			return (
				<ProjectSettings
					project={settingsProject}
					onClose={() => setSettingsProjectId(null)}
					onSave={updateProject}
					onDelete={removeProject}
				/>
			);
		}
		return (
			<>
				<ProjectList
					projects={projects}
					onOpen={openProject}
					onNew={() => setShowCreate(true)}
					onSettings={setSettingsProjectId}
				/>
				{showCreate && (
					<CreateProjectModal
						onClose={() => setShowCreate(false)}
						onCreate={createProject}
					/>
				)}
			</>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-stone-50 text-stone-800">
			<TopBar
				projects={projects}
				activeProjectId={activeProjectId}
				onSwitch={openProject}
				onNew={() => setShowCreate(true)}
				onManage={gotoProjectList}
			/>

			<div className="flex-1 flex min-h-0">
				<Sidebar
					tasks={projectTasks}
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
								activeTask.messages
									.filter((m) => !m.anchor)
									.map((m) => (
										<MessageBlock
											key={m.id}
											message={m}
											threads={threads}
											onOpenThread={onOpenThread}
											onCreateThread={onCreateThread}
											openAnchor={openAnchor}
										/>
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

				{openAnchor && activeTask && (
					<DiscussionPanel
						anchor={openAnchor}
						thread={openThread}
						busy={activeTask.busy}
						onSend={(text) => sendMessage(text, openAnchor)}
						onClose={() => setOpenAnchor(null)}
					/>
				)}
			</div>

			{showCreate && (
				<CreateProjectModal
					onClose={() => setShowCreate(false)}
					onCreate={createProject}
				/>
			)}
		</div>
	);
}

export default App;
