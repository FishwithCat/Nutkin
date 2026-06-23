import { useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { Anchor, UIMessage } from "../types";
import { anchorDomId, ThreadMessage } from "./DiffView";

// Docked right-hand panel that hosts the multi-turn discussion for one code
// anchor. The diff itself only carries a slim inline chip; the conversation lives
// here so the code stays continuous. Sending reuses the normal agent pipeline via
// `onSend` (the parent calls sendMessage with this anchor).
export function DiscussionPanel({
	anchor,
	thread,
	busy,
	onSend,
	onClose,
}: {
	anchor: Anchor;
	thread: UIMessage[];
	busy: boolean;
	onSend: (text: string) => void;
	onClose: () => void;
}) {
	const [draft, setDraft] = useState("");
	const pending = busy || thread.some((m) => m.pending);
	const file = anchor.path.split("/").pop() ?? anchor.path;
	const lines =
		anchor.endLine !== anchor.startLine ? `${anchor.startLine}-${anchor.endLine}` : `${anchor.startLine}`;

	function submit() {
		const text = draft.trim();
		if (!text || pending) return;
		onSend(text);
		setDraft("");
	}

	function viewCode() {
		// Scroll to the exact anchored lines (the inline chip), falling back to the
		// card — centering the whole card can leave the lines outside the viewport.
		const target =
			document.getElementById(anchorDomId(anchor.toolCallId, anchor.startLine, anchor.endLine)) ??
			document.getElementById(`card-${anchor.toolCallId}`);
		target?.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	return (
		<aside className="flex w-[380px] shrink-0 flex-col border-l border-stone-200 bg-white">
			<div className="flex items-center gap-2.5 border-b border-stone-100 px-4 py-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-clay-500 text-sm font-bold text-white">
					N
				</div>
				<div className="min-w-0">
					<div className="flex items-center gap-1.5 text-sm font-semibold text-stone-800">
						Agent 讨论
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="ml-auto shrink-0 text-stone-400 hover:text-stone-600"
					aria-label="关闭讨论"
				>
					<X size={16} />
				</button>
			</div>

			{/* Anchored code snippet */}
			<div className="border-b border-stone-100 px-4 py-3">
				<div className="mb-1.5 flex items-center justify-between">
					<span className="font-mono text-xs font-medium text-stone-600">
						{file}:{lines}
					</span>
					<button
						type="button"
						onClick={viewCode}
						className="inline-flex items-center gap-0.5 text-xs text-clay-600 hover:text-clay-700"
					>
						查看代码
						<ArrowUpRight size={12} aria-hidden="true" />
					</button>
				</div>
			</div>

			{/* Conversation */}
			<div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
				{thread.length === 0 ? (
					<div className="text-xs text-stone-400">问问这段代码——它为什么这么写、有没有更稳的方案…</div>
				) : (
					thread.map((m) => <ThreadMessage key={m.id} message={m} />)
				)}
			</div>

			{/* Composer */}
			<div className="border-t border-stone-100 p-3">
				<div className="flex gap-2">
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing || e.keyCode === 229) return;
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit();
							}
						}}
						rows={1}
						placeholder="继续讨论…"
						className="flex-1 resize-none rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-clay-400"
					/>
					<button
						type="button"
						onClick={submit}
						disabled={!draft.trim() || pending}
						className="shrink-0 self-end rounded-lg bg-clay-500 px-3 py-1.5 text-sm text-white disabled:opacity-40"
					>
						发送
					</button>
				</div>
			</div>
		</aside>
	);
}
