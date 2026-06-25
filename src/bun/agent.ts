// DeepSeek agent built on the Vercel AI SDK.
//
// This is the "agent" core: a model + a set of tools + a multi-step loop.
// `streamText` with `stopWhen: stepCountIs(N)` lets the model call tools,
// observe their results, and keep going until it produces a final answer
// (or hits the step budget). Everything runs in the Bun process so the
// DEEPSEEK_API_KEY never reaches the renderer.
import { createDeepSeek } from "@ai-sdk/deepseek";
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
import type {
	AppSettings,
	Knowledge,
	KnowledgeType,
	ProjectRepo,
	SessionSandbox,
} from "../shared/rpc";

/** Project context for a session: id + default sandbox image + bound repositories. */
export interface ProjectContext {
	id: string;
	name: string;
	image: string;
	repos: ProjectRepo[];
}

// DeepSeek config lives in global 系统设置 (app_state), passed in per turn. The
// model is optional and falls back to this default.
const DEFAULT_MODEL = "deepseek-v4-pro";

const WEB_MAX = 20_000;
const cap = (s: string) => (s.length > WEB_MAX ? `${s.slice(0, WEB_MAX)}\n…[truncated]` : s);

// ponytail: naive tag-strip — drops <script>/<style>, removes tags, collapses
// whitespace. Good enough for reading docs; swap in a real HTML parser if pages
// need structure (tables, code blocks) preserved.
export function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n\s*\n+/g, "\n\n")
		.trim();
}

const SYSTEM_PROMPT = [
	"You are a helpful AI assistant powered by DeepSeek with access to tools:",
	"getCurrentTime, webFetch (read a URL as plain text), and per-session Linux sandboxes",
	"(createSandbox, runCommand, writeFile, editFile, stopSandbox, listSandboxes). Each tool's own description",
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
	"When you discover a project convention, architecture decision, background fact, or",
	"domain term worth keeping for later, proactively call addKnowledge to record it.",
	"Entries you add are saved as PENDING REVIEW and only join the active knowledge base",
	"once a human approves them, so don't hesitate — over-recording is harmless. Record",
	"only durable facts about the project itself; NEVER put sandbox or session details",
	"(sandbox names, images, commands you ran, transient build/run output) in knowledge —",
	"those are ephemeral and don't belong there.",
	"Answer in the same language the user writes in.",
].join(" ");

// "discuss" mode is used for thread turns hanging off a diff card: the user is
// asking about a specific change, not asking for more edits. The agent gets a
// read-only tool set (no writeFile/editFile, no createSandbox/stopSandbox) so it
// can only inspect the snapshot and answer, never mutate files or sandboxes.
const DISCUSS_SYSTEM_PROMPT = [
	"You are a helpful AI assistant powered by DeepSeek, discussing a specific code",
	"change with the user. This is a discussion turn, so you have READ-ONLY access:",
	"getCurrentTime, webFetch (read a URL as plain text), and per-session Linux sandboxes for",
	"inspection only (runCommand, listSandboxes). You CANNOT create, modify, or delete files, and you CANNOT create",
	"or stop sandboxes — those tools are intentionally unavailable here. Use runCommand",
	"to look at code (e.g. 'git show <hash>:<file>', 'git diff', 'cat', 'grep') and",
	"answer the user's questions about the change. When the user wants the discussed",
	"code refactored, rewritten, restructured, or optimized, call the `refactor` tool",
	"with a clear instruction — it hands the work to the session's main build",
	"conversation where the edit is actually made — then briefly confirm to the user",
	"that the refactor has been queued there. For anything else you stay read-only and",
	"must not attempt to edit from here.",
	"CRITICAL: The ONLY way you learn what a command did is by calling runCommand and",
	"reading the tool result that comes back. Never invent command output, file",
	"contents, or 'I ran X and it returned Y' — if no tool result for it exists in this",
	"conversation, you have NOT run it and you do NOT know the outcome.",
	"When you discover a project convention, architecture decision, background fact, or",
	"domain term worth keeping for later, proactively call addKnowledge to record it.",
	"Entries you add are saved as PENDING REVIEW and only join the active knowledge base",
	"once a human approves them, so don't hesitate — over-recording is harmless. Record",
	"only durable facts about the project itself; NEVER put sandbox or session details",
	"(sandbox names, images, commands you ran, transient build/run output) in knowledge —",
	"those are ephemeral and don't belong there.",
	"Answer in the same language the user writes in.",
].join(" ");

