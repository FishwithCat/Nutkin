// Small pure helpers for the project UI: deriving a display name from a git URL
// and formatting "时间前" labels for the project cards.
import type { ProjectRepo } from "./types";

// Turn a clone URL into a compact "org/repo" label. Handles https and scp-style
// (git@host:org/repo.git) URLs; falls back to the raw string if it can't parse.
export function repoDisplayName(url: string): string {
	const trimmed = url.trim().replace(/\.git$/, "");
	// scp-like: git@github.com:org/repo
	const scp = trimmed.match(/^[^/@]+@[^:]+:(.+)$/);
	const path = scp ? scp[1] : trimmed.replace(/^[a-z]+:\/\/[^/]+\//i, "");
	const parts = path.split("/").filter(Boolean);
	if (parts.length >= 2) return parts.slice(-2).join("/");
	return parts[parts.length - 1] ?? trimmed;
}

// Host + path without the scheme, e.g. "github.com/org/repo.git", for the small
// muted subtitle under a repo row.
export function repoHostPath(url: string): string {
	const trimmed = url.trim();
	const scp = trimmed.match(/^[^/@]+@([^:]+):(.+)$/);
	if (scp) return `${scp[1]}/${scp[2]}`;
	return trimmed.replace(/^[a-z]+:\/\//i, "");
}

export function makeRepo(url: string, branch = "main"): ProjectRepo {
	return { url: url.trim(), name: repoDisplayName(url), branch };
}

// Common sandbox images offered in the project settings dropdown (see the
// agent's createSandbox examples). Anything else can be typed via "自定义".
export const IMAGE_PRESETS = ["alpine", "debian", "ubuntu", "python", "node"];

// "刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期" for a ms-epoch timestamp.
export function relativeTime(ts: number | null): string {
	if (!ts) return "暂无活动";
	const diff = Date.now() - ts;
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "刚刚活动";
	if (min < 60) return `${min} 分钟前活动`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr} 小时前活动`;
	const day = Math.floor(hr / 24);
	if (day < 30) return `${day} 天前活动`;
	return new Date(ts).toLocaleDateString("zh-CN");
}
