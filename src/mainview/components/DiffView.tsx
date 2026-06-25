import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import { ArrowUp, ChevronRight, FilePen, MessageSquare, UnfoldVertical } from "lucide-react";
import type { Anchor, Commit, ToolEvent, UIMessage } from "../types";
import { Markdown } from "./Markdown";
import { ReasoningPanel, toSegments } from "./MessageBlock";

// The before/after payload a successful writeFile/editFile returns. Rendered as
// a standalone diff card, separate from the regular tool-call panel.
export interface FileDiff {
	path: string;
	oldText: string;
	newText: string;
	created?: boolean;
	truncated?: boolean;
}

// Narrow a tool's output to a FileDiff, or null if it isn't a finished file
// edit (wrong tool, still running, or an error result without oldText/newText).
export function fileDiff(tool: ToolEvent): FileDiff | null {
	if (tool.toolName !== "writeFile" && tool.toolName !== "editFile") return null;
	const out = tool.output;
	if (typeof out !== "object" || out === null) return null;
	const o = out as Record<string, unknown>;
	if (typeof o.oldText !== "string" || typeof o.newText !== "string" || typeof o.path !== "string") {
		return null; // error result (e.g. file missing) — handled by the tool panel
	}
	return {
		path: o.path,
		oldText: o.oldText,
		newText: o.newText,
		created: o.created === true,
		truncated: o.truncated === true,
	};
}

// One rendered diff line: its kind and the two line numbers (null where the
// line doesn't exist on that side).
interface Row {
	kind: "add" | "del" | "ctx";
	text: string;
	oldNo: number | null;
	newNo: number | null;
}

