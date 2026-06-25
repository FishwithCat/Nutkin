import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	Bold,
	BookOpen,
	Check,
	Code2,
	FileCode2,
	Heading2,
	Italic,
	Link2,
	List,
	Network,
	Pencil,
	Plus,
	Search,
	ShieldAlert,
	Tags,
	Trash2,
	X,
} from "lucide-react";
import type { Knowledge, KnowledgeType } from "../../shared/rpc";
import { deleteKnowledge, loadKnowledge, saveKnowledge } from "../rpc";
import { makeId } from "../taskState";
import { Markdown } from "./Markdown";
import { type MdAction, applyMd } from "./mdToolbar";

// ponytail: 4 个类型写死成常量，不做"自定义类型"管理。条目走 RPC 持久化（SQLite，
// 按项目隔离）。需要类型可配置时再换成数据。
const TYPES: { key: KnowledgeType; label: string; icon: typeof BookOpen }[] = [
	{ key: "background", label: "项目背景", icon: BookOpen },
	{ key: "architecture", label: "架构决策", icon: Network },
	{ key: "convention", label: "编码规范", icon: FileCode2 },
	{ key: "glossary", label: "领域术语", icon: Tags },
];

const typeLabel = (t: KnowledgeType) => TYPES.find((x) => x.key === t)?.label ?? t;

// "全部" (reviewed) + "待审核" (unreviewed) pseudo-categories plus the 4 real types.
type Category = KnowledgeType | "all" | "pending";

// Open editor state: id=null means a new entry, otherwise editing an existing one.
// approveOnSave marks the entry reviewed when saved (the "编辑后通过" flow).
type Draft = {
	id: string | null;
	title: string;
	description: string;
	type: KnowledgeType;
	approveOnSave?: boolean;
};

