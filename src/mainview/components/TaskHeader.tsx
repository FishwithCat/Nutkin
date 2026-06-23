import type { Task } from "../types";

export function TaskHeader({ task }: { task: Task }) {
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
