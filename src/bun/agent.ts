// DeepSeek agent built on the Vercel AI SDK.
//
// This is the "agent" core: a model + a set of tools + a multi-step loop.
// `streamText` with `stopWhen: stepCountIs(N)` lets the model call tools,
// observe their results, and keep going until it produces a final answer
// (or hits the step budget). Everything runs in the Bun process so the
// DEEPSEEK_API_KEY never reaches the renderer.
import { deepseek } from "@ai-sdk/deepseek";
import { stepCountIs, streamText, tool, type ModelMessage } from "ai";
import { z } from "zod";
import {
	createSandbox,
	editFile,
	listSandboxes,
	runCommand,
	stopSandbox,
	writeFile,
} from "./sandbox";
import type { ProjectRepo } from "../shared/rpc";

/** Project context for a session: default sandbox image + bound repositories. */
export interface ProjectContext {
	name: string;
	image: string;
	repos: ProjectRepo[];
}

// Bun auto-loads .env, so DEEPSEEK_API_KEY is picked up automatically by the
// provider. Override the model with DEEPSEEK_MODEL (e.g. "deepseek-reasoner").
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

const SYSTEM_PROMPT = [
	"You are a helpful AI assistant powered by DeepSeek with access to tools:",
	"getCurrentTime, and per-session Linux sandboxes (createSandbox, runCommand,",
	"writeFile, editFile, stopSandbox, listSandboxes). Each tool's own description",
	"says how to use it. To create or overwrite a file use writeFile, and to modify",
	"part of a file use editFile — do NOT change files with shell redirection like",
	"'echo > file' or 'sed -i' via runCommand, so every file change is shown to the",
	"user as a diff. Use runCommand for everything else (building, running, inspecting).",
	"CRITICAL: The ONLY way you learn what a command did is by calling runCommand and",
	"reading the tool result that comes back. You cannot run, ping, curl, or test",
	"anything by writing about it. Never invent command output, stdout, stderr, exit",
	"codes, IP addresses, or 'I ran X and it returned Y' — if no tool result for it",
	"exists in this conversation, you have NOT run it and you do NOT know the outcome.",
	"When you need to do something in a sandbox, emit the tool call and wait for its",
	"result; do not narrate the steps as if already done. If a tool is unavailable,",
	"say so plainly instead of pretending.",
	"Answer in the same language the user writes in.",
].join(" ");

// "discuss" mode is used for thread turns hanging off a diff card: the user is
// asking about a specific change, not asking for more edits. The agent gets a
// read-only tool set (no writeFile/editFile, no createSandbox/stopSandbox) so it
// can only inspect the snapshot and answer, never mutate files or sandboxes.
const DISCUSS_SYSTEM_PROMPT = [
	"You are a helpful AI assistant powered by DeepSeek, discussing a specific code",
	"change with the user. This is a discussion turn, so you have READ-ONLY access:",
	"getCurrentTime, and per-session Linux sandboxes for inspection only (runCommand,",
	"listSandboxes). You CANNOT create, modify, or delete files, and you CANNOT create",
	"or stop sandboxes — those tools are intentionally unavailable here. Use runCommand",
	"to look at code (e.g. 'git show <hash>:<file>', 'git diff', 'cat', 'grep') and",
	"answer the user's questions about the change. If the user wants you to actually",
	"make an edit, explain that this is a discussion and they should ask in the main",
	"conversation instead of trying to edit from here.",
	"CRITICAL: The ONLY way you learn what a command did is by calling runCommand and",
	"reading the tool result that comes back. Never invent command output, file",
	"contents, or 'I ran X and it returned Y' — if no tool result for it exists in this",
	"conversation, you have NOT run it and you do NOT know the outcome.",
	"Answer in the same language the user writes in.",
].join(" ");

/** How an agent turn runs: "build" can edit, "discuss" is read-only. */
export type AgentMode = "build" | "discuss";

// Tools available in "discuss" mode: read-only inspection only. Everything else
// (writeFile, editFile, createSandbox, stopSandbox) is withheld.
const DISCUSS_TOOLS = ["getCurrentTime", "runCommand", "listSandboxes"] as const;

