import { memo } from "react";
import type { ToolEvent, UIMessage } from "../types";
import { DiffView, fileDiff, type FileDiff } from "./DiffView";
import { Markdown } from "./Markdown";
import { ToolPanel } from "./ToolPanel";

// Split a turn's tool calls into ordered segments: each completed file edit
// becomes its own standalone diff card, while runs of regular calls (and any
// still-running or errored file edits) are grouped into one tool panel. Keeps
// diffs visually separate from the tool-call list while preserving chronology.
type Segment =
	| { kind: "tools"; key: string; tools: ToolEvent[] }
	| { kind: "diff"; key: string; diff: FileDiff };

function toSegments(tools: ToolEvent[]): Segment[] {
	const segments: Segment[] = [];
	for (const t of tools) {
		const diff = fileDiff(t);
		if (diff) {
			segments.push({ kind: "diff", key: t.toolCallId, diff });
		} else {
			const last = segments[segments.length - 1];
			if (last?.kind === "tools") last.tools.push(t);
			else segments.push({ kind: "tools", key: t.toolCallId, tools: [t] });
		}
	}
	return segments;
}

// Memoized so a streamed update only re-renders the message it touched. Every
// other message keeps its object identity through routeEvent, so React skips it.
export const MessageBlock = memo(function MessageBlock({
	message,
}: { message: UIMessage }) {
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

				{toSegments(message.tools).map((seg) =>
					seg.kind === "diff" ? (
						<DiffView key={seg.key} {...seg.diff} />
					) : (
						<ToolPanel key={seg.key} tools={seg.tools} />
					),
				)}

				{message.content && (
					<div className="text-sm leading-relaxed text-stone-800">
						<Markdown>{message.content}</Markdown>
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
});

function Dot({ delay = "0ms" }: { delay?: string }) {
	return (
		<span
			className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce"
			style={{ animationDelay: delay }}
		/>
	);
}
