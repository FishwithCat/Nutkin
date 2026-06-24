import { useState } from "react";
import { GitBranch, Link2, X } from "lucide-react";
import type { Project, ProjectRepo } from "../types";
import { IMAGE_PRESETS, makeRepo, repoHostPath } from "../projectUtils";
import { Selector } from "./Selector";

// 新建项目 modal: name a project, optionally paste one or more git URLs (each
// with an editable default branch), then create. Repos are optional; a project
// with no name falls back to its first repo's display name, so creation needs
// at least a name or one repo.
export function CreateProjectModal({
	onClose,
	onCreate,
}: {
	onClose: () => void;
	onCreate: (name: string, repos: ProjectRepo[], image: string) => void;
}) {
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [repos, setRepos] = useState<ProjectRepo[]>([]);
	// alpine is the default sandbox image; the user can pick another preset or
	// type a custom one.
	const [custom, setCustom] = useState(false);
	const [image, setImage] = useState("alpine");

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

	// repos are optional; we just need *something* to name the project by.
	const canCreate = name.trim().length > 0 || repos.length > 0;

	function submit() {
		if (!canCreate) return;
		const projectName = name.trim() || repos[0].name;
		onCreate(projectName, repos, image.trim() || "alpine");
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-lg rounded-2xl bg-white shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between px-6 pt-5 pb-4">
					<h2 className="text-lg font-semibold text-stone-900">新建项目</h2>
					<button
						type="button"
						onClick={onClose}
						className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition"
						title="关闭"
					>
						<X size={18} aria-hidden="true" />
					</button>
				</div>

				<div className="px-6 pb-2 space-y-5">
					<div>
						<label className="block text-sm font-medium text-stone-700 mb-1.5">
							项目名称
						</label>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="payments-api"
							className="w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
						/>
					</div>

					<div>
						<div className="flex items-center justify-between mb-1.5">
							<label className="text-sm font-medium text-stone-700">
								代码库{" "}
								<span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-500">
									可选
								</span>
							</label>
							<span className="text-xs text-stone-400">粘贴 Git URL 添加，可多个</span>
						</div>

						<div className="flex gap-2">
							<div className="flex-1 flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition">
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
										className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5"
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
										<div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1">
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

					<div>
						<label className="block text-sm font-medium text-stone-700 mb-1.5">
							默认镜像
						</label>
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
								className="mt-2 w-full rounded-xl border border-stone-200 px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
							/>
						)}
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 px-6 py-4">
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
						disabled={!canCreate}
						className="rounded-xl bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
					>
						创建项目
					</button>
				</div>
			</div>
		</div>
	);
}

// Build a fresh Project from the modal's inputs (id + timestamps assigned here).
export function buildProject(
	id: string,
	name: string,
	repos: ProjectRepo[],
	image: string,
): Project {
	const now = Date.now();
	return { id, name, repos, image, createdAt: now, updatedAt: now };
}
