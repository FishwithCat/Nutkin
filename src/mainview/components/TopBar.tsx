import type { ProjectSummary } from "../types";
import { ProjectSwitcher } from "./ProjectSwitcher";

export function TopBar({
	projects,
	activeProjectId,
	onSwitch,
	onNew,
	onManage,
}: {
	projects: ProjectSummary[];
	activeProjectId: string;
	onSwitch: (id: string) => void;
	onNew: () => void;
	onManage: () => void;
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
		</header>
	);
}
