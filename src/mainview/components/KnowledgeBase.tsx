import { useEffect, useState } from "react";
import {
	BookOpen,
	FileCode2,
	Network,
	Plus,
	Search,
	Tags,
	Trash2,
} from "lucide-react";
import type { Knowledge, KnowledgeType } from "../../shared/rpc";
import { deleteKnowledge, loadKnowledge, saveKnowledge } from "../rpc";
import { makeId } from "../taskState";

// ponytail: 4 个类型写死成常量，不做"自定义类型"管理。条目走 RPC 持久化（SQLite，
// 按项目隔离）。需要类型可配置时再换成数据。
const TYPES: { key: KnowledgeType; label: string; icon: typeof BookOpen }[] = [
	{ key: "background", label: "项目背景", icon: BookOpen },
	{ key: "architecture", label: "架构决策", icon: Network },
	{ key: "convention", label: "编码规范", icon: FileCode2 },
	{ key: "glossary", label: "领域术语", icon: Tags },
];

// Open editor state: id=null means a new entry, otherwise editing an existing one.
type Draft = { id: string | null; title: string; description: string };

export function KnowledgeBase({ projectId }: { projectId: string }) {
	const [items, setItems] = useState<Knowledge[]>([]);
	const [selected, setSelected] = useState<KnowledgeType>("background");
	const [query, setQuery] = useState("");
	const [draft, setDraft] = useState<Draft | null>(null);

	useEffect(() => {
		setDraft(null);
		loadKnowledge(projectId).then(setItems);
	}, [projectId]);

	const visible = items
		.filter((i) => i.type === selected)
		.filter((i) => i.title.toLowerCase().includes(query.trim().toLowerCase()));

	function upsert(next: Knowledge) {
		saveKnowledge(next);
		setItems((prev) =>
			prev.some((i) => i.id === next.id)
				? prev.map((i) => (i.id === next.id ? next : i))
				: [next, ...prev],
		);
	}

	function save() {
		if (!draft) return;
		const title = draft.title.trim();
		if (!title) return;
		const existing = draft.id ? items.find((i) => i.id === draft.id) : null;
		upsert(
			existing
				? { ...existing, title, description: draft.description }
				: {
						id: makeId(),
						projectId,
						title,
						description: draft.description,
						type: selected,
						createdAt: Date.now(),
						isAvailable: true,
					},
		);
		setDraft(null);
	}

	function remove(id: string) {
		deleteKnowledge(id);
		setItems((prev) => prev.filter((i) => i.id !== id));
		if (draft?.id === id) setDraft(null);
	}

	return (
		<div className="flex min-h-0 flex-1">
			{/* 左栏：4 个类型 */}
			<div className="w-72 shrink-0 flex flex-col border-r border-stone-200 bg-stone-50">
				<div className="px-4 h-16 shrink-0 flex items-center text-sm font-semibold text-stone-700">
					知识类型
				</div>
				<div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
					{TYPES.map((t) => {
						const count = items.filter((i) => i.type === t.key).length;
						const active = t.key === selected;
						const Icon = t.icon;
						return (
							<button
								key={t.key}
								type="button"
								onClick={() => setSelected(t.key)}
								className="w-full flex items-center gap-2.5 text-left rounded-xl px-3 h-12 hover:bg-stone-100 transition-colors"
							>
								<Icon
									size={16}
									className={`shrink-0 ${active ? "text-clay-600" : "text-stone-400"}`}
									aria-hidden="true"
								/>
								<span
									className={`flex-1 text-sm ${active ? "text-stone-900 font-medium" : "text-stone-700"}`}
								>
									{t.label}
								</span>
								<span
									className={`shrink-0 text-xs ${active ? "text-clay-600" : "text-stone-400"}`}
								>
									{count}
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* 右栏：搜索 + 新增 + 列表 */}
			<div className="min-w-0 flex-1 flex flex-col">
				<div className="flex items-center gap-2 px-4 h-16 shrink-0 border-b border-stone-100">
					<div className="flex flex-1 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition">
						<Search size={15} className="text-stone-400 shrink-0" aria-hidden="true" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="搜索标题…"
							className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none"
						/>
					</div>
					<button
						type="button"
						onClick={() => setDraft({ id: null, title: "", description: "" })}
						className="h-9 shrink-0 rounded-lg bg-clay-500 text-white flex items-center gap-1.5 px-3 text-sm hover:bg-clay-600 transition-colors"
					>
						<Plus size={16} aria-hidden="true" />
						新增
					</button>
				</div>

				<div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
					{draft && (
						<DraftForm
							draft={draft}
							setDraft={setDraft}
							onSave={save}
							onCancel={() => setDraft(null)}
						/>
					)}

					{visible.length === 0 && !draft && (
						<p className="text-sm text-stone-400 pt-4">该类型下还没有知识，点「新增」添加一条。</p>
					)}

					{visible.map((item) => (
						<KnowledgeCard
							key={item.id}
							item={item}
							onEdit={() =>
								setDraft({ id: item.id, title: item.title, description: item.description })
							}
							onToggle={() => upsert({ ...item, isAvailable: !item.isAvailable })}
							onDelete={() => remove(item.id)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function DraftForm({
	draft,
	setDraft,
	onSave,
	onCancel,
}: {
	draft: Draft;
	setDraft: (d: Draft) => void;
	onSave: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="rounded-xl border border-clay-200 bg-clay-50/50 p-4 space-y-3">
			<input
				autoFocus
				value={draft.title}
				onChange={(e) => setDraft({ ...draft, title: e.target.value })}
				placeholder="标题"
				className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200"
			/>
			<textarea
				value={draft.description}
				onChange={(e) => setDraft({ ...draft, description: e.target.value })}
				placeholder="描述"
				rows={4}
				className="w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200"
			/>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onSave}
					disabled={!draft.title.trim()}
					className="rounded-lg bg-clay-500 text-white px-3 h-8 text-sm hover:bg-clay-600 disabled:opacity-40 transition-colors"
				>
					保存
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="rounded-lg px-3 h-8 text-sm text-stone-500 hover:bg-stone-100 transition-colors"
				>
					取消
				</button>
			</div>
		</div>
	);
}

function KnowledgeCard({
	item,
	onEdit,
	onToggle,
	onDelete,
}: {
	item: Knowledge;
	onEdit: () => void;
	onToggle: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="group rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-300 transition-colors">
			<div className="flex items-start gap-3">
				<button type="button" onClick={onEdit} className="flex-1 min-w-0 text-left">
					<p
						className={`text-sm font-medium truncate ${item.isAvailable ? "text-stone-900" : "text-stone-400 line-through"}`}
					>
						{item.title}
					</p>
					{item.description && (
						<p className="mt-1 text-sm text-stone-500 line-clamp-3 whitespace-pre-wrap">
							{item.description}
						</p>
					)}
					<p className="mt-2 text-xs text-stone-400">
						{new Date(item.createdAt).toLocaleDateString()}
					</p>
				</button>
				<div className="shrink-0 flex items-center gap-1.5">
					<button
						type="button"
						onClick={onToggle}
						title={item.isAvailable ? "已启用（点击停用）" : "已停用（点击启用）"}
						className={`relative w-9 h-5 rounded-full transition-colors ${item.isAvailable ? "bg-emerald-400" : "bg-stone-300"}`}
					>
						<span
							className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${item.isAvailable ? "left-[18px]" : "left-0.5"}`}
						/>
					</button>
					<button
						type="button"
						onClick={onDelete}
						title="删除"
						className="w-7 h-7 rounded-lg flex items-center justify-center text-stone-400 hover:bg-rose-50 hover:text-rose-500 transition-colors"
					>
						<Trash2 size={15} aria-hidden="true" />
					</button>
				</div>
			</div>
		</div>
	);
}
