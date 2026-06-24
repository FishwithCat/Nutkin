import { useState } from "react";
import { ArrowLeft, GitBranch, Link2, Trash2, X } from "lucide-react";
import type { Project, ProjectRepo } from "../types";
import { IMAGE_PRESETS, makeRepo, repoHostPath } from "../projectUtils";
import { Selector } from "./Selector";

// 项目设置: a full-screen page to edit an existing project's name, default
// sandbox image (preset dropdown or a custom value), and bound repos. The
// danger zone at the bottom holds the (confirmed) delete action that used to
// live on the project card.
export function ProjectSettings({
	project,
	onClose,
	onSave,
	onDelete,
}: {
	project: Project;
	onClose: () => void;
	onSave: (project: Project) => void;
	onDelete: (id: string) => void;
}) {
	const [name, setName] = useState(project.name);
	const [url, setUrl] = useState("");
	const [repos, setRepos] = useState<ProjectRepo[]>(project.repos);
	// If the project's image isn't a known preset, start in "custom" mode with
	// the current value prefilled.
	const presetMatch = IMAGE_PRESETS.includes(project.image);
	const [custom, setCustom] = useState(!presetMatch);
	const [image, setImage] = useState(project.image);
	const [confirmDelete, setConfirmDelete] = useState(false);

	function addRepo() {
		const trimmed = url.trim();
		if (!trimmed) return;
		if (repos.some((r) => r.url === trimmed)) {
			setUrl("");
			return;
		}
		setRepos((prev) => [...prev, makeRepo(trimmed)]);
		setUrl("");
	}

	function setBranch(i: number, branch: string) {
		setRepos((prev) => prev.map((r, j) => (j === i ? { ...r, branch } : r)));
	}

	function removeRepo(i: number) {
		setRepos((prev) => prev.filter((_, j) => j !== i));
	}

	// Switching the dropdown: a real preset selects it; the sentinel flips to a
	// free-text field (cleared so the user types fresh).
	function onSelectImage(value: string) {
		if (value === "__custom__") {
			setCustom(true);
			setImage("");
		} else {
			setCustom(false);
			setImage(value);
		}
	}

	const canSave = repos.length > 0;

	function submit() {
		if (!canSave) return;
		const projectName = name.trim() || repos[0].name;
		// Keep id + createdAt; bump updatedAt. (Not buildProject — that resets it.)
		onSave({
			...project,
			name: projectName,
			image: image.trim() || "alpine",
			repos,
			updatedAt: Date.now(),
		});
	}

	return (
		<div className="flex flex-col h-screen bg-stone-100 text-stone-800">
			<header className="flex items-center gap-3 px-6 h-16 bg-white border-b border-stone-200 shrink-0">
				<button
					type="button"
					onClick={onClose}
					className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition"
				>
					<ArrowLeft size={16} aria-hidden="true" />
					返回
				</button>
				<span className="font-semibold text-stone-900">项目设置</span>
			</header>

			<div className="flex-1 overflow-y-auto">
				<div className="max-w-2xl mx-auto px-8 py-10 space-y-6">
					<div>
						<label className="block text-sm font-medium text-stone-700 mb-1.5">
							项目名称
						</label>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="payments-api"
							className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-stone-700 mb-1.5">
							默认镜像
						</label>
						<p className="-mt-1 mb-2 text-xs text-stone-400">
							新建沙箱时默认使用的镜像
						</p>
						<Selector
							aria-label="默认镜像"
							value={custom ? "__custom__" : image}
							onChange={onSelectImage}
							options={[
								...IMAGE_PRESETS.map((preset) => ({
									value: preset,
									label: preset,
								})),
								{ value: "__custom__", label: "自定义…" },
							]}
						/>
						{custom && (
							<input
								value={image}
								onChange={(e) => setImage(e.target.value)}
								placeholder="例如 node:20"
								className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
							/>
						)}
					</div>

					<div>
						<div className="flex items-center justify-between mb-1.5">
							<label className="text-sm font-medium text-stone-700">代码库</label>
							<span className="text-xs text-stone-400">粘贴 Git URL 添加，可多个</span>
						</div>

						<div className="flex gap-2">
							<div className="flex-1 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition">
								<Link2 size={15} className="text-stone-400 shrink-0" aria-hidden="true" />
								<input
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											addRepo();
										}
									}}
									placeholder="https://github.com/org/repo.git"
									className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none"
								/>
							</div>
							<button
								type="button"
								onClick={addRepo}
								className="shrink-0 rounded-xl bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800 transition"
							>
								添加
							</button>
						</div>

						{repos.length > 0 && (
							<div className="mt-3 space-y-2">
								{repos.map((repo, i) => (
									<div
										key={repo.url}
										className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5"
									>
										<GitBranch size={16} className="text-stone-400 shrink-0" aria-hidden="true" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium text-stone-800">
												{repo.name}
											</p>
											<p className="truncate text-xs text-stone-400">
												{repoHostPath(repo.url)}
											</p>
										</div>
										<div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1">
											<GitBranch size={12} className="text-stone-400" aria-hidden="true" />
											<input
												value={repo.branch}
												onChange={(e) => setBranch(i, e.target.value)}
												className="w-20 bg-transparent text-xs text-stone-700 outline-none"
											/>
										</div>
										<button
											type="button"
											onClick={() => removeRepo(i)}
											className="w-6 h-6 rounded-md flex items-center justify-center text-stone-400 hover:bg-stone-200 hover:text-red-600 transition"
											title="移除"
										>
											<X size={14} aria-hidden="true" />
										</button>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
						<h3 className="text-sm font-semibold text-red-700">危险区域</h3>
						<p className="mt-1 text-xs text-stone-500">
							删除项目会同时移除其所有会话与沙箱，此操作不可撤销。
						</p>
						{confirmDelete ? (
							<div className="mt-3 flex items-center gap-2">
								<button
									type="button"
									onClick={() => onDelete(project.id)}
									className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition"
								>
									确认删除
								</button>
								<button
									type="button"
									onClick={() => setConfirmDelete(false)}
									className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 transition"
								>
									取消
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setConfirmDelete(true)}
								className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-600 hover:text-white transition"
							>
								<Trash2 size={14} aria-hidden="true" />
								删除项目
							</button>
						)}
					</div>
				</div>
			</div>

			<div className="flex items-center justify-end gap-2 px-8 py-4 bg-white border-t border-stone-200 shrink-0">
				<button
					type="button"
					onClick={onClose}
					className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition"
				>
					取消
				</button>
				<button
					type="button"
					onClick={submit}
					disabled={!canSave}
					className="rounded-xl bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
				>
					保存
				</button>
			</div>
		</div>
	);
}
