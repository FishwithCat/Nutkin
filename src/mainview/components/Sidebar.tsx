import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { Task } from "../types";

export function Sidebar({
	tasks,
	activeId,
	onSelect,
	onNew,
	onDelete,
}: {
	tasks: Task[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
}) {
	return (
		<aside className="w-72 shrink-0 border-r border-stone-200 bg-white flex flex-col">
			<div className="flex items-center justify-between px-5 h-16 shrink-0">
				<h2 className="text-base font-semibold text-stone-900">任务</h2>
				<button
					type="button"
					onClick={onNew}
					className="w-7 h-7 rounded-lg bg-clay-500 text-white flex items-center justify-center hover:bg-clay-600 transition-colors"
					title="新建任务"
				>
					<Plus size={16} aria-hidden="true" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-3 pt-1 pb-4 space-y-1">
				{tasks.length === 0 ? (
					<div className="px-3 py-16 flex flex-col items-center text-center">
						<div className="w-11 h-11 rounded-xl bg-stone-100 text-stone-400 flex items-center justify-center mb-3">
							<MessageSquare size={20} aria-hidden="true" />
						</div>
						<p className="text-sm font-medium text-stone-600">还没有任务</p>
						<p className="mt-1 text-xs text-stone-400 leading-relaxed">
							点击右上角 + 或从右侧输入，
							<br />
							新任务会出现在这里。
						</p>
					</div>
				) : (
					tasks.map((task) => (
						<TaskCard
							key={task.id}
							task={task}
							selected={task.id === activeId}
							onClick={() => onSelect(task.id)}
							onDelete={() => onDelete(task.id)}
						/>
					))
				)}
			</div>
		</aside>
	);
}

function TaskCard({
	task,
	selected,
	onClick,
	onDelete,
}: {
	task: Task;
	selected: boolean;
	onClick: () => void;
	onDelete: () => void;
}) {
	return (
		<div
			className={`group relative rounded-xl transition-colors ${
				selected ? "bg-clay-50 ring-1 ring-clay-200" : "hover:bg-stone-50"
			}`}
		>
			<button
				type="button"
				onClick={onClick}
				className="w-full flex items-center gap-2 text-left rounded-xl px-3 h-10 pr-9"
			>
				<span
					className={`shrink-0 w-1.5 h-1.5 rounded-full ${
						task.busy ? "bg-clay-500 animate-pulse" : "bg-stone-300"
					}`}
					title={task.busy ? "运行中" : "就绪"}
				/>
				<span
					className={`flex-1 truncate text-sm ${
						selected ? "text-stone-900 font-medium" : "text-stone-700"
					}`}
				>
					{task.title}
				</span>
			</button>
			<button
				type="button"
				onClick={onDelete}
				title="删除任务（同时移除其沙箱）"
				className="absolute top-1/2 -translate-y-1/2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-200 hover:text-red-600 transition"
			>
				<Trash2 size={14} aria-hidden="true" />
			</button>
		</div>
	);
}
