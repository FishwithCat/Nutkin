import { ArrowUp } from "lucide-react";

export function EmptyState({
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
		<div className="h-full flex flex-col items-center justify-center px-6">
			<div className="w-full max-w-xl text-center">
				<div className="mx-auto mb-6 w-12 h-12 rounded-2xl bg-stone-900 text-white flex items-center justify-center text-xl font-semibold">
					N
				</div>
				<h2 className="text-2xl font-semibold text-stone-900">开始一个新任务</h2>

				<div className="mt-7 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition-colors">
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={onKeyDown}
						rows={2}
						autoFocus
						placeholder="让 Agent 做点什么…"
						className="w-full resize-none bg-transparent outline-none text-sm text-stone-800 placeholder:text-stone-400 max-h-48"
					/>
					<div className="mt-2 flex items-center justify-end">
						<button
							type="button"
							onClick={onSend}
							disabled={busy || input.trim().length === 0}
							className="w-8 h-8 rounded-full bg-clay-500 text-white flex items-center justify-center hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
							title="发送"
						>
							<ArrowUp size={16} aria-hidden="true" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
