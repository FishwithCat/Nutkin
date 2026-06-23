import { useState } from "react";
import {
	Ban,
	Box,
	Calculator,
	Check,
	ChevronRight,
	CircleX,
	Clock,
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
				summary: [str(input.name) || "default", str(input.image) || "alpine"].join(" · "),
			};
		case "runCommand":
			return {
				icon: Terminal,
				summary: [str(input.command), ...(Array.isArray(input.args) ? input.args.map(String) : [])]
					.join(" ")
					.trim(),
			};
		case "stopSandbox":
			return { icon: Square, summary: str(input.name) || "default" };
		case "listSandboxes":
			return { icon: List, summary: "" };
		default: {
			const first = Object.values(input).find((v) => typeof v === "string");
			return { icon: Wrench, summary: str(first) || JSON.stringify(tool.input ?? {}) };
		}
	}
}

// One bordered panel grouping every tool call in a turn. History stays folded;
// the latest (or any still-running) call is expanded by default.
export function ToolPanel({ tools }: { tools: ToolEvent[] }) {
	// Per-row open overrides. A row with no override falls back to "is the latest
	// call", so history stays folded and the newest auto-expands — but any number
	// of rows can be toggled open independently.
	const [open, setOpen] = useState<Record<string, boolean>>({});
	const lastId = tools[tools.length - 1]?.toolCallId;
	return (
		<div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-100">
				<div className="flex items-center gap-2">
					<Wrench size={15} className="text-stone-400" aria-hidden="true" />
					<span className="text-sm font-medium text-stone-800">工具调用</span>
					<span className="text-xs text-stone-400">{tools.length}</span>
				</div>
				<span className="text-xs text-stone-400">默认折叠历史 · 仅展开最新</span>
			</div>
			<div className="divide-y divide-stone-100">
				{tools.map((t) => {
					const isOpen = open[t.toolCallId] ?? t.toolCallId === lastId;
					return (
						<ToolRow
							key={t.toolCallId}
							tool={t}
							open={isOpen}
							onToggle={() => setOpen((o) => ({ ...o, [t.toolCallId]: !isOpen }))}
						/>
					);
				})}
			</div>
		</div>
	);
}

function ToolRow({
	tool,
	open,
	onToggle,
}: {
	tool: ToolEvent;
	open: boolean;
	onToggle: () => void;
}) {
	const running = tool.output === undefined;
	const outcome = running ? undefined : toolOutcome(tool.output);
	const { icon: Icon, summary } = toolMeta(tool);

	return (
		<div>
			<button
				type="button"
				onClick={onToggle}
				className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-stone-50 transition-colors"
			>
				<ChevronRight
					size={14}
					className={`shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
					aria-hidden="true"
				/>
				<Icon size={15} className="shrink-0 text-stone-500" aria-hidden="true" />
				<span className="text-sm font-medium text-stone-800 shrink-0">{tool.toolName}</span>
				<span className="text-xs text-stone-400 truncate font-mono">{summary}</span>
				<span className="ml-auto shrink-0">
					{running ? (
						<span className="flex items-center gap-1 text-xs text-clay-500">
							<Loader2 size={13} className="animate-spin" aria-hidden="true" />
							运行中
						</span>
					) : outcome === "aborted" ? (
						<Ban size={15} className="text-amber-600" aria-hidden="true" />
					) : outcome === "failed" ? (
						<CircleX size={15} className="text-red-600" aria-hidden="true" />
					) : (
						<Check size={15} className="text-emerald-600" aria-hidden="true" />
					)}
				</span>
			</button>

			{open && (
				<div className="bg-stone-900 px-4 py-3 font-mono text-xs leading-relaxed">
					<div className="text-stone-400">
						<span className="text-emerald-400">$</span> {tool.toolName}{" "}
						<span className="text-stone-500">{summary}</span>
					</div>
					<div className="text-stone-300 mt-1 break-all">in: {JSON.stringify(tool.input)}</div>
					{tool.output !== undefined ? (
						<div className="text-emerald-400 mt-1 break-all">out: {JSON.stringify(tool.output)}</div>
					) : (
						<div className="text-clay-400 mt-1">运行中…</div>
					)}
				</div>
			)}
		</div>
	);
}
