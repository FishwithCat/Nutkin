import { expect, test } from "bun:test";
import { reduceSandboxes, sandboxesFromMessages } from "./taskState";
import type { AgentEvent } from "./rpc";
import type { UIMessage } from "./types";

const createSandbox = (input: unknown): AgentEvent => ({
	type: "toolCall",
	call: { id: "m1", toolCallId: "t1", toolName: "createSandbox", input },
});

test("createSandbox adds a {name, description}", () => {
	const out = reduceSandboxes([], createSandbox({ name: "web", description: "frontend" }));
	expect(out).toEqual([{ name: "web", description: "frontend" }]);
});

test("same name does not duplicate", () => {
	const start = [{ name: "web", description: "frontend" }];
	const out = reduceSandboxes(start, createSandbox({ name: "web" }));
	expect(out).toBe(start); // unchanged reference
});

test("same name with a new description updates it", () => {
	const out = reduceSandboxes(
		[{ name: "web", description: "frontend" }],
		createSandbox({ name: "web", description: "vite dev server" }),
	);
	expect(out).toEqual([{ name: "web", description: "vite dev server" }]);
});

test("missing name defaults to 'default'", () => {
	const out = reduceSandboxes([], createSandbox({}));
	expect(out).toEqual([{ name: "default", description: "" }]);
});

test("non-createSandbox events leave the list untouched", () => {
	const start = [{ name: "web", description: "frontend" }];
	const other: AgentEvent = { type: "done", id: "m1" };
	expect(reduceSandboxes(start, other)).toBe(start);
});

const msg = (tools: UIMessage["tools"]): UIMessage => ({
	id: "m",
	role: "assistant",
	content: "",
	reasoning: "",
	tools,
	pending: false,
});

test("sandboxesFromMessages rebuilds the registry from history (dedupe + update)", () => {
	const messages: UIMessage[] = [
		msg([{ toolCallId: "1", toolName: "createSandbox", input: { name: "web", description: "todo app" } }]),
		msg([{ toolCallId: "2", toolName: "runCommand", input: { name: "web", command: "ls" } }]),
		msg([{ toolCallId: "3", toolName: "createSandbox", input: { name: "web", description: "todo app + tunnel" } }]),
		msg([{ toolCallId: "4", toolName: "createSandbox", input: {} }]),
	];
	expect(sandboxesFromMessages(messages)).toEqual([
		{ name: "web", description: "todo app + tunnel" },
		{ name: "default", description: "" },
	]);
});
