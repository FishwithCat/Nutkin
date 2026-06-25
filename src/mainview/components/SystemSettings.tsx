import { useEffect, useState } from "react";
import {
	ArrowLeft,
	Boxes,
	FileText,
	Filter,
	FolderGit2,
	KeyRound,
	MoreVertical,
	Trash2,
} from "lucide-react";
import type { AppSettings, SandboxInfo } from "../../shared/rpc";
import {
	listAllSandboxes,
	loadSettings,
	removeSandbox,
	sandboxLogs,
	saveSettings,
	stopSandbox,
} from "../rpc";

// 系统设置: a full-screen, app-level (global) settings page. Scope is the whole
// instance, not a project. For now it holds one section — 模型与 API Key — where
// the DeepSeek API key and model live (moved here out of .env). The mockup's
// other sections (通用/默认运行镜像/凭据与集成/存储与限额) are not built yet.
export function SystemSettings({ onClose }: { onClose: () => void }) {
	const [section, setSection] = useState<"model" | "sandbox">("sandbox");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	// The last-saved values, so we can show/enable "放弃更改" only when dirty.
	const [saved, setSaved] = useState<AppSettings>({ deepseekApiKey: "", deepseekModel: "" });

	useEffect(() => {
		loadSettings().then((s) => {
			setSaved(s);
			setApiKey(s.deepseekApiKey);
			setModel(s.deepseekModel);
		});
	}, []);

	const dirty = apiKey !== saved.deepseekApiKey || model !== saved.deepseekModel;

	function submit() {
		const next: AppSettings = { deepseekApiKey: apiKey.trim(), deepseekModel: model.trim() };
		saveSettings(next);
		setSaved(next);
		setApiKey(next.deepseekApiKey);
		setModel(next.deepseekModel);
	}

	function revert() {
		setApiKey(saved.deepseekApiKey);
		setModel(saved.deepseekModel);
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
				<span className="font-semibold text-stone-900">系统设置</span>
			</header>

			<div className="flex-1 flex min-h-0">
				{/* Left nav. Add rows here as sections land. */}
				<nav className="w-56 shrink-0 border-r border-stone-200 bg-white px-3 py-5 space-y-1">
					<p className="px-2 mb-2 text-xs font-medium text-stone-400">系统设置</p>
					<button
						type="button"
						onClick={() => setSection("sandbox")}
						className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium ${
							section === "sandbox"
								? "bg-clay-50 text-clay-700"
								: "text-stone-600 hover:bg-stone-100"
						}`}
					>
						<Boxes size={15} aria-hidden="true" />
						沙箱管理
					</button>
					<button
						type="button"
						onClick={() => setSection("model")}
						className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium ${
							section === "model"
								? "bg-clay-50 text-clay-700"
								: "text-stone-600 hover:bg-stone-100"
						}`}
					>
						<KeyRound size={15} aria-hidden="true" />
						模型与 API Key
					</button>
				</nav>

				{section === "sandbox" ? (
					<SandboxPanel />
				) : (
				<div className="flex-1 overflow-y-auto">
					<div className="max-w-2xl mx-auto px-8 py-10 space-y-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 className="text-lg font-semibold text-stone-900">模型与 API Key</h2>
								<p className="mt-1 text-sm text-stone-500">
									DeepSeek 凭据作用于整个实例，所有项目共用。
								</p>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								<button
									type="button"
									onClick={revert}
									disabled={!dirty}
									className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
								>
									放弃更改
								</button>
								<button
									type="button"
									onClick={submit}
									disabled={!dirty}
									className="rounded-xl bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
								>
									保存
								</button>
							</div>
						</div>

						<div>
							<label className="block text-sm font-medium text-stone-700 mb-1.5">
								DeepSeek API Key
							</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="sk-…"
								autoComplete="off"
								className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
							/>
						</div>

						<div>
							<label className="block text-sm font-medium text-stone-700 mb-1.5">
								DeepSeek 模型
							</label>
							<p className="-mt-1 mb-2 text-xs text-stone-400">
								留空则使用默认 deepseek-v4-pro
							</p>
							<input
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder="如: deepseek-v4-pro"
								className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
							/>
						</div>
					</div>
				</div>
				)}
			</div>
		</div>
	);
}

const GB = 1024 ** 3;

