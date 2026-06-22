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
	listSandboxes,
	runCommand,
	stopSandbox,
} from "./sandbox";

// Bun auto-loads .env, so DEEPSEEK_API_KEY is picked up automatically by the
// provider. Override the model with DEEPSEEK_MODEL (e.g. "deepseek-reasoner").
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

const SYSTEM_PROMPT = [
	"You are a helpful AI assistant powered by DeepSeek.",
	"You can call tools to get the current time or evaluate arithmetic.",
	"You can also create isolated Linux sandboxes (microVMs, default image 'alpine')",
	"with createSandbox, run shell commands inside them with runCommand, and stop",
	"them with stopSandbox. Sandboxes are scoped to this chat session and are reset",
	"when the app restarts — create one before running commands.",
	"Use a tool whenever it gives a more accurate answer than guessing.",
	"Answer in the same language the user writes in.",
].join(" ");

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
	calculate: tool({
		description:
			"Evaluate a basic arithmetic expression using +, -, *, /, and parentheses.",
		inputSchema: z.object({
			expression: z
				.string()
				.describe("The arithmetic expression, e.g. '(12 + 8) * 3'."),
		}),
		execute: async ({ expression }) => {
			if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
				return { error: "Only basic arithmetic (+ - * / and parentheses) is allowed." };
			}
			try {
				const result = Function(`"use strict"; return (${expression});`)();
				if (typeof result !== "number" || !Number.isFinite(result)) {
					return { error: "Expression did not evaluate to a finite number." };
				}
				return { expression, result };
			} catch (err) {
				return { error: `Could not evaluate: ${String(err)}` };
			}
		},
	}),
};

// Sandbox tools are built per session so each chat's sandboxes stay isolated.
function sandboxTools(sessionId: string) {
	return {
		createSandbox: tool({
			description:
				"Create an isolated Linux sandbox (microVM) in this session. Boot it before running commands. Names must be unique within the session.",
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Sandbox name, unique in this session. Defaults to 'default'."),
				image: z
					.string()
					.optional()
					.describe("OCI image to boot, e.g. 'alpine', 'python', 'debian'. Defaults to 'alpine'."),
			}),
			execute: ({ name = "default", image = "alpine" }) =>
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
			}),
			execute: ({ name = "default", command, args = [], timeoutMs }, { abortSignal }) =>
				runCommand(sessionId, name, command, args, timeoutMs, abortSignal),
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
	events: AgentEvents,
	signal?: AbortSignal,
): Promise<void> {
	if (!process.env.DEEPSEEK_API_KEY) {
		events.onError(
			"Missing DEEPSEEK_API_KEY. Create a .env file with DEEPSEEK_API_KEY=... (see .env.example).",
		);
		events.onDone();
		return;
	}

	try {
		const result = streamText({
			model: deepseek(MODEL),
			system: SYSTEM_PROMPT,
			messages,
			tools: { ...tools, ...sandboxTools(sessionId) },
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
