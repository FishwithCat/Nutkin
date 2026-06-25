import { BookOpen, ListChecks, Settings } from "lucide-react";
import type { ProjectSummary } from "../types";
import { ProjectSwitcher } from "./ProjectSwitcher";

export type View = "tasks" | "knowledge";

export function TopBar({
	projects,
	activeProjectId,
	onSwitch,
	onNew,
	onManage,
	activeView,
	onViewChange,
	onOpenSettings,
}: {
	projects: ProjectSummary[];
	activeProjectId: string;
	onSwitch: (id: string) => void;
	onNew: () => void;
	onManage: () => void;
	activeView: View;
	onViewChange: (view: View) => void;
	onOpenSettings: () => void;
}) {
	return (
		<header className="flex items-center gap-3 px-5 h-14 border-b border-stone-200 bg-white shrink-0">
			<div className="w-8 h-8 rounded-lg bg-clay-500 flex items-center justify-center text-white font-bold text-sm">
				N
			</div>
			<ProjectSwitcher
				projects={projects}
				activeId={activeProjectId}
				onSwitch={onSwitch}
				onNew={onNew}
				onManage={onManage}
			/>
			<nav className="flex items-center gap-1">
				<ViewTab icon={ListChecks} label="任务" active={activeView === "tasks"} onClick={() => onViewChange("tasks")} />
				<ViewTab icon={BookOpen} label="知识库" active={activeView === "knowledge"} onClick={() => onViewChange("knowledge")} />
			</nav>
			<button
				type="button"
				onClick={onOpenSettings}
				title="系统设置"
				className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition"
			>
				<Settings size={16} aria-hidden="true" />
			</button>
		</header>
	);
}

function ViewTab({
	icon: Icon,
	label,
	active,
	onClick,
}: {
	icon: typeof ListChecks;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-sm transition-colors ${
				active
					? "bg-clay-50 text-clay-700 font-medium"
					: "text-stone-500 hover:bg-stone-100"
			}`}
		>
			<Icon size={15} aria-hidden="true" />
			{label}
		</button>
	);
}
