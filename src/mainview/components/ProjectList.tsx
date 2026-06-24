import { useMemo, useState } from "react";
import { GitBranch, Plus, Search, Settings } from "lucide-react";
import type { ProjectSummary } from "../types";
import { relativeTime } from "../projectUtils";

// The landing page shown when no project is open: every project as a card, a
// search box, and an entry point to create one. Selecting a card opens its
// workspace.
export function ProjectList({
	projects,
	busyProjectIds,
	onOpen,
	onNew,
	onSettings,
}: {
	projects: ProjectSummary[];
	busyProjectIds: Set<string>;
	onOpen: (id: string) => void;
	onNew: () => void;
	onSettings: (id: string) => void;
}) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter(
			(p) =>
				p.name.toLowerCase().includes(q) ||
				p.repos.some((r) => r.name.toLowerCase().includes(q)),
		);
	}, [projects, query]);

	const recent = projects.find((p) => p.lastActivity != null);

	return (
		<div className="flex flex-col h-screen bg-stone-100 text-stone-800">
			<header className="flex items-center gap-3 px-6 h-16 bg-white border-b border-stone-200 shrink-0">
				<div className="w-8 h-8 rounded-lg bg-clay-500 flex items-center justify-center text-white font-bold text-sm">
					N
				</div>
				<span className="font-semibold text-stone-900">Nutkin</span>
			</header>

			<div className="flex-1 overflow-y-auto">
				<div className="max-w-6xl mx-auto px-8 py-10">
					<div className="flex items-end justify-between gap-4 flex-wrap">
						<div>
							<h1 className="text-3xl font-bold text-stone-900">项目</h1>
							<p className="mt-1.5 text-sm text-stone-400">
								{projects.length} 个项目
								{recent ? <> · 你最近在 <b className="text-stone-500 font-medium">{recent.name}</b> 工作</> : null}
							</p>
						</div>
						<div className="flex items-center gap-3">
							<div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 w-72 max-w-[60vw] focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition">
								<Search size={15} className="text-stone-400 shrink-0" aria-hidden="true" />
								<input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="搜索项目或代码库…"
									className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none"
								/>
							</div>
						</div>
					</div>

					<div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
						{filtered.map((project) => (
							<ProjectCard
								key={project.id}
								project={project}
								busy={busyProjectIds.has(project.id)}
								onOpen={() => onOpen(project.id)}
								onSettings={() => onSettings(project.id)}
							/>
						))}
						<button
							type="button"
							onClick={onNew}
							className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 bg-transparent py-6 text-stone-400 hover:border-clay-300 hover:text-clay-500 transition"
						>
							<div className="w-10 h-10 rounded-full bg-white border border-stone-200 flex items-center justify-center">
								<Plus size={18} aria-hidden="true" />
							</div>
							<span className="text-sm font-medium text-stone-600">新建项目</span>
						</button>
					</div>

					{filtered.length === 0 && projects.length > 0 && (
						<p className="mt-8 text-center text-sm text-stone-400">
							没有匹配「{query}」的项目
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

function ProjectCard({
	project,
	busy,
	onOpen,
	onSettings,
}: {
	project: ProjectSummary;
	busy: boolean;
	onOpen: () => void;
	onSettings: () => void;
}) {
	const primary = project.repos[0];
	return (
		<div className="group relative rounded-2xl border border-stone-200 bg-white p-5 hover:border-clay-300 hover:shadow-sm transition cursor-pointer">
			{/* Full-card click target sits behind the content; the content layer is
			    click-through (pointer-events-none) so the entire card — padding
			    included — opens the project. The settings button rides above both. */}
			<button
				type="button"
				onClick={onOpen}
				aria-label={`打开项目 ${project.name}`}
				className="absolute inset-0 z-0 rounded-2xl"
			/>
			<button
				type="button"
				onClick={onSettings}
				title="项目设置"
				className="absolute top-3 right-3 z-20 w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-700 transition"
			>
				<Settings size={14} aria-hidden="true" />
			</button>
			<div className="relative z-10 pointer-events-none">
				<div className="flex items-center gap-3">
					<div
						className={`w-10 h-10 rounded-xl flex items-center justify-center ${
							busy ? "bg-clay-100 text-clay-600" : "bg-stone-100 text-stone-500"
						}`}
					>
						<GitBranch size={18} aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<h3 className="font-semibold text-stone-900 truncate">{project.name}</h3>
						<p className="text-xs text-stone-400 font-mono truncate">
							{primary ? primary.name : "未绑定代码库"}
						</p>
					</div>
				</div>

				<div className="mt-4 flex items-center gap-5">
					<Stat value={project.sessionCount} label="会话" />
					<Stat value={project.repos.length} label="代码库" />
					{busy ? (
						<span className="ml-auto self-end text-xs text-clay-600 inline-flex items-center gap-1.5">
							<span className="w-1.5 h-1.5 rounded-full bg-clay-500 animate-pulse" />
							运行中
						</span>
					) : (
						<span className="ml-auto self-end text-xs text-stone-400">
							<span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-300 mr-1.5 align-middle" />
							{relativeTime(project.lastActivity)}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function Stat({ value, label }: { value: number; label: string }) {
	return (
		<div className="flex items-baseline gap-1.5">
			<span className="text-lg font-semibold text-stone-900">{value}</span>
			<span className="text-xs text-stone-400">{label}</span>
		</div>
	);
}