// The agent's tools. Each has a zod input schema and an `execute` function.
export const tools = {
	getCurrentTime: tool({
		description:
			"Get the current date and time. Useful for any question about the current time, date, or day of the week.",
		inputSchema: z.object({
			timeZone: z
				.string()
				.optional()
				.describe("IANA time zone, e.g. 'Asia/Shanghai' or 'UTC'."),
		}),
		execute: async ({ timeZone }) => {
			const now = new Date();
			const zone = timeZone ?? "Asia/Shanghai";
			return {
				iso: now.toISOString(),
				timeZone: zone,
				formatted: now.toLocaleString("zh-CN", { timeZone: zone }),
			};
		},
	}),
};

// Sandbox tools are built per session so each chat's sandboxes stay isolated.
// `defaultImage` comes from the session's project (falling back to alpine), so a
// createSandbox call that doesn't name an image boots the project's image.
function sandboxTools(sessionId: string, defaultImage = "alpine") {
	return {
		createSandbox: tool({
			description:
				`Create an isolated Linux sandbox (microVM) in this session. Boot it before running commands. Names must be unique within the session. Defaults to the project image ('${defaultImage}') when no image is given.`,
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Sandbox name, unique in this session. Defaults to 'default'."),
				image: z
					.string()
					.optional()
					.describe(`OCI image to boot, e.g. 'alpine', 'python', 'debian'. Defaults to the project image ('${defaultImage}').`),
			}),
			execute: ({ name = "default", image = defaultImage }) =>
				createSandbox(sessionId, name, image),
		}),
		runCommand: tool({
			description:
				"Run a command inside a sandbox in this session and return its stdout, stderr, and exit code.",
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Which sandbox to run in. Defaults to 'default'."),
				command: z
					.string()
					.describe("The command line to run, e.g. 'uname -a' or 'ls /tmp'. Runs via sh -c."),
				args: z
					.array(z.string())
					.optional()
					.describe("Extra arguments appended to the command (optional)."),
				timeoutMs: z
					.number()
					.optional()
					.describe("Kill the command if it runs longer than this many ms. Defaults to 120000."),
				background: z
					.boolean()
					.optional()
					.describe("Run detached and return immediately with a PID and log path. Use this for long-running servers (vite preview, npm start, dev servers) — a foreground run would just block until the timeout kills the server you want kept alive. Inspect its output afterwards with `cat <log>`."),
			}),
			execute: ({ name = "default", command, args = [], timeoutMs, background }, { abortSignal }) =>
				runCommand(sessionId, name, command, args, timeoutMs, abortSignal, background),
		}),
		writeFile: tool({
			description:
				"Create a new file or overwrite an existing one with the given content inside a sandbox. Use this (not 'echo > file' via runCommand) whenever you create or fully rewrite a file, so the change is shown as a diff.",
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Which sandbox to write in. Defaults to 'default'."),
				path: z
					.string()
					.describe("Absolute or relative path of the file to write, e.g. '/app/main.py'."),
				content: z.string().describe("The full new content of the file."),
			}),
			execute: ({ name = "default", path, content }) =>
				writeFile(sessionId, name, path, content),
		}),
		editFile: tool({
			description:
				"Replace a snippet of text within an existing file inside a sandbox. Use this (not 'sed -i' via runCommand) for targeted edits, so the change is shown as a diff. oldString must appear in the file; it is replaced by newString.",
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Which sandbox to edit in. Defaults to 'default'."),
				path: z.string().describe("Path of the file to edit."),
				oldString: z
					.string()
					.describe("The exact existing text to replace. Must match the file."),
				newString: z.string().describe("The text to replace it with."),
				replaceAll: z
					.boolean()
					.optional()
					.describe("Replace every occurrence instead of just the first. Defaults to false."),
			}),
			execute: ({ name = "default", path, oldString, newString, replaceAll = false }) =>
				editFile(sessionId, name, path, oldString, newString, replaceAll),
		}),
		stopSandbox: tool({
			description:
				"Stop (pause) a sandbox in this session. Its files are preserved and it resumes automatically the next time you run a command in it.",
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Which sandbox to stop. Defaults to 'default'."),
			}),
			execute: ({ name = "default" }) => stopSandbox(sessionId, name),
		}),
		listSandboxes: tool({
			description:
				"List this session's sandboxes (including ones persisted from earlier runs) with their status.",
			inputSchema: z.object({}),
			execute: () => listSandboxes(sessionId),
		}),
	};
}