// First non-empty line, stripped of leading markdown markers — the card summary.
function summarize(description: string) {
	const line = description
		.split("\n")
		.map((l) => l.trim())
		.find(Boolean);
	return line ? line.replace(/^([#>*-]|\d+\.)\s*/, "") : "";
}

function relativeDay(ts: number) {
	const days = Math.floor((Date.now() - ts) / 86_400_000);
	if (days <= 0) return "今天更新";
	if (days === 1) return "昨天更新";
	return `${days} 天前更新`;
}

export function KnowledgeBase({ projectId }: { projectId: string }) {
	const [items, setItems] = useState<Knowledge[]>([]);
	const [selected, setSelected] = useState<Category>("all");
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);

	useEffect(() => {
		setDraft(null);
		setSelectedId(null);
		loadKnowledge(projectId).then(setItems);
	}, [projectId]);

	// Unreviewed entries live only under 待审核; 全部 and the type tabs show the
	// approved KB.
	const inCategory = (i: Knowledge) =>
		selected === "pending"
			? !i.reviewed
			: i.reviewed && (selected === "all" || i.type === selected);

	const visible = items
		.filter(inCategory)
		.filter((i) => i.title.toLowerCase().includes(query.trim().toLowerCase()));

	const pendingCount = items.filter((i) => !i.reviewed).length;

	// The focused entry: the selected id if still visible, else the first row.
	const current = visible.find((i) => i.id === selectedId) ?? visible[0] ?? null;

	function upsert(next: Knowledge) {
		saveKnowledge(next);
		setItems((prev) =>
			prev.some((i) => i.id === next.id)
				? prev.map((i) => (i.id === next.id ? next : i))
				: [next, ...prev],
		);
	}

	function startNew() {
		setDraft({
			id: null,
			title: "",
			description: "",
			type: selected === "all" || selected === "pending" ? "background" : selected,
		});
	}

	function save() {
		if (!draft) return;
		const title = draft.title.trim();
		if (!title) return;
		const existing = draft.id ? items.find((i) => i.id === draft.id) : null;
		const next: Knowledge = existing
			? {
					...existing,
					title,
					description: draft.description,
					updatedAt: Date.now(),
					reviewed: draft.approveOnSave ? true : existing.reviewed,
				}
			: {
					id: makeId(),
					projectId,
					title,
					description: draft.description,
					type: draft.type,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					isAvailable: true,
					// New entries enter review; approve them to join the active KB.
					reviewed: false,
				};
		upsert(next);
		// Follow the entry to wherever it now lives so it stays on screen.
		setSelected(next.reviewed ? "all" : "pending");
		setSelectedId(next.id);
		setDraft(null);
	}

	function remove(id: string) {
		deleteKnowledge(id);
		setItems((prev) => prev.filter((i) => i.id !== id));
		if (draft?.id === id) setDraft(null);
		if (selectedId === id) setSelectedId(null);
	}

	const categoryLabel =
		selected === "all" ? "全部" : selected === "pending" ? "待审核" : typeLabel(selected);

	return (
		<div className="flex min-h-0 flex-1">
			{/* 左栏：分类 */}
			<div className="w-48 shrink-0 flex flex-col border-r border-stone-200 bg-stone-50">
				<div className="flex-1 overflow-y-auto p-3 space-y-0.5">
					<CategoryRow
						label="全部"
						icon={BookOpen}
						count={items.filter((i) => i.reviewed).length}
						active={selected === "all"}
						onClick={() => setSelected("all")}
					/>
					<CategoryRow
						label="待审核"
						icon={ShieldAlert}
						count={pendingCount}
						active={selected === "pending"}
						onClick={() => setSelected("pending")}
						accent={pendingCount > 0}
					/>
					<div className="px-3 pt-4 pb-1 text-xs font-medium text-stone-400">类型</div>
					{TYPES.map((t) => (
						<CategoryRow
							key={t.key}
							label={t.label}
							icon={t.icon}
							count={items.filter((i) => i.reviewed && i.type === t.key).length}
							active={selected === t.key}
							onClick={() => setSelected(t.key)}
						/>
					))}
				</div>
			</div>

			{/* 中栏：列表 */}
			<div className="w-80 shrink-0 flex flex-col border-r border-stone-200 bg-stone-50/50">
				<div className="flex items-center gap-2 px-4 h-14 shrink-0">
					<span className="text-sm font-semibold text-stone-800">{categoryLabel}</span>
					<span className="text-xs text-stone-400">{visible.length} 条</span>
					<button
						type="button"
						onClick={startNew}
						title="新增"
						className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-clay-500 border border-clay-200 bg-white hover:bg-clay-50 transition-colors"
					>
						<Plus size={16} aria-hidden="true" />
					</button>
				</div>
				<div className="px-3">
					<div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 focus-within:border-clay-400 focus-within:ring-1 focus-within:ring-clay-200 transition">
						<Search size={14} className="text-stone-400 shrink-0" aria-hidden="true" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={`在${categoryLabel}中搜索…`}
							className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none"
						/>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto p-3 space-y-1.5">
					{visible.length === 0 && (
						<p className="text-sm text-stone-400 px-1 pt-3">
							还没有知识，点右上角「+」添加一条。
						</p>
					)}
					{visible.map((item) => (
						<ListCard
							key={item.id}
							item={item}
							active={current?.id === item.id && !draft}
							onClick={() => {
								setSelectedId(item.id);
								setDraft(null);
							}}
						/>
					))}
				</div>
			</div>

			{/* 右栏：详情 / 编辑 */}
			<div className="min-w-0 flex-1 flex flex-col bg-white">
				{draft ? (
					<DraftForm
						draft={draft}
						setDraft={setDraft}
						onSave={save}
						onCancel={() => setDraft(null)}
					/>
				) : current ? (
					<Detail
						item={current}
						onEdit={() =>
							setDraft({
								id: current.id,
								title: current.title,
								description: current.description,
								type: current.type,
							})
						}
						onEditApprove={() =>
							setDraft({
								id: current.id,
								title: current.title,
								description: current.description,
								type: current.type,
								approveOnSave: true,
							})
						}
						onApprove={() => {
							upsert({ ...current, reviewed: true });
							setSelected("all");
						}}
						onToggle={() => upsert({ ...current, isAvailable: !current.isAvailable })}
						onDelete={() => remove(current.id)}
					/>
				) : (
					<div className="flex-1 flex items-center justify-center text-sm text-stone-400">
						选择左侧条目查看详情
					</div>
				)}
			</div>
		</div>
	);
}

function CategoryRow({
	label,
	icon: Icon,
	count,
	active,
	onClick,
	accent,
}: {
	label: string;
	icon: typeof BookOpen;
	count: number;
	active: boolean;
	onClick: () => void;
	// Amber styling for the 待审核 row when entries are waiting.
	accent?: boolean;
}) {
	const tint = accent && !active ? "text-amber-600" : active ? "text-clay-600" : "text-stone-400";
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full flex items-center gap-2.5 text-left rounded-lg px-3 h-9 transition-colors ${
				active ? "bg-clay-50 text-clay-700" : "text-stone-700 hover:bg-stone-100"
			}`}
		>
			<Icon size={15} className={`shrink-0 ${tint}`} aria-hidden="true" />
			<span className={`flex-1 text-sm ${active ? "font-medium" : ""}`}>{label}</span>
			<span
				className={`shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs tabular-nums ${
					accent && count > 0
						? "text-clay-600"
						: active
							? "text-clay-600"
							: "text-stone-400"
				}`}
			>
				{count}
			</span>
		</button>
	);
}

function ListCard({
	item,
	active,
	onClick,
}: {
	item: Knowledge;
	active: boolean;
	onClick: () => void;
}) {
	const summary = summarize(item.description);
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left rounded-xl border p-3 transition-colors ${
				active
					? "border-clay-300 bg-white shadow-sm ring-1 ring-clay-100"
					: "border-transparent hover:bg-white hover:border-stone-200"
			}`}
		>
			<p
				className={`text-sm font-medium truncate ${
					item.isAvailable ? "text-stone-900" : "text-stone-400 line-through"
				}`}
			>
				{item.title}
			</p>
			{summary && <p className="mt-1 text-xs text-stone-500 truncate">{summary}</p>}
			<p className="mt-2 text-[11px] text-stone-400">{relativeDay(item.createdAt)}</p>
		</button>
	);
}

