import { memo, useState } from "react";
import { diffLines } from "diff";
import { FilePen, UnfoldVertical } from "lucide-react";
import type { ToolEvent } from "../types";

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

const ROW_STYLE: Record<Row["kind"], string> = {
	add: "bg-emerald-50 text-emerald-700",
	del: "bg-rose-50 text-rose-700",
	ctx: "text-stone-600",
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
function fold(rows: Row[]): Item[] {
	const show = new Array(rows.length).fill(false);
	rows.forEach((r, i) => {
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

function DiffRow({ row }: { row: Row }) {
	return (
		<div className={`flex ${ROW_STYLE[row.kind]}`}>
			<span className="shrink-0 select-none px-2 text-right text-stone-300 w-10 tabular-nums">
				{row.oldNo ?? ""}
			</span>
			<span className="shrink-0 select-none px-2 text-right text-stone-300 w-10 tabular-nums">
				{row.newNo ?? ""}
			</span>
			<span className="shrink-0 select-none pl-1 pr-2 text-stone-400">{SIGN[row.kind]}</span>
			<span className="whitespace-pre pr-4">{row.text || " "}</span>
		</div>
	);
}

// A standalone unified-diff card for one file change. White-themed and rendered
// on its own, kept visually distinct from the grouped tool-call panel.
// Additions are green, deletions red, with a line-number gutter.
export const DiffView = memo(function DiffView({
	path,
	oldText,
	newText,
	created,
	truncated,
}: FileDiff) {
	const rows = toRows(oldText, newText);
	const adds = rows.filter((r) => r.kind === "add").length;
	const dels = rows.filter((r) => r.kind === "del").length;
	const items = fold(rows);
	// Folds expanded by the user, keyed by their start index.
	const [expanded, setExpanded] = useState<Record<number, boolean>>({});
	return (
		<div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
				<FilePen size={15} className="shrink-0 text-stone-400" aria-hidden="true" />
				<span className="text-sm font-medium text-stone-800 truncate">{path}</span>
				{created && (
					<span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
						新建
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
							<DiffRow key={item.idx} row={item.row} />
						) : expanded[item.from] ? (
							rows
								.slice(item.from, item.to)
								.map((r, k) => <DiffRow key={item.from + k} row={r} />)
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