// Append the session's project context to the base prompt: the default sandbox
// image and any bound repositories the agent can clone on demand.
function buildSystemPrompt(project?: ProjectContext, mode: AgentMode = "build"): string {
	const base = mode === "discuss" ? DISCUSS_SYSTEM_PROMPT : SYSTEM_PROMPT;
	if (!project) return base;
	const lines = [
		base,
		"",
		`This session belongs to the project "${project.name}". New sandboxes default to the "${project.image}" image.`,
	];
	// Cloning instructions only make sense for an editing turn; a discussion
	// inspects code that is already in the sandbox at the pinned commit.
	if (mode !== "discuss" && project.repos.length > 0) {
		lines.push(
			"The project is bound to these git repositories. When you need their code,",
			"clone one into a sandbox with runCommand (e.g. `git clone <url> -b <branch>`):",
			...project.repos.map(
				(r) => `- ${r.name} — ${r.url} (branch ${r.branch})`,
			),
		);
	}
	return lines.join("\n");
}

export interface AgentEvents {
	onText: (text: string) => void;
	onReasoning: (text: string) => void;
	onToolCall: (call: { toolCallId: string; toolName: string; input: unknown }) => void;
	onToolResult: (result: { toolCallId: string; toolName: string; output: unknown }) => void;
	onError: (message: string) => void;
	onDone: () => void;
}

/**
 * Run one agent turn over the given conversation, streaming events as they
 * happen. Always resolves (errors are reported via `events.onError`) and
 * always calls `events.onDone` exactly once at the end.
 */
export async function runAgent(
	sessionId: string,
	messages: ModelMessage[],
	project: ProjectContext | undefined,
	events: AgentEvents,
	signal?: AbortSignal,
	mode: AgentMode = "build",
): Promise<void> {
	if (!process.env.DEEPSEEK_API_KEY) {
		events.onError(
			"Missing DEEPSEEK_API_KEY. Create a .env file with DEEPSEEK_API_KEY=... (see .env.example).",
		);
		events.onDone();
		return;
	}

	try {
		// In "discuss" mode the agent is read-only: keep just the inspection tools
		// so it can never write files or create/stop sandboxes.
		const allTools = { ...tools, ...sandboxTools(sessionId, project?.image) };
		const availableTools =
			mode === "discuss"
				? Object.fromEntries(
						Object.entries(allTools).filter(([name]) =>
							(DISCUSS_TOOLS as readonly string[]).includes(name),
						),
					)
				: allTools;
		const result = streamText({
			model: deepseek(MODEL),
			system: buildSystemPrompt(project, mode),
			messages,
			tools: availableTools,
			// The agentic loop: keep taking steps (model call -> tool calls ->
			// model call ...) until the model stops or we hit 50 steps.
			stopWhen: stepCountIs(50),
			abortSignal: signal,
		});

		for await (const part of result.fullStream) {
			switch (part.type) {
				case "text-delta":
					events.onText(part.text);
					break;
				case "reasoning-delta":
					events.onReasoning(part.text);
					break;
				case "tool-call":
					events.onToolCall({
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						input: part.input,
					});
					break;
				case "tool-result":
					events.onToolResult({
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: part.output,
					});
					break;
				case "tool-error":
					// A tool whose execute() threw (e.g. a sandbox that was reset, or
					// the microsandbox server being down) emits tool-error, not
					// tool-result. Surface it as the call's output so the UI row
					// completes with the error instead of hanging on "运行中".
					events.onToolResult({
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: { error: stringifyError(part.error) },
					});
					break;
				case "error":
					events.onError(stringifyError(part.error));
					break;
				default:
					break;
			}
		}
	} catch (err) {
		// A user-initiated abort isn't an error — just stop, leaving whatever
		// partial output already streamed.
		if (!signal?.aborted) events.onError(stringifyError(err));
	} finally {
		events.onDone();
	}
}

function stringifyError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}