// Expand jsdiff's line hunks into per-line rows, tracking old/new line numbers
// so the unified view can show a gutter like a real diff.
function toRows(oldText: string, newText: string): Row[] {
	const rows: Row[] = [];
	let oldNo = 1;
	let newNo = 1;
	for (const part of diffLines(oldText, newText)) {
		// jsdiff keeps the trailing newline on `value`; split and drop the empty
		// last element so a final newline doesn't render as a blank row.
		const lines = part.value.split("\n");
		if (lines[lines.length - 1] === "") lines.pop();
		for (const text of lines) {
			if (part.added) rows.push({ kind: "add", text, oldNo: null, newNo: newNo++ });
			else if (part.removed) rows.push({ kind: "del", text, oldNo: oldNo++, newNo: null });
			else rows.push({ kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
		}
	}
	return rows;
}

// Text colour, base background, and the faint whole-row hover tint kept separate
// so a selected row can swap its background without losing the add/del colour.
const TEXT_STYLE: Record<Row["kind"], string> = {
	add: "text-emerald-700",
	del: "text-rose-700",
	ctx: "text-stone-600",
};
const BG_STYLE: Record<Row["kind"], string> = {
	add: "bg-emerald-50",
	del: "bg-rose-50",
	ctx: "",
};
const SIGN: Record<Row["kind"], string> = { add: "+", del: "-", ctx: " " };

// Lines of unchanged context kept around each change. Longer unchanged runs are
// folded into a single expandable separator, like GitHub's diff view.
const CONTEXT = 3;
// Don't bother folding a run this short — the separator would save no space.
const MIN_FOLD = 4;

// A folded run of unchanged rows [from, to).
interface Fold {
	kind: "fold";
	from: number;
	to: number;
}
type Item = { kind: "row"; row: Row; idx: number } | Fold;

// Walk the rows and fold long unchanged stretches. A row is shown when it is a
// change or within CONTEXT lines of one; the gaps between become Fold markers.
// `forced` row indices (annotated or selected lines) are never folded, so their
// inline comment box always has a visible line to hang under.
function fold(rows: Row[], forced?: Set<number>): Item[] {
	const show = new Array(rows.length).fill(false);
	rows.forEach((r, i) => {
		if (forced?.has(i)) show[i] = true;
		if (r.kind === "ctx") return;
		for (let j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) {
			show[j] = true;
		}
	});
	const items: Item[] = [];
	for (let i = 0; i < rows.length; ) {
		if (show[i]) {
			items.push({ kind: "row", row: rows[i], idx: i });
			i++;
			continue;
		}
		let j = i;
		while (j < rows.length && !show[j]) j++;
		// A gap shorter than MIN_FOLD isn't worth a separator — show it inline.
		if (j - i < MIN_FOLD) {
			for (let k = i; k < j; k++) items.push({ kind: "row", row: rows[k], idx: k });
		} else {
			items.push({ kind: "fold", from: i, to: j });
		}
		i = j;
	}
	return items;
}

// Memoized so a selection change only re-renders the rows whose `selected` flag
// actually flips. Its callbacks are passed stable from DiffView and it carries
// its own line number, so memo isn't broken by per-row closures.
const DiffRow = memo(function DiffRow({
	row,
	selected,
	annotated,
	selectable,
	onGutterDown,
	onGutterEnter,
}: {
	row: Row;
	selected?: boolean;
	annotated?: boolean;
	// Whether this card supports anchoring (committed + has a create handler).
	selectable?: boolean;
	// Selecting lines happens on the line-number gutter only: mousedown starts
	// (shift to extend from the last line), enter extends the drag. The code area
	// is left alone so its text stays selectable / copyable.
	onGutterDown?: (newNo: number, shift: boolean) => void;
	onGutterEnter?: (newNo: number) => void;
}) {
	const handle = !!selectable && row.newNo != null;
	// Selection / annotation shown as a slim left side-bar; selection also gets a
	// faint clay wash (kept out of add/del backgrounds via the split styles).
	const bar = selected ? "border-clay-500" : annotated ? "border-clay-300" : "border-transparent";
	const bg = selected ? "bg-clay-50" : BG_STYLE[row.kind];
	return (
		<div className={`flex border-l-2 ${bar} ${TEXT_STYLE[row.kind]} ${bg}`}>
			<span className="shrink-0 select-none px-2 text-right text-stone-300 w-10 tabular-nums">
				{row.oldNo ?? ""}
			</span>
			<span
				onMouseDown={
					handle
						? (e) => {
								e.preventDefault(); // gutter drag must not start a text selection
								onGutterDown?.(row.newNo!, e.shiftKey);
							}
						: undefined
				}
				onMouseEnter={handle ? () => onGutterEnter?.(row.newNo!) : undefined}
				className={`shrink-0 select-none px-2 text-right tabular-nums w-10 text-stone-300 ${
					handle ? "cursor-pointer hover:bg-clay-100 hover:text-clay-600" : ""
				}`}
				title={handle ? "拖动行号多选，或 shift 点击" : undefined}
			>
				{row.newNo ?? ""}
			</span>
			<span className="shrink-0 select-none pl-1 pr-2 text-stone-400">{SIGN[row.kind]}</span>
			<span className="whitespace-pre pr-4">{row.text || " "}</span>
		</div>
	);
});

// A sub-thread: all the discussion turns on one line range of a diff card.
interface ThreadGroup {
	startLine: number;
	endLine: number;
	messages: UIMessage[];
}

// DOM id of a thread's inline anchor chip, so the side panel's "查看代码" can
// scroll to the exact lines (centering the whole card can leave them off-screen).
export const anchorDomId = (toolCallId: string, startLine: number, endLine: number) =>
	`anchor-${toolCallId}-${startLine}-${endLine}`;

type DiffViewProps = FileDiff & {
	toolCallId?: string;
	// The commit this file landed in; needed to discuss it. Absent => read-only.
	commit?: Commit;
	// Thread turns hanging on this card (empty for nested/read-only cards).
	thread?: UIMessage[];
	// Reopen the side panel for an existing thread (clicking its inline chip).
	onOpenThread?: (anchor: Anchor) => void;
	// Post the first question of a new thread (from the inline composer); the
	// parent sends it and then opens the side panel. Absent => read-only.
	onCreateThread?: (anchor: Anchor, text: string) => void;
	// The anchor currently open in the side panel, to highlight its lines here.
	openAnchor?: Anchor | null;
};

// A standalone unified-diff card for one file change. White-themed and rendered
// on its own, kept visually distinct from the grouped tool-call panel.
// Additions are green, deletions red, with a line-number gutter. When a commit
// is known, dragging over lines opens a discussion anchored to that commit; the
// conversation itself lives in the side panel, leaving the diff uninterrupted
// except for a slim inline anchor chip per thread.
export const DiffView = memo(function DiffView({
	path,
	oldText,
	newText,
	created,
	truncated,
	toolCallId,
	commit,
	thread = [],
	onOpenThread,
	onCreateThread,
	openAnchor,
}: DiffViewProps) {
	// Selection state changes on every drag step, so keep the expensive derived
	// data (the jsdiff line diff, the fold layout, the thread grouping) in memos
	// that depend only on the inputs — never on the selection — or a drag re-diffs
	// the whole file per crossed line and stutters.
	const rows = useMemo(() => toRows(oldText, newText), [oldText, newText]);
	const adds = useMemo(() => rows.filter((r) => r.kind === "add").length, [rows]);
	const dels = useMemo(() => rows.filter((r) => r.kind === "del").length, [rows]);

	// Folds expanded by the user, keyed by their start index.
	const [expanded, setExpanded] = useState<Record<number, boolean>>({});
	// Selected line range (in new-file line numbers). On release an inline composer
	// opens under it; `dragging` hides that composer until the drag ends.
	const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const [draft, setDraft] = useState("");
	const draggingRef = useRef(false);

	// Selecting to discuss is possible only once the change is committed and we
	// were given a create handler. Nested read-only cards skip all of this.
	const canSelect = !!(commit && toolCallId && onCreateThread);

	const lo = sel ? Math.min(sel.start, sel.end) : 0;
	const hi = sel ? Math.max(sel.start, sel.end) : 0;
	// Lines belonging to the anchor currently open in the side panel.
	const openHere = openAnchor && openAnchor.toolCallId === toolCallId ? openAnchor : null;

	// Group thread turns into per-range sub-threads, keyed by the range's last
	// line — PR-review style, each comment box sits right under the code it marks.
	// `annotated` lines are force-shown so their inline chip has a row to hang
	// under (a selection only spans already-visible rows, so it needs no forcing).
	const { groupsByEndLine, annotated } = useMemo(() => {
		const groupsByEndLine = new Map<number, ThreadGroup[]>();
		const annotated = new Set<number>();
		const byRange = new Map<string, ThreadGroup>();
		for (const m of thread) {
			if (!m.anchor) continue;
			for (let i = m.anchor.startLine; i <= m.anchor.endLine; i++) annotated.add(i);
			const key = `${m.anchor.startLine}-${m.anchor.endLine}`;
			let g = byRange.get(key);
			if (!g) byRange.set(key, (g = { startLine: m.anchor.startLine, endLine: m.anchor.endLine, messages: [] }));
			g.messages.push(m);
		}
		for (const g of byRange.values()) {
			const arr = groupsByEndLine.get(g.endLine) ?? [];
			arr.push(g);
			groupsByEndLine.set(g.endLine, arr);
		}
		return { groupsByEndLine, annotated };
	}, [thread]);

	const items = useMemo(() => {
		const forcedIdx = new Set<number>();
		rows.forEach((r, i) => {
			if (r.newNo != null && annotated.has(r.newNo)) forcedIdx.add(i);
		});
		return fold(rows, forcedIdx);
	}, [rows, annotated]);

	// Build an anchor for a line range (snippet frozen from the current rows).
	const anchorFor = (startLine: number, endLine: number): Anchor => ({
		toolCallId: toolCallId!,
		sandboxName: commit!.sandboxName,
		repoRoot: commit!.repoRoot,
		commitHash: commit!.commitHash,
		path,
		startLine,
		endLine,
		quotedText: rows
			.filter((r) => r.newNo != null && r.newNo >= startLine && r.newNo <= endLine)
			.map((r) => r.text)
			.join("\n"),
	});

	// True once the pointer actually moves during a press. Without it, a `mouseenter`
	// fired by *layout shift* (the inline composer appearing/moving reflows the diff
	// under a still-pressed cursor) would extend the selection on a plain click.
	const movedRef = useRef(false);
	const lastClickRef = useRef<number | null>(null);

	// Gutter mousedown: shift+click extends from the last clicked line; a plain
	// click starts a (possibly dragged) selection. Stable across renders (it only
	// touches setters/refs), so memoized DiffRows aren't re-rendered every drag step.
	const gutterDown = useCallback((n: number, shift: boolean) => {
		if (shift && lastClickRef.current != null) {
			setSel({ start: lastClickRef.current, end: n });
			return;
		}
		lastClickRef.current = n;
		draggingRef.current = true;
		movedRef.current = false;
		setDragging(true);
		setSel({ start: n, end: n });
		setDraft("");
		// Track real movement and the release. Attached synchronously here at
		// mousedown (a useEffect would attach a tick later, so a very fast click
		// could release before the listener existed and leave the drag "stuck on").
		const move = () => {
			movedRef.current = true;
		};
		const up = () => {
			draggingRef.current = false;
			setDragging(false);
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
	}, []);
	// Extend the drag, but only on a real move (see movedRef), not a reflow enter.
	const gutterEnter = useCallback((n: number) => {
		if (draggingRef.current && movedRef.current) {
			setSel((s) => ({ start: s ? s.start : n, end: n }));
		}
	}, []);
	const clearSel = useCallback(() => {
		setSel(null);
		setDraft("");
	}, []);
	// While the inline composer is open, Esc closes it (same as 取消).
	const composerOpen = canSelect && sel != null && !dragging;
	useEffect(() => {
		if (!composerOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") clearSel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [composerOpen, clearSel]);
	// First question of a new thread: post it, which opens the side panel.
	function submitInline() {
		if (!canSelect || !sel || !draft.trim()) return;
		onCreateThread!(anchorFor(lo, hi), draft.trim());
		clearSel();
	}

	// A diff line plus, under the range's last line, any inline anchor chips (whose
	// conversations live in the side panel) and — while selecting — the inline
	// composer for a new discussion.
	const renderRow = (row: Row, key: number) => {
		const inDrag = !!sel && row.newNo != null && row.newNo >= lo && row.newNo <= hi;
		const inOpen =
			!!openHere && row.newNo != null && row.newNo >= openHere.startLine && row.newNo <= openHere.endLine;
		const groups = row.newNo != null ? groupsByEndLine.get(row.newNo) : undefined;
		const showComposer = composerOpen && row.newNo === hi;
		return (
			<Fragment key={key}>
				<DiffRow
					row={row}
					selected={inDrag || inOpen}
					annotated={row.newNo != null && annotated.has(row.newNo)}
					selectable={canSelect}
					onGutterDown={gutterDown}
					onGutterEnter={gutterEnter}
				/>
				{groups?.map((g) => (
					<AnchorChip
						key={`${g.startLine}-${g.endLine}`}
						group={g}
						id={toolCallId ? anchorDomId(toolCallId, g.startLine, g.endLine) : undefined}
						active={!!openHere && openHere.startLine === g.startLine && openHere.endLine === g.endLine}
						onOpen={() => {
							clearSel();
							if (g.messages[0].anchor) onOpenThread?.(g.messages[0].anchor);
						}}
					/>
				))}
				{showComposer && (
					<div className="border-y border-clay-200 bg-stone-50 px-4 py-2.5 font-sans">
						<div className="mb-1.5 flex items-center gap-2 text-xs text-stone-500">
							<span>
								讨论第 {lo}
								{hi !== lo ? `-${hi}` : ""} 行
							</span>
							<button
								type="button"
								onClick={clearSel}
								className="ml-auto text-stone-400 hover:text-stone-600"
							>
								取消
							</button>
						</div>
						<div className="flex gap-2">
							{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
							<textarea
								autoFocus
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.nativeEvent.isComposing || e.keyCode === 229) return;
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										submitInline();
									}
								}}
								rows={1}
								placeholder="问问这段代码…"
								className="flex-1 resize-none rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clay-400"
							/>
							<button
								type="button"
								onClick={submitInline}
								disabled={!draft.trim()}
								className="shrink-0 self-end flex h-9 w-9 items-center justify-center rounded-xl bg-clay-500 text-white hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
								title="发送"
							>
								<ArrowUp size={18} aria-hidden="true" />
							</button>
						</div>
					</div>
				)}
			</Fragment>
		);
	};

	return (
		<div
			id={toolCallId ? `card-${toolCallId}` : undefined}
			className="rounded-xl border border-stone-200 bg-white overflow-hidden"
		>
			<div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
				<FilePen size={15} className="shrink-0 text-stone-400" aria-hidden="true" />
				<span className="text-sm font-medium text-stone-800 truncate">{path}</span>
				{created && (
					<span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
						新建
					</span>
				)}
				{thread.length > 0 && (
					<span className="shrink-0 inline-flex items-center gap-1 rounded bg-clay-100 px-1.5 py-0.5 text-xs text-clay-700">
						<MessageSquare size={11} aria-hidden="true" />
						{thread.filter((m) => m.role === "user").length}
					</span>
				)}
				<span className="ml-auto shrink-0 font-mono text-xs">
					<span className="text-emerald-600">+{adds}</span>{" "}
					<span className="text-rose-600">−{dels}</span>
				</span>
			</div>
			<div className="overflow-x-auto py-1 font-mono text-xs leading-relaxed">
				{rows.length === 0 ? (
					<div className="px-4 py-1 text-stone-400">无变化</div>
				) : (
					items.map((item) =>
						item.kind === "row" ? (
							renderRow(item.row, item.idx)
						) : expanded[item.from] ? (
							rows.slice(item.from, item.to).map((r, k) => renderRow(r, item.from + k))
						) : (
							<button
								key={`fold-${item.from}`}
								type="button"
								onClick={() => setExpanded((e) => ({ ...e, [item.from]: true }))}
								className="flex w-full items-center gap-2 bg-stone-50 px-4 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-colors"
							>
								<UnfoldVertical size={13} className="shrink-0" aria-hidden="true" />
								<span>展开 {item.to - item.from} 行未更改</span>
							</button>
						),
					)
				)}
			</div>
			{truncated && (
				<div className="px-4 py-1.5 border-t border-stone-100 text-xs text-stone-400">
					diff 已截断
				</div>
			)}
		</div>
	);
});

// A slim inline anchor for one line range: shows the finding (first question) and
// latest status, with an "展开讨论" affordance — the full thread is in the side
// panel, so the diff stays continuous. Highlighted while its thread is open.
function AnchorChip({
	group,
	id,
	active,
	onOpen,
}: {
	group: ThreadGroup;
	id?: string;
	active?: boolean;
	onOpen?: () => void;
}) {
	const firstQuestion = group.messages.find((m) => m.role === "user")?.content ?? "讨论";
	const replies = group.messages.filter((m) => m.role === "assistant").length;
	const pending = group.messages.some((m) => m.pending);
	return (
		<button
			type="button"
			id={id}
			onClick={onOpen}
			className={`flex w-full items-center gap-2 border-y px-4 py-1.5 font-sans text-xs text-left transition-colors ${
				active
					? "border-clay-300 bg-clay-50"
					: "border-clay-200/70 bg-clay-50/40 hover:bg-clay-50"
			}`}
		>
			<span className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded bg-clay-500 text-[10px] font-bold text-white">
				N
			</span>
			<span className="min-w-0 truncate font-medium text-stone-700">{firstQuestion}</span>
			<span className="shrink-0 text-stone-400">
				{pending ? "讨论中…" : replies > 0 ? `${replies} 条回复` : "待回复"}
			</span>
			<span className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-clay-600">
				展开讨论
				<ChevronRight size={13} aria-hidden="true" />
			</span>
		</button>
	);
}

// One turn inside a discussion thread. Reuses the diff renderer for any files the
// agent touched while answering; non-diff tool calls (e.g. the git commands it
// runs to look around) are intentionally hidden to keep it tidy. Exported for the
// side discussion panel.
export function ThreadMessage({ message }: { message: UIMessage }) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] rounded-lg rounded-br-sm bg-clay-500 px-3 py-1.5 text-xs leading-relaxed text-white whitespace-pre-wrap">
					{message.content}
				</div>
			</div>
		);
	}
	// Same stream order as the main view (toSegments), but the thread hides
	// non-diff tool calls to stay tidy.
	const segments = toSegments(message.tools, message.reasoning, message.content).filter(
		(s) => s.kind !== "tools",
	);
	const lastReasoningKey =
		message.pending && segments[segments.length - 1]?.kind === "reasoning"
			? segments[segments.length - 1].key
			: null;
	return (
		<div className="space-y-2">
			{segments.map((seg) =>
				seg.kind === "reasoning" ? (
					<ReasoningPanel key={seg.key} text={seg.text} live={seg.key === lastReasoningKey} />
				) : seg.kind === "diff" ? (
					<DiffView key={seg.key} {...seg.diff} />
				) : seg.kind === "text" ? (
					<div key={seg.key} className="text-xs leading-relaxed text-stone-800">
						<Markdown>{seg.text}</Markdown>
					</div>
				) : null,
			)}
			{message.pending && !message.content && (
				<span className="text-xs text-stone-400">…</span>
			)}
			{message.error && (
				<div className="flex items-start gap-1.5 text-xs text-rose-600">
					<svg
						className="w-3.5 h-3.5 shrink-0 mt-px"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
					<span>{message.error}</span>
				</div>
			)}
		</div>
	);
}