// Human-readable helpers for the sandbox table.
const fmtMem = (used: number, limit: number) =>
	`${(used / GB).toFixed(1)}/${limit ? (limit / GB).toFixed(0) : "?"}G`;
function fmtDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m`;
	return `${s}s`;
}
function fmtAgo(ms: number): string {
	const diff = Date.now() - ms;
	const m = Math.floor(diff / 60000);
	if (m < 1) return "刚刚";
	if (m < 60) return `${m}分钟前`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}小时前`;
	return `${Math.floor(h / 24)}天前`;
}

// Status → {label, badge classes, dot}. microsandbox states: running / stopped /
// crashed / draining. "已暂停" reads better than "stopped" for a paused VM.
const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
	running: { label: "运行中", cls: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-500" },
	stopped: { label: "已暂停", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
	crashed: { label: "已崩溃", cls: "bg-red-50 text-red-600", dot: "bg-red-500" },
	draining: { label: "停止中", cls: "bg-stone-100 text-stone-500", dot: "bg-stone-300" },
};

// 沙箱管理: a table of every sandbox in the instance — task/project, image,
// status, live CPU/memory, and uptime. Pause/resume from the row, view logs or
// delete from the ⋮ menu, and pause several at once via the checkboxes.
function SandboxPanel() {
	const [rows, setRows] = useState<SandboxInfo[] | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	// Two-click guard on the bulk "删除所选" action.
	const [bulkConfirm, setBulkConfirm] = useState(false);
	// When on, show only orphan sandboxes (no owning project).
	const [onlyOrphans, setOnlyOrphans] = useState(false);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	// Which row has an armed delete confirm / an open log view — keyed by id.
	const [confirming, setConfirming] = useState<string | null>(null);
	const [logsFor, setLogsFor] = useState<string | null>(null);
	const [logText, setLogText] = useState<string>("");
	const key = (s: SandboxInfo) => `${s.sessionId}\0${s.name}`;

	useEffect(() => {
		listAllSandboxes().then(setRows, () => setRows([]));
	}, []);

	function apply(p: Promise<SandboxInfo[]>) {
		setMenuFor(null);
		p.then(setRows, () => {});
	}
	// Re-fetch in place: keep the current rows on screen and swap in the new data
	// when it lands, so refreshing doesn't blank the table (no jump/flash). The
	// "加载中…" state only shows on the first load, when rows is still null.
	function refresh() {
		listAllSandboxes().then(setRows, () => {});
	}

	function toggle(k: string) {
		setBulkConfirm(false);
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(k) ? next.delete(k) : next.add(k);
			return next;
		});
	}

	function openLogs(s: SandboxInfo) {
		setMenuFor(null);
		const k = key(s);
		if (logsFor === k) {
			setLogsFor(null);
			return;
		}
		setLogsFor(k);
		setLogText("加载中…");
		sandboxLogs(s.sessionId, s.name).then(
			(t) => setLogText(t || "（无日志）"),
			() => setLogText("（读取日志失败）"),
		);
	}

	const list = rows ?? [];
	const running = list.filter((r) => r.status === "running");
	const totalMem = list.reduce((a, r) => a + (r.memoryBytes ?? 0), 0);
	// Rows actually shown — optionally filtered to orphans (no owning project).
	const visible = onlyOrphans ? list.filter((s) => !s.projectName) : list;
	const orphanCount = list.filter((s) => !s.projectName).length;
	const allChecked = visible.length > 0 && visible.every((s) => selected.has(key(s)));

	async function deleteSelected() {
		const targets = list.filter((s) => selected.has(key(s)));
		const gone = new Set(targets.map(key));
		setBulkConfirm(false);
		setSelected(new Set());
		// Optimistically drop the deleted rows so the table updates instantly, then
		// reconcile with the server list once the removes finish.
		setRows((prev) => prev?.filter((s) => !gone.has(key(s))) ?? prev);
		await Promise.all(targets.map((s) => removeSandbox(s.sessionId, s.name)));
		refresh();
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="px-8 py-10 space-y-5">
				<div className="flex items-end justify-between gap-4">
					<div>
						<div className="flex items-baseline gap-2">
							<h2 className="text-lg font-semibold text-stone-900">沙箱</h2>
							<span className="text-xs text-stone-400">实例内全部运行环境</span>
						</div>
						{list.length > 0 && (
							<div className="mt-2 flex items-center gap-4 text-xs text-stone-500">
								<span className="inline-flex items-center gap-1.5">
									<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
									{running.length} 运行中
								</span>
								<span className="inline-flex items-center gap-1.5">
									<span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
									{list.length - running.length} 已暂停
								</span>
								<span className="text-stone-300">|</span>
								<span className="text-stone-400">
									运行内存 {(totalMem / GB).toFixed(1)} GB
								</span>
							</div>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onClick={() => {
								setBulkConfirm(false);
								setOnlyOrphans((v) => !v);
							}}
							className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
								onlyOrphans
									? "border-clay-300 bg-clay-50 text-clay-700"
									: "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
							}`}
						>
							<Filter size={14} aria-hidden="true" />
							仅看无项目{orphanCount > 0 ? ` (${orphanCount})` : ""}
						</button>
						{bulkConfirm ? (
							<button
								type="button"
								onClick={deleteSelected}
								className="rounded-xl bg-red-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-600 transition"
							>
								确认删除 {selected.size} 个？
							</button>
						) : (
							<button
								type="button"
								onClick={() => setBulkConfirm(true)}
								disabled={selected.size === 0}
								className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-red-500 hover:bg-red-50 disabled:text-stone-400 disabled:opacity-40 disabled:cursor-not-allowed transition"
							>
								删除所选{selected.size > 0 ? ` (${selected.size})` : ""}
							</button>
						)}
						<button
							type="button"
							onClick={refresh}
							className="rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition"
						>
							刷新
						</button>
					</div>
				</div>

				{rows === null ? (
					<p className="text-sm text-stone-400">加载中…</p>
				) : visible.length === 0 ? (
					<p className="text-sm text-stone-400">
						{onlyOrphans && list.length > 0 ? "没有无项目的沙箱" : "暂无沙箱"}
					</p>
				) : (
					<div className="overflow-visible rounded-xl border border-stone-200 bg-white">
						{/* Column header */}
						<div className="flex items-center gap-3 border-b border-stone-200 px-4 py-2.5 text-xs font-medium text-stone-400">
							<input
								type="checkbox"
								checked={allChecked}
								onChange={() => {
									setBulkConfirm(false);
									setSelected(allChecked ? new Set() : new Set(visible.map(key)));
								}}
								className="h-3.5 w-3.5 shrink-0 accent-clay-500"
							/>
							<span className="w-44 shrink-0">沙箱</span>
							<span className="flex-1">任务</span>
							<span className="hidden w-44 shrink-0 lg:block">项目</span>
							<span className="hidden w-44 shrink-0 lg:block">镜像</span>
							<span className="w-24 shrink-0 text-center">状态</span>
							<span className="hidden w-64 shrink-0 sm:block">资源占用</span>
							<span className="hidden w-24 shrink-0 md:block">运行时长</span>
							<span className="w-20 shrink-0 text-right">操作</span>
						</div>

						<div className="divide-y divide-stone-100">
							{visible.map((s) => {
								const k = key(s);
								const st = STATUS[s.status] ?? {
									label: s.status,
									cls: "bg-stone-100 text-stone-500",
									dot: "bg-stone-300",
								};
								const isRunning = s.status === "running";
								const memPct =
									s.memoryBytes != null && s.memoryLimitBytes
										? Math.min(100, (s.memoryBytes / s.memoryLimitBytes) * 100)
										: 0;
								return (
									<div key={k}>
										<div className="flex items-center gap-3 px-4 py-3">
											<input
												type="checkbox"
												checked={selected.has(k)}
												onChange={() => toggle(k)}
												className="h-3.5 w-3.5 shrink-0 accent-clay-500"
											/>

											{/* 沙箱 */}
											<div className="flex w-44 shrink-0 items-center gap-2.5">
												<span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
												<span className="truncate text-sm font-medium text-stone-800">
													{s.name}
												</span>
											</div>

											{/* 任务 */}
											<div className="min-w-0 flex-1 truncate text-sm text-stone-500">
												{s.sessionTitle}
											</div>

											{/* 项目 */}
											<div className="hidden w-44 shrink-0 items-center gap-1.5 text-sm text-stone-600 lg:flex">
												{s.projectName ? (
													<>
														<FolderGit2 size={13} className="shrink-0 text-stone-400" />
														<span className="truncate">{s.projectName}</span>
													</>
												) : (
													<span className="text-stone-300">—</span>
												)}
											</div>

											{/* 镜像 */}
											<div className="hidden w-44 shrink-0 truncate text-sm text-stone-500 lg:block">
												{s.image || "—"}
											</div>

											{/* 状态 */}
											<div className="flex w-24 shrink-0 justify-center">
												<span
													className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}
												>
													<span className={`h-1 w-1 rounded-full ${st.dot}`} />
													{st.label}
												</span>
											</div>

											{/* 资源占用 */}
											<div className="hidden w-64 shrink-0 sm:block">
												{isRunning && s.cpuPercent != null ? (
													<div className="space-y-1">
														<Meter
															label="CPU"
															pct={Math.min(100, s.cpuPercent)}
															value={`${Math.round(s.cpuPercent)}%`}
														/>
														<Meter
															label="MEM"
															pct={memPct}
															value={fmtMem(s.memoryBytes ?? 0, s.memoryLimitBytes ?? 0)}
														/>
													</div>
												) : (
													<span className="text-xs text-stone-300">CPU / 内存 已释放</span>
												)}
											</div>

											{/* 运行时长 */}
											<div className="hidden w-24 shrink-0 text-xs md:block">
												{isRunning ? (
													<>
														<div className="font-medium text-stone-700">
															{s.uptimeMs != null ? fmtDuration(s.uptimeMs) : "—"}
														</div>
														{s.updatedAt && (
															<div className="text-stone-400">{fmtAgo(s.updatedAt)}活动</div>
														)}
													</>
												) : (
													<div className="text-stone-400">
														{s.updatedAt ? `暂停于 ${fmtAgo(s.updatedAt)}` : "已暂停"}
													</div>
												)}
											</div>

											{/* 操作 */}
											<div className="flex w-20 shrink-0 items-center justify-end gap-1">
												{isRunning && (
													<button
														type="button"
														onClick={() => apply(stopSandbox(s.sessionId, s.name))}
														className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50 transition"
													>
														暂停
													</button>
												)}
												<div className="relative">
													<button
														type="button"
														onClick={() => setMenuFor(menuFor === k ? null : k)}
														className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition"
													>
														<MoreVertical size={15} />
													</button>
													{menuFor === k && (
														<>
															{/* click-away */}
															<div
																className="fixed inset-0 z-10"
																onClick={() => {
																	setMenuFor(null);
																	setConfirming(null);
																}}
															/>
															<div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
																<button
																	type="button"
																	onClick={() => openLogs(s)}
																	className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 transition"
																>
																	<FileText size={14} className="text-stone-400" />
																	查看日志
																</button>
																{confirming === k ? (
																	<button
																		type="button"
																		onClick={() => {
																			setConfirming(null);
																			apply(removeSandbox(s.sessionId, s.name));
																		}}
																		className="flex w-full items-center gap-2 bg-red-500 px-3 py-2 text-sm font-medium text-white transition"
																	>
																		<Trash2 size={14} />
																		确认删除？
																	</button>
																) : (
																	<button
																		type="button"
																		onClick={() => setConfirming(k)}
																		className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition"
																	>
																		<Trash2 size={14} />
																		删除沙箱
																	</button>
																)}
															</div>
														</>
													)}
												</div>
											</div>
										</div>
										{logsFor === k && (
											<pre className="mx-4 mb-3 max-h-64 overflow-auto rounded-lg bg-stone-900 px-3 py-2 text-xs leading-relaxed text-stone-100 whitespace-pre-wrap">
												{logText}
											</pre>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				<p className="text-xs text-stone-400">
					暂停会保留沙箱磁盘并释放算力，可随时恢复到原状态；删除会销毁环境与未推送的改动，不可恢复。
				</p>
			</div>
		</div>
	);
}

// A thin labelled progress bar for CPU / memory use.
function Meter({ label, pct, value }: { label: string; pct: number; value: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className="w-7 shrink-0 text-[10px] text-stone-400">{label}</span>
			<div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-100">
				<div
					className={`h-full rounded-full transition-[width] duration-500 ${pct > 80 ? "bg-red-400" : "bg-clay-400"}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-stone-500">
				{value}
			</span>
		</div>
	);
}