function Detail({
	item,
	onEdit,
	onEditApprove,
	onApprove,
	onToggle,
	onDelete,
}: {
	item: Knowledge;
	onEdit: () => void;
	onEditApprove: () => void;
	onApprove: () => void;
	onToggle: () => void;
	onDelete: () => void;
}) {
	const pending = !item.reviewed;
	return (
		<>
			<div className="flex-1 overflow-y-auto px-8 pt-6 pb-8">
				{pending && (
					<div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
						<ShieldAlert size={14} className="shrink-0" aria-hidden="true" />
						待审核 · 通过后才会被 Agent 学习并在评审中引用
					</div>
				)}
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
								{typeLabel(item.type)}
							</span>
							{pending ? (
								<span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
									待审核
								</span>
							) : (
								<button
									type="button"
									onClick={onToggle}
									title="切换 Agent 学习状态"
									className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
										item.isAvailable
											? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
											: "bg-stone-100 text-stone-400 hover:bg-stone-200"
									}`}
								>
									{item.isAvailable && <Check size={12} aria-hidden="true" />}
									{item.isAvailable ? "已被 Agent 学习" : "未启用"}
								</button>
							)}
						</div>
						<h1 className="mt-3 text-xl font-semibold text-stone-900">{item.title}</h1>
						<p className="mt-1.5 text-xs text-stone-400">{relativeDay(item.createdAt)}</p>
					</div>
					{!pending && (
						<div className="shrink-0 flex items-center gap-1.5">
							<button
								type="button"
								onClick={onEdit}
								className="h-8 rounded-lg border border-stone-200 bg-white flex items-center gap-1.5 px-3 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
							>
								<Pencil size={14} aria-hidden="true" />
								编辑
							</button>
							<button
								type="button"
								onClick={onDelete}
								title="删除"
								className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:bg-rose-50 hover:text-rose-500 transition-colors"
							>
								<Trash2 size={15} aria-hidden="true" />
							</button>
						</div>
					)}
				</div>
				<div className="mt-5">
					{item.description.trim() ? (
						<div className="text-sm text-stone-700 leading-relaxed">
							<Markdown>{item.description}</Markdown>
						</div>
					) : (
						<p className="text-sm text-stone-400">暂无内容，点「编辑」补充。</p>
					)}
				</div>
			</div>

			{/* 审核操作栏 */}
			{pending && (
				<div className="shrink-0 flex items-center gap-2 border-t border-stone-200 px-8 py-4">
					<button
						type="button"
						onClick={onDelete}
						className="h-9 rounded-lg border border-stone-200 bg-white flex items-center gap-1.5 px-3 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
					>
						<X size={15} aria-hidden="true" />
						驳回
					</button>
					<button
						type="button"
						onClick={onEditApprove}
						className="ml-auto h-9 rounded-lg border border-stone-200 bg-white flex items-center gap-1.5 px-3 text-sm text-stone-600 hover:bg-stone-50 transition-colors"
					>
						<Pencil size={14} aria-hidden="true" />
						编辑后通过
					</button>
					<button
						type="button"
						onClick={onApprove}
						className="h-9 rounded-lg bg-emerald-600 text-white flex items-center gap-1.5 px-4 text-sm hover:bg-emerald-700 transition-colors"
					>
						<Check size={15} aria-hidden="true" />
						通过入库
					</button>
				</div>
			)}
		</>
	);
}

const TOOLBAR: { action: MdAction; icon: typeof Bold; title: string }[] = [
	{ action: "heading", icon: Heading2, title: "标题" },
	{ action: "bold", icon: Bold, title: "加粗" },
	{ action: "italic", icon: Italic, title: "斜体" },
	{ action: "list", icon: List, title: "列表" },
	{ action: "code", icon: Code2, title: "代码" },
	{ action: "link", icon: Link2, title: "链接" },
];

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
	const taRef = useRef<HTMLTextAreaElement>(null);
	// Selection to restore after a toolbar edit re-renders the controlled textarea.
	const pendingSel = useRef<[number, number] | null>(null);

	useLayoutEffect(() => {
		const ta = taRef.current;
		if (pendingSel.current && ta) {
			ta.focus();
			ta.setSelectionRange(pendingSel.current[0], pendingSel.current[1]);
			pendingSel.current = null;
		}
	});

	function runAction(action: MdAction) {
		const ta = taRef.current;
		if (!ta) return;
		const r = applyMd(draft.description, ta.selectionStart, ta.selectionEnd, action);
		pendingSel.current = [r.selStart, r.selEnd];
		setDraft({ ...draft, description: r.text });
	}

	return (
		<div className="flex-1 flex flex-col px-8 py-6 min-h-0">
			<div className="flex items-center gap-2 shrink-0 text-xs text-stone-400">
				<span>{draft.id ? "编辑知识" : "新建知识"}</span>
				<span>·</span>
				<select
					value={draft.type}
					onChange={(e) => setDraft({ ...draft, type: e.target.value as KnowledgeType })}
					className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600 outline-none cursor-pointer hover:bg-stone-200 transition-colors"
				>
					{TYPES.map((t) => (
						<option key={t.key} value={t.key}>
							{t.label}
						</option>
					))}
				</select>
			</div>
			<input
				autoFocus
				value={draft.title}
				onChange={(e) => setDraft({ ...draft, title: e.target.value })}
				placeholder="知识标题"
				className="mt-3 w-full bg-transparent text-2xl font-semibold text-stone-900 placeholder:text-stone-300 outline-none"
			/>

			<div className="mt-5 flex items-center gap-0.5 border-b border-stone-200 pb-2 shrink-0">
				{TOOLBAR.map(({ action, icon: Icon, title }) => (
					<button
						key={action}
						type="button"
						title={title}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => runAction(action)}
						className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors"
					>
						<Icon size={16} aria-hidden="true" />
					</button>
				))}
				<span className="ml-auto text-xs text-stone-400">支持 Markdown</span>
			</div>
			<textarea
				ref={taRef}
				value={draft.description}
				onChange={(e) => setDraft({ ...draft, description: e.target.value })}
				placeholder="内容（支持 Markdown）"
				className="mt-3 flex-1 min-h-0 w-full resize-none bg-transparent font-mono text-sm leading-relaxed text-stone-800 placeholder:text-stone-400 outline-none"
			/>
			<div className="mt-3 flex items-center gap-2 shrink-0 border-t border-stone-100 pt-3">
				<button
					type="button"
					onClick={onSave}
					disabled={!draft.title.trim()}
					className="rounded-lg bg-clay-500 text-white px-4 h-8 text-sm hover:bg-clay-600 disabled:opacity-40 transition-colors"
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
