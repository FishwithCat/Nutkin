import { useState } from "react";
import {
	Ban,
	Box,
	Calculator,
	Check,
	ChevronRight,
	CircleX,
	Clock,
	FilePlus,
	FilePen,
	Hammer,
	List,
	Loader2,
	Square,
	Terminal,
	Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ToolEvent } from "../types";

// Three outcomes for a finished tool: it was aborted (turn cancelled
// mid-execution, marked with the "已中止" error), it failed (threw any other
// error, or a runCommand exited non-zero), or it succeeded.
function toolOutcome(output: unknown): "success" | "failed" | "aborted" {
	if (typeof output !== "object" || output === null) return "success";
	const error = (output as { error?: unknown }).error;
	if (error === "已中止") return "aborted";
	if (error !== undefined) return "failed";
	const code = (output as { code?: unknown }).code;
	return typeof code === "number" && code !== 0 ? "failed" : "success";
}

// Per-tool display metadata: which icon to show and a one-line summary of the
// call's primary argument. Falls back to the first string field / raw JSON for
// any tool not listed here, so new tools render sensibly without changes.
function toolMeta(tool: ToolEvent): { icon: LucideIcon; summary: string } {
	const input = (tool.input ?? {}) as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === "string" ? v : "");
	switch (tool.toolName) {
		case "getCurrentTime":
			return { icon: Clock, summary: str(input.timeZone) || "now" };
		case "calculate":
			return { icon: Calculator, summary: str(input.expression) };
		case "createSandbox":
			return {
				icon: Box,
				summary: [str(input.name) || "default", str(input.image)].filter(Boolean).join(" · "),
			};
		case "runCommand":
			return {
				icon: Terminal,
				summary: [str(input.command), ...(Array.isArray(input.args) ? input.args.map(String) : [])]
					.join(" ")
					.trim(),
			};
		case "writeFile":
			return { icon: FilePlus, summary: str(input.path) };
		case "editFile":
			return { icon: FilePen, summary: str(input.path) };
		case "stopSandbox":
			return { icon: Square, summary: str(input.name) || "default" };
		case "listSandboxes":
			return { icon: List, summary: "" };
		case "refactor":
			return { icon: Hammer, summary: str(input.instruction) };
		default: {
			const first = Object.values(input).find((v) => typeof v === "string");
			return { icon: Wrench, summary: str(first) || JSON.stringify(tool.input ?? {}) };
		}
	}
}

