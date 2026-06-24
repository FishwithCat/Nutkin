import { ListChecks } from "lucide-react";
import { taskBusy } from "../taskState";
import type { Task } from "../types";

export function TaskHeader({
	task,
	canReview,
	onReview,
}: {
	task: Task;
	canReview: boolean;
	onReview: () => void;
}) {
	const count = task.messages.length;
	const busy = taskBusy(task);
	return (
		<div className="px-6 pt-6 pb-4 border-b border-stone-200 bg-stone-50 shrink-0">
			<div className="flex w-full items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-3">
						<h1 className="text-xl font-semibold text-stone-900">{task.title}</h1>
						{busy && (
							<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-clay-100 text-clay-700 text-xs font-medium">
								<span className="w-1.5 h-1.5 rounded-full bg-clay-500 animate-pulse" />
								运行中
							</span>
						)}
					</div>
					<p className="mt-1.5 text-sm text-stone-400">{count} 条消息</p>
				</div>
				<button
					type="button"
					onClick={onReview}
					disabled={busy || !canReview}
					title={canReview ? "审阅待推送的更改" : "暂无更改"}
					className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-clay-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed"
				>
					<ListChecks size={15} aria-hidden="true" />
					Review All
				</button>
			</div>
		</div>
	);
}
