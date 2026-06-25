import { memo, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import type { Anchor, ReasoningPart, ToolEvent, UIMessage } from "../types";
import { DiffView, fileDiff, type FileDiff } from "./DiffView";
import { Markdown } from "./Markdown";
import { ToolPanel } from "./ToolPanel";

// Split a turn into ordered segments that follow the real stream order: thinking
// blocks, text the model spoke, runs of regular tool calls (grouped into one
// collapsed panel), and each completed file edit as its own diff card. Reasoning
// blocks and tool calls both carry `textOffset` — how much text had streamed when
// they fired — so text is sliced and everything interleaves at the right spots.
// Empty slice between two tool calls ⇒ they stay in one group.
type Segment =
	| { kind: "text"; key: string; text: string }
	| { kind: "tools"; key: string; tools: ToolEvent[] }
	| { kind: "diff"; key: string; diff: FileDiff }
	| { kind: "reasoning"; key: string; text: string };

export function toSegments(
	tools: ToolEvent[],
	reasoning: ReasoningPart[],
	content: string,
): Segment[] {
	const segments: Segment[] = [];
	let cursor = 0;
	const flushText = (upTo: number) => {
		const text = content.slice(cursor, upTo);
		if (text) segments.push({ kind: "text", key: `text-${cursor}`, text });
		cursor = Math.max(cursor, upTo);
	};
	// Merge thinking blocks and tool calls onto one timeline by offset; at the same
	// offset a thinking block streams before the tool it precedes (reasonFirst).
	type Marker =
		| { at: number; reasonFirst: true; part: ReasoningPart; i: number }
		| { at: number; reasonFirst: false; tool: ToolEvent };
	const markers: Marker[] = [
		...reasoning.map(
			(part, i): Marker => ({ at: part.textOffset, reasonFirst: true, part, i }),
		),
		...tools.map(
			(tool): Marker => ({ at: tool.textOffset ?? 0, reasonFirst: false, tool }),
		),
	].sort((a, b) => a.at - b.at || Number(b.reasonFirst) - Number(a.reasonFirst));

	for (const mk of markers) {
		flushText(mk.at);
		if (mk.reasonFirst) {
			segments.push({ kind: "reasoning", key: `reason-${mk.i}`, text: mk.part.text });
		} else {
			const diff = fileDiff(mk.tool);
			if (diff) {
				segments.push({ kind: "diff", key: mk.tool.toolCallId, diff });
			} else {
				const last = segments[segments.length - 1];
				if (last?.kind === "tools") last.tools.push(mk.tool);
				else segments.push({ kind: "tools", key: mk.tool.toolCallId, tools: [mk.tool] });
			}
		}
	}
	flushText(content.length);
	return segments;
}

// Memoized so a streamed update only re-renders the message it touched. Every
// other message keeps its object identity through routeEvent, so React skips it.
export const MessageBlock = memo(function MessageBlock({
	message,
	threads,
	onOpenThread,
	onCreateThread,
	openAnchor,
}: {
	message: UIMessage;
	// Thread turns grouped by the toolCallId of the diff card they hang on.
	threads: Record<string, UIMessage[]>;
	onOpenThread: (anchor: Anchor) => void;
	onCreateThread: (anchor: Anchor, text: string) => void;
	openAnchor: Anchor | null;
}) {
	const isUser = message.role === "user";

	if (isUser) {
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] rounded-2xl rounded-br-sm bg-clay-500 text-white px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
					{message.content}
				</div>
			</div>
		);
	}

	const segments = toSegments(message.tools, message.reasoning, message.content);
	// The trailing thinking block animates while the turn is still streaming and
	// nothing has come after it yet.
	const lastReasoningKey =
		message.pending && segments[segments.length - 1]?.kind === "reasoning"
			? segments[segments.length - 1].key
			: null;

	return (
		<div className="min-w-0 space-y-3">
				{segments.map((seg) =>
					seg.kind === "reasoning" ? (
						<ReasoningPanel
							key={seg.key}
							text={seg.text}
							live={seg.key === lastReasoningKey}
						/>
					) : seg.kind === "diff" ? (
						<DiffView
							key={seg.key}
							{...seg.diff}
							toolCallId={seg.key}
							commit={message.commits?.find((c) => c.path === seg.diff.path)}
							thread={threads[seg.key] ?? []}
							onOpenThread={onOpenThread}
							onCreateThread={onCreateThread}
							openAnchor={openAnchor}
						/>
					) : seg.kind === "tools" ? (
						<ToolPanel key={seg.key} tools={seg.tools} />
					) : (
						<div key={seg.key} className="text-sm leading-relaxed text-stone-800">
							<Markdown>{seg.text}</Markdown>
						</div>
					),
				)}

			{message.error && (
				<div className="flex items-start gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
					<WarningIcon />
					<span>{message.error}</span>
				</div>
			)}
		</div>
	);
});

// A thinking block styled like ToolPanel: a bordered card whose header toggles
// the reasoning text. While the turn is still streaming into this block (`live`)
// the title pulses and a dot blinks, matching the tool panel's "运行中" feel.
export function ReasoningPanel({ text, live }: { text: string; live: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50 transition-colors"
			>
				<Brain size={14} className={`shrink-0 transition-colors duration-700 ${live ? "text-clay-500" : "text-stone-400"}`} aria-hidden="true" />
				<span className={`min-w-0 flex-1 truncate text-xs text-stone-400`}>
					{text}
				</span>
				<ChevronRight
					size={14}
					className={`ml-auto shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
					aria-hidden="true"
				/>
			</button>
			{open && (
				<pre className="whitespace-pre-wrap border-t border-stone-100 px-4 py-3 text-xs leading-relaxed text-stone-500">
					{text}
				</pre>
			)}
		</div>
	);
}

function WarningIcon() {
	return (
		<svg
			className="w-4 h-4 shrink-0 mt-0.5"
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
	);
}