/** How an agent turn runs: "build" can edit, "discuss" is read-only. */
export type AgentMode = "build" | "discuss";

// Tools available in "discuss" mode: read-only inspection only. Everything else
// (writeFile, editFile, createSandbox, stopSandbox) is withheld.
const DISCUSS_TOOLS = ["getCurrentTime", "runCommand", "listSandboxes", "refactor", "webFetch", "addKnowledge"] as const;

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
	// Available only in "discuss" mode. The discuss-agent is read-only, so it can't
	// edit the code it's discussing. This tool hands a refactor request off to the
	// session's main build conversation: the UI watches for the call and fires a real
	// build turn that does the editing. Execute just echoes the instruction — the
	// dispatch happens UI-side (the instruction also rides the tool-call event).
	refactor: tool({
		description:
			"Hand off a refactor/rewrite/optimization request for the code under discussion to the session's main build conversation, where it will be carried out as a real editing turn. Call this when the user asks to refactor, rewrite, restructure, or optimize the discussed code (not for questions). Do NOT try to edit here — you are read-only.",
		inputSchema: z.object({
			instruction: z
				.string()
				.describe(
					"A clear, self-contained instruction for the build agent: what to change and the goal/constraints. The file, line range, and snapshot commit are attached automatically — don't restate them.",
				),
		}),
		execute: async ({ instruction }) => ({ queued: true, instruction }),
	}),
	webFetch: tool({
		description:
			"Fetch a URL over HTTP(S) and return its content as plain text (HTML tags stripped). " +
			"Use this to read documentation, API responses, or web pages. Returns { url, status, " +
			"contentType, text }. Long pages are truncated. Only http/https URLs are allowed.",
		inputSchema: z.object({
			url: z.string().url().describe("The absolute http(s) URL to fetch."),
		}),
		execute: async ({ url }) => {
			const u = new URL(url);
			if (u.protocol !== "http:" && u.protocol !== "https:") {
				return { error: `Unsupported protocol: ${u.protocol}` };
			}
			const res = await fetch(url, {
				redirect: "follow",
				headers: { "user-agent": "Nutkin-Agent" },
				signal: AbortSignal.timeout(15_000),
			});
			const contentType = res.headers.get("content-type") ?? "";
			const raw = await res.text();
			const text = /html/i.test(contentType) ? htmlToText(raw) : raw;
			return { url: res.url, status: res.status, contentType, text: cap(text) };
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
				`Create an isolated Linux sandbox (microVM) in this session. Boot it before running commands. Names must be unique within the session. Defaults to the project image ('${defaultImage}') when no image is given. IMPORTANT: before creating, check the sandboxes already listed in your system prompt and REUSE an existing one by its exact name (just runCommand in it) instead of creating a duplicate for the same purpose.`,
			inputSchema: z.object({
				name: z
					.string()
					.optional()
					.describe("Sandbox name, unique in this session. Defaults to 'default'."),
				image: z
					.string()
					.optional()
					.describe(`OCI image to boot, e.g. 'alpine', 'python', 'debian'. Defaults to the project image ('${defaultImage}').`),
				description: z
					.string()
					.optional()
					.describe("Short description of what this sandbox is for, e.g. 'Vite frontend dev server'. Recorded so later turns reuse it instead of creating a duplicate."),
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

// Lets the agent file a piece of project knowledge. It's always written as
// reviewed:false so it lands in the 待审核 queue — a human approves it before it
// joins the active KB. `save` is injected so agent.ts stays DB-agnostic.
function knowledgeTool(projectId: string, save: (k: Knowledge) => void) {
	return {
		addKnowledge: tool({
			description:
				"Record a piece of durable project knowledge (a convention, architecture decision, background fact, or domain term) into the project's knowledge base. The entry is saved as PENDING REVIEW — a human must approve it before the agent learns it or it is cited in reviews. Call this whenever you uncover something worth keeping for later. Only record facts about the project itself — NEVER sandbox or session details (sandbox names, images, commands you ran, transient build/run output); those are ephemeral and do not belong in the knowledge base.",
			inputSchema: z.object({
				title: z.string().describe("Short title for the entry, e.g. 'Money is stored in cents'."),
				description: z
					.string()
					.describe("The knowledge itself, in Markdown. Be specific and self-contained."),
				type: z
					.enum(["background", "architecture", "convention", "glossary"])
					.describe(
						"Category: 'background', 'architecture', 'convention', or 'glossary'.",
					),
			}),
			execute: async ({ title, description, type }) => {
				const entry: Knowledge = {
					id: crypto.randomUUID(),
					projectId,
					title,
					description,
					type: type as KnowledgeType,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					isAvailable: true,
					reviewed: false,
				};
				save(entry);
				return { saved: true, status: "pending-review", id: entry.id, title, type };
			},
		}),
	};
}

// Append the session's project context to the base prompt: the default sandbox
// image and any bound repositories the agent can clone on demand.
function buildSystemPrompt(
	project?: ProjectContext,
	mode: AgentMode = "build",
	sandboxes: SessionSandbox[] = [],
	knowledge: Knowledge[] = [],
): string {
	const base = mode === "discuss" ? DISCUSS_SYSTEM_PROMPT : SYSTEM_PROMPT;
	const lines = [base];
	if (project) {
		lines.push(
			"",
			`This session belongs to the project "${project.name}". New sandboxes default to the "${project.image}" image.`,
		);
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
	}
	// Existing sandboxes, so the agent reuses them by name instead of spawning a
	// duplicate (or guessing a slightly different name and orphaning the old one).
	if (sandboxes.length > 0) {
		lines.push(
			"",
			"This session already has these sandboxes — reuse them by their exact name",
			"instead of creating new ones for the same purpose:",
			...sandboxes.map(
				(s) => `- ${s.name}${s.description ? ` — ${s.description}` : ""}`,
			),
		);
	}
	// Approved knowledge base — established facts the human has reviewed and
	// signed off on. The agent should trust these rather than re-deriving them.
	// ponytail: whole approved KB inlined into the prompt; add relevance ranking
	// or a token cap if the KB grows past what fits the context window.
	if (knowledge.length > 0) {
		lines.push(
			"",
			"This project has an approved knowledge base. Treat these as established",
			"facts about the project — follow them without re-deriving or second-guessing.",
			"Each entry is dated; prefer more recent knowledge if two entries conflict:",
			...knowledge.map(
				(k) =>
					`- [${k.type}] (updated ${new Date(k.updatedAt).toISOString().slice(0, 10)}) ${k.title}: ${k.description}`,
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
	sandboxes: SessionSandbox[] = [],
	saveKnowledge?: (k: Knowledge) => void,
	knowledge: Knowledge[] = [],
	settings: AppSettings = { deepseekApiKey: "", deepseekModel: "" },
): Promise<void> {
	const apiKey = settings.deepseekApiKey.trim();
	if (!apiKey) {
		events.onError("缺少 LLM API Key, 请在系统设置中配置。");
		events.onDone();
		return;
	}
	const deepseek = createDeepSeek({ apiKey });
	const modelId = settings.deepseekModel.trim() || DEFAULT_MODEL;

	try {
		// In "discuss" mode the agent is read-only: keep just the inspection tools
		// so it can never write files or create/stop sandboxes.
		const allTools = {
			...tools,
			...sandboxTools(sessionId, project?.image),
			// Only offer addKnowledge when we know the project and have a sink to save to.
			...(project?.id && saveKnowledge ? knowledgeTool(project.id, saveKnowledge) : {}),
		};
		const availableTools =
			mode === "discuss"
				? Object.fromEntries(
						Object.entries(allTools).filter(([name]) =>
							(DISCUSS_TOOLS as readonly string[]).includes(name),
						),
					)
				: allTools;
		const result = streamText({
			model: deepseek(modelId),
			system: buildSystemPrompt(project, mode, sandboxes, knowledge),
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