// Human-readable elapsed time for a span in ms: sub-second as "320ms", longer
// as "1.2s". Returns "" when either timestamp is missing (e.g. older persisted
// calls recorded before timing was tracked).
function formatDuration(ms: number | undefined): string {
	if (ms === undefined || ms < 0) return "";
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Per-call elapsed time, or undefined if it wasn't recorded.
function elapsed(tool: ToolEvent): number | undefined {
	if (tool.startedAt === undefined || tool.endedAt === undefined) return undefined;
	return tool.endedAt - tool.startedAt;
}

// Wall-clock span covering a batch of finished calls: from the first start to
// the last end. Undefined if no call carries timing.
function totalDuration(tools: ToolEvent[]): number | undefined {
	const starts = tools.map((t) => t.startedAt).filter((n): n is number => n !== undefined);
	const ends = tools.map((t) => t.endedAt).filter((n): n is number => n !== undefined);
	if (starts.length === 0 || ends.length === 0) return undefined;
	return Math.max(...ends) - Math.min(...starts);
}

// A turn's tool calls in a fixed-height layout that never reflows as calls
// finish: a collapsed summary line on top (aggregate count/status, expandable to
// the full history) and one constant-height "live" row below spotlighting the
// most recent call. When a call completes nothing is added or removed — the live
// row swaps its spinner for a ✓ and its "运行中" for a duration in place, and the
// summary's status text updates — so streaming never shifts the layout.
export function ToolPanel({ tools }: { tools: ToolEvent[] }) {
	const running = tools.filter((t) => t.output === undefined);
	// Spotlight the latest still-running call, or — when idle — the last call
	// that ran, so the live row keeps its height instead of vanishing.
	const live = running[running.length - 1] ?? tools[tools.length - 1];
	return (
		<div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
			<Summary tools={tools} />
			<LiveRow tool={live} bordered />
		</div>
	);
}

// The aggregate summary line. Shows the total count and a status tally over the
// finished calls; when any have finished it becomes a toggle that expands the
// full trail. Its height is constant — only the status text changes as calls
// complete.
function Summary({ tools }: { tools: ToolEvent[] }) {
	const [open, setOpen] = useState(false);
	const done = tools.filter((t) => t.output !== undefined);
	const ok = done.filter((t) => toolOutcome(t.output) === "success").length;
	const failed = done.filter((t) => toolOutcome(t.output) === "failed").length;
	const aborted = done.filter((t) => toolOutcome(t.output) === "aborted").length;
	const total = formatDuration(totalDuration(done));
	const expandable = done.length > 0;

	const header = (
		<>
			<Wrench size={14} className="shrink-0 text-stone-400" aria-hidden="true" />
			<span className="text-sm font-medium text-stone-700 shrink-0">工具调用</span>
			<span className="text-xs text-stone-400 shrink-0">{tools.length}</span>
			<span className="ml-auto flex items-center gap-2 shrink-0 text-xs">
				{failed > 0 && (
					<span className="flex items-center gap-1 text-red-600">
						<CircleX size={13} aria-hidden="true" />
						{failed}
					</span>
				)}
				{aborted > 0 && (
					<span className="flex items-center gap-1 text-amber-600">
						<Ban size={13} aria-hidden="true" />
						{aborted}
					</span>
				)}
				{ok > 0 && (
					<span className="flex items-center gap-1 text-stone-400">
						<Check size={13} className="text-emerald-600" aria-hidden="true" />
						{ok} 完成
					</span>
				)}
				{total && <span className="text-stone-400 tabular-nums">· {total}</span>}
				{expandable && (
					<ChevronRight
						size={14}
						className={`text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
						aria-hidden="true"
					/>
				)}
			</span>
		</>
	);

	return (
		<div>
			{expandable ? (
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50 transition-colors"
				>
					{header}
				</button>
			) : (
				<div className="flex items-center gap-2 px-4 py-2.5">{header}</div>
			)}

			{open && (
				<div className="border-t border-stone-100 divide-y divide-stone-100">
					{done.map((t) => (
						<TrailRow key={t.toolCallId} tool={t} />
					))}
				</div>
			)}
		</div>
	);
}

// The fixed-height live row spotlighting one call. Same single-line height
// whether it is running (spinner + "运行中") or finished (outcome icon +
// duration), so a call completing swaps these in place without reflow.
function LiveRow({ tool, bordered }: { tool: ToolEvent; bordered: boolean }) {
	const running = tool.output === undefined;
	const outcome = running ? undefined : toolOutcome(tool.output);
	const { icon: Icon, summary } = toolMeta(tool);
	const took = formatDuration(elapsed(tool));
	return (
		<div
			className={`flex items-center gap-2.5 px-4 py-2.5 ${bordered ? "border-t border-stone-100" : ""}`}
		>
			{running ? (
				<Loader2 size={14} className="shrink-0 animate-spin text-clay-500" aria-hidden="true" />
			) : outcome === "aborted" ? (
				<Ban size={14} className="shrink-0 text-amber-600" aria-hidden="true" />
			) : outcome === "failed" ? (
				<CircleX size={14} className="shrink-0 text-red-600" aria-hidden="true" />
			) : (
				<Check size={14} className="shrink-0 text-emerald-600" aria-hidden="true" />
			)}
			<Icon size={14} className="shrink-0 text-stone-500" aria-hidden="true" />
			<span className="text-sm font-medium text-stone-800 shrink-0">{tool.toolName}</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-400">{summary}</span>
			<span className="ml-auto shrink-0 text-xs tabular-nums">
				{running ? <span className="text-clay-500">运行中</span> : <span className="text-stone-400">{took}</span>}
			</span>
		</div>
	);
}

// One finished call in the expanded trail. Slim by default; clicking reveals a
// single dim line with its input and output rather than a full terminal block.
function TrailRow({ tool }: { tool: ToolEvent }) {
	const [open, setOpen] = useState(false);
	const outcome = toolOutcome(tool.output);
	const { icon: Icon, summary } = toolMeta(tool);
	const took = formatDuration(elapsed(tool));
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="w-full flex items-center gap-2.5 px-4 py-2 pl-8 text-left hover:bg-stone-50 transition-colors"
			>
				<Icon size={14} className="shrink-0 text-stone-400" aria-hidden="true" />
				<span className="text-sm text-stone-700 shrink-0">{tool.toolName}</span>
				<span className="text-xs text-stone-400 truncate font-mono">{summary}</span>
				<span className="ml-auto flex items-center gap-2 shrink-0">
					{took && <span className="text-xs text-stone-400 tabular-nums">{took}</span>}
					{outcome === "aborted" ? (
						<Ban size={14} className="text-amber-600" aria-hidden="true" />
					) : outcome === "failed" ? (
						<CircleX size={14} className="text-red-600" aria-hidden="true" />
					) : (
						<Check size={14} className="text-emerald-600" aria-hidden="true" />
					)}
				</span>
			</button>
			{open && (
				<div className="px-4 pb-2 pl-8 font-mono text-xs leading-relaxed text-stone-400 space-y-0.5">
					<div className="break-all">in: {JSON.stringify(tool.input)}</div>
					<div className="break-all">out: {JSON.stringify(tool.output)}</div>
				</div>
			)}
		</div>
	);
}
