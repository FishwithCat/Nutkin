import { ArrowUp, Square } from "lucide-react";

export function Composer({
	input,
	setInput,
	onKeyDown,
	onSend,
	onAbort,
	busy,
}: {
	input: string;
	setInput: (v: string) => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onSend: () => void;
	onAbort: () => void;
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
					{busy ? (
						<button
							type="button"
							onClick={onAbort}
							className="shrink-0 w-9 h-9 rounded-xl bg-clay-500 text-white flex items-center justify-center hover:bg-clay-600 transition-colors"
							title="中止"
						>
							<Square size={16} aria-hidden="true" />
						</button>
					) : (
						<button
							type="button"
							onClick={onSend}
							disabled={input.trim().length === 0}
							className="shrink-0 w-9 h-9 rounded-xl bg-clay-500 text-white flex items-center justify-center hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
							title="发送"
						>
							<ArrowUp size={18} aria-hidden="true" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
