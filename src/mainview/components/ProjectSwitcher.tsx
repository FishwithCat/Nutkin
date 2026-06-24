import { useEffect, useMemo, useRef, useState } from "react";
import {
	Check,
	ChevronDown,
	GitBranch,
	LayoutGrid,
	Plus,
	Search,
} from "lucide-react";
import type { ProjectSummary } from "../types";

// The project pill + dropdown shown in the workspace top bar. Click the pill to
// search/switch projects, or jump to 新建项目 / 管理全部项目.
export function ProjectSwitcher({
	projects,
	activeId,
	onSwitch,
	onNew,
	onManage,
}: {
	projects: ProjectSummary[];
	activeId: string;
	onSwitch: (id: string) => void;
	onNew: () => void;
	onManage: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const ref = useRef<HTMLDivElement>(null);

	const active = projects.find((p) => p.id === activeId);

	useEffect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter((p) => p.name.toLowerCase().includes(q));
	}, [projects, query]);

	function pick(id: string) {
		setOpen(false);
		setQuery("");
		if (id !== activeId) onSwitch(id);
	}

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50 transition"
			>
				<GitBranch size={14} className="text-stone-400" aria-hidden="true" />
				<span className="max-w-[160px] truncate">{active?.name ?? "选择项目"}</span>
				<ChevronDown size={14} className="text-stone-400" aria-hidden="true" />
			</button>

			{open && (
				<div className="absolute left-0 top-full mt-2 w-80 rounded-xl border border-stone-200 bg-white shadow-lg z-50 overflow-hidden">
					<div className="p-2">
						<div className="flex items-center gap-2 rounded-lg bg-stone-100 px-2.5 py-2">
							<Search size={14} className="text-stone-400 shrink-0" aria-hidden="true" />
							<input
								autoFocus
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="切换项目…"
								className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none"
							/>
						</div>
					</div>

					<div className="max-h-72 overflow-y-auto px-2 pb-1">
						<p className="px-2 py-1 text-xs font-medium text-stone-400">最近</p>
						{filtered.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => pick(p.id)}
								className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
									p.id === activeId ? "bg-clay-50" : "hover:bg-stone-50"
								}`}
							>
								<div className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center text-stone-500 shrink-0">
									<GitBranch size={14} aria-hidden="true" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-stone-800">{p.name}</p>
									<p className="truncate text-xs text-stone-400">
										{p.sessionCount} 会话 · {p.repos.length} 代码库
									</p>
								</div>
								{p.id === activeId && (
									<Check size={15} className="text-clay-500 shrink-0" aria-hidden="true" />
								)}
							</button>
						))}
						{filtered.length === 0 && (
							<p className="px-2 py-3 text-center text-sm text-stone-400">无匹配项目</p>
						)}
					</div>

					<div className="border-t border-stone-100 p-1.5">
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								onNew();
							}}
							className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 transition"
						>
							<Plus size={15} className="text-clay-500" aria-hidden="true" />
							新建项目
						</button>
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								onManage();
							}}
							className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 transition"
						>
							<LayoutGrid size={15} className="text-stone-400" aria-hidden="true" />
							管理全部项目
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
