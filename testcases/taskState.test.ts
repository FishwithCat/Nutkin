import { expect, test } from "bun:test";
import type { Anchor } from "../src/shared/rpc";
import { applyEvent, threadHistory } from "../src/mainview/taskState";
import type { Task, UIMessage } from "../src/mainview/types";

const msg = (over: Partial<UIMessage>): UIMessage => ({
	id: "x",
	role: "user",
	content: "",
	reasoning: "",
	tools: [],
	pending: false,
	...over,
});

const anchor = (toolCallId: string): Anchor => ({
	toolCallId,
	sandboxName: "default",
	repoRoot: "/workspace",
	commitHash: "abcdef1234",
	path: "a.ts",
	startLine: 1,
	endLine: 2,
	quotedText: "const y = bar()",
});

test("threadHistory keeps only this card's prior turns, in order", () => {
	const task: Task = {
		id: "t",
		title: "",
		busy: false,
		messages: [
			msg({ id: "1", role: "user", content: "main turn", anchor: undefined }),
			msg({ id: "2", role: "user", content: "why no cache?", anchor: anchor("card-A") }),
			msg({ id: "3", role: "assistant", content: "because…", anchor: anchor("card-A") }),
			msg({ id: "4", role: "user", content: "other card", anchor: anchor("card-B") }),
			msg({ id: "5", role: "assistant", content: "", anchor: anchor("card-A") }), // empty, skipped
		],
	};
	const h = threadHistory(task, anchor("card-A"), "and now?");
	// framing + 2 prior card-A turns + new question (main turn & card-B excluded)
	expect(h.map((m) => m.content)).toEqual([
		h[0].content, // framing (quotes the snippet)
		"why no cache?",
		"because…",
		"and now?",
	]);
	expect(h[0].content).toContain("const y = bar()");
	expect(h[0].content).toContain("abcdef12"); // short hash for git show
});

test("applyEvent stamps commits onto the turn", () => {
	const commits = [
		{ path: "a.ts", sandboxName: "default", repoRoot: "/workspace", commitHash: "deadbeef" },
	];
	const out = applyEvent(msg({ id: "9", role: "assistant" }), {
		type: "commits",
		id: "9",
		commits,
	});
	expect(out.commits).toEqual(commits);
});
