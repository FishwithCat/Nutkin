// Per-session microVM sandboxes, backed by the `microsandbox` SDK.
//
// Each chat session can hold several named sandboxes. The agent creates them
// explicitly and runs commands inside them. microsandbox persists each sandbox
// (its rootfs) on the host under ~/.microsandbox/, so sandboxes — and the files
// written into them — survive an app restart. The in-memory map below only
// caches handles to sandboxes we've started this run; anything not cached is
// re-attached lazily from disk by `reattach()`.
import { Sandbox } from "microsandbox";

// sessionId -> friendly name -> running sandbox (this run only; rebuilt lazily)
const sessions = new Map<string, Map<string, Sandbox>>();
// remember the image each sandbox booted from, for listSandboxes()
const images = new Map<Sandbox, string>();

// Sandbox names are global within the runtime, so namespace by session.
const vmName = (sessionId: string, name: string) => `${sessionId}__${name}`;

// Cap each stream so a chatty command can't blow up the model context / sqlite.
const MAX_OUTPUT = 10_000;
const cap = (s: string) =>
	s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s;

function bucket(sessionId: string): Map<string, Sandbox> {
	let b = sessions.get(sessionId);
	if (!b) {
		b = new Map();
		sessions.set(sessionId, b);
	}
	return b;
}

// Re-attach to an existing on-disk sandbox (any status) and return a *running*
// Sandbox ready to exec, or null if no such sandbox exists. `start()` throws on
// an already-running sandbox, so a running orphan (e.g. left by a crash) is first
// stopped — stop preserves the rootfs — then started fresh so we get a handle.
async function reattach(sessionId: string, name: string): Promise<Sandbox | null> {
	const vm = vmName(sessionId, name);
	let handle: Awaited<ReturnType<typeof Sandbox.get>>;
	try {
		handle = await Sandbox.get(vm);
	} catch {
		return null; // not found on disk
	}
	if (handle.status === "running") await handle.stop();
	return await Sandbox.start(vm);
}

export async function createSandbox(
	sessionId: string,
	name: string,
	image = "alpine",
) {
	const b = bucket(sessionId);
	if (b.has(name)) {
		return { error: `A sandbox named "${name}" already exists in this session.` };
	}
	// Same name left on disk by a previous run? Adopt it instead of failing.
	const existing = await reattach(sessionId, name);
	if (existing) {
		b.set(name, existing);
		images.set(existing, image);
		return { name, image, status: "running" as const, reconnected: true };
	}
	const sandbox = await Sandbox.builder(vmName(sessionId, name))
		.image(image)
		.create();
	b.set(name, sandbox);
	images.set(sandbox, image);
	return { name, image, status: "running" as const };
}

async function ensure(sessionId: string, name: string): Promise<Sandbox | null> {
	const cached = sessions.get(sessionId)?.get(name);
	if (cached) return cached;
	// Not cached — try to re-attach to a sandbox persisted by a previous run.
	const sandbox = await reattach(sessionId, name);
	if (sandbox) {
		bucket(sessionId).set(name, sandbox);
		images.set(sandbox, "unknown");
	}
	return sandbox;
}

// Backstop so a command that never exits can't hang the tool call forever.
const DEFAULT_TIMEOUT_MS = 120_000;

export async function runCommand(
	sessionId: string,
	name: string,
	command: string,
	args: string[] = [],
	timeoutMs = DEFAULT_TIMEOUT_MS,
	signal?: AbortSignal,
) {
	const sandbox = await ensure(sessionId, name);
	if (!sandbox) {
		return {
			error: `No sandbox named "${name}" in this session. Create one with createSandbox first.`,
		};
	}
	// Run through the VM's shell so "uname -a", pipes, and && parse correctly —
	// exec() treats the whole string as one executable name and hangs if it's
	// not a real file. The timeout kills a runaway process instead of blocking.
	const script = [command, ...args].join(" ");
	const exec = sandbox.execWith("sh", (b) =>
		b.args(["-c", script]).timeout(timeoutMs),
	);
	// Race against the abort so clicking 中止 returns at once instead of waiting
	// for the command to finish. ponytail: the VM process keeps running until its
	// own timeout — wire microsandbox cancellation in if that resource use bites.
	if (signal) exec.catch(() => {}); // if abort wins the race, don't leak a rejection
	const out = signal ? await Promise.race([exec, rejectOnAbort(signal)]) : await exec;
	return {
		stdout: cap(out.stdout()),
		stderr: cap(out.stderr()),
		code: out.code,
	};
}

// Shell-quote a single argument by wrapping in single quotes and escaping any
// embedded single quote. Safe for arbitrary file paths.
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

// Read a file's contents from a sandbox, or null if it doesn't exist. Uses
// base64 on the wire so binary-ish / multibyte content survives the shell.
async function readFileRaw(sandbox: Sandbox, path: string): Promise<string | null> {
	const exec = await sandbox.execWith("sh", (b) =>
		b.args(["-c", `base64 ${shq(path)}`]).timeout(DEFAULT_TIMEOUT_MS),
	);
	if (exec.code !== 0) return null; // missing file / not readable
	return Buffer.from(exec.stdout(), "base64").toString("utf8");
}

// Write content to a file in a sandbox, creating parent dirs. Pipes the bytes
// in as base64 so arbitrary content (quotes, newlines, unicode) lands intact.
async function writeFileRaw(sandbox: Sandbox, path: string, content: string): Promise<void> {
	const b64 = Buffer.from(content, "utf8").toString("base64");
	const script = `mkdir -p "$(dirname ${shq(path)})" && printf %s ${shq(b64)} | base64 -d > ${shq(path)}`;
	const exec = await sandbox.execWith("sh", (b) =>
		b.args(["-c", script]).timeout(DEFAULT_TIMEOUT_MS),
	);
	if (exec.code !== 0) {
		throw new Error(exec.stderr() || `failed to write ${path} (exit ${exec.code})`);
	}
}

// Create or overwrite a file with the given content. Returns the before/after
// text (capped) so the UI can render a diff, plus whether the file is new.
export async function writeFile(
	sessionId: string,
	name: string,
	path: string,
	content: string,
) {
	const sandbox = await ensure(sessionId, name);
	if (!sandbox) {
		return {
			error: `No sandbox named "${name}" in this session. Create one with createSandbox first.`,
		};
	}
	const oldText = await readFileRaw(sandbox, path);
	await writeFileRaw(sandbox, path, content);
	const truncated = content.length > MAX_OUTPUT || (oldText?.length ?? 0) > MAX_OUTPUT;
	return {
		path,
		created: oldText === null,
		oldText: cap(oldText ?? ""),
		newText: cap(content),
		...(truncated ? { truncated: true } : {}),
	};
}

// Replace a substring within an existing file. Returns before/after text for the
// diff. Errors if the file is missing or oldString isn't found.
export async function editFile(
	sessionId: string,
	name: string,
	path: string,
	oldString: string,
	newString: string,
	replaceAll = false,
) {
	const sandbox = await ensure(sessionId, name);
	if (!sandbox) {
		return {
			error: `No sandbox named "${name}" in this session. Create one with createSandbox first.`,
		};
	}
	const oldText = await readFileRaw(sandbox, path);
	if (oldText === null) {
		return { error: `No such file "${path}" in sandbox "${name}".` };
	}
	if (!oldText.includes(oldString)) {
		return { error: `oldString not found in ${path}.` };
	}
	const newText = replaceAll
		? oldText.split(oldString).join(newString)
		: oldText.replace(oldString, newString);
	await writeFileRaw(sandbox, path, newText);
	const truncated = oldText.length > MAX_OUTPUT || newText.length > MAX_OUTPUT;
	return {
		path,
		oldText: cap(oldText),
		newText: cap(newText),
		...(truncated ? { truncated: true } : {}),
	};
}

// A promise that rejects when the signal aborts, so it can lose a Promise.race
// against a long-running exec.
function rejectOnAbort(signal: AbortSignal): Promise<never> {
	if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
	return new Promise((_, reject) => {
		signal.addEventListener(
			"abort",
			() => reject(new DOMException("Aborted", "AbortError")),
			{ once: true },
		);
	});
}

// Stop (pause) a sandbox. Its rootfs is preserved on disk, so a later
// runCommand/createSandbox re-attaches and resumes it with contents intact.
export async function stopSandbox(sessionId: string, name: string) {
	const b = sessions.get(sessionId);
	const cached = b?.get(name);
	if (cached) {
		await cached.stop();
		b?.delete(name);
		images.delete(cached);
		return { name, status: "stopped" as const };
	}
	// Not cached but may exist on disk (e.g. after a restart).
	try {
		const handle = await Sandbox.get(vmName(sessionId, name));
		if (handle.status === "running") await handle.stop();
		return { name, status: "stopped" as const };
	} catch {
		return { error: `No sandbox named "${name}" in this session.` };
	}
}

// List every sandbox belonging to this session — including ones persisted on
// disk by a previous run — with their current status.
export async function listSandboxes(sessionId: string) {
	const prefix = `${sessionId}__`;
	const all = await Sandbox.list();
	return {
		sandboxes: all
			.filter((h) => h.name.startsWith(prefix))
			.map((h) => ({ name: h.name.slice(prefix.length), status: h.status })),
	};
}

// Permanently delete every sandbox belonging to a session (its rootfs too).
// Called when a chat is deleted, so persisted sandboxes don't pile up on disk.
export async function removeSessionSandboxes(sessionId: string): Promise<void> {
	const b = sessions.get(sessionId);
	if (b) {
		for (const sandbox of b.values()) images.delete(sandbox);
		sessions.delete(sessionId);
	}
	const prefix = `${sessionId}__`;
	const all = await Sandbox.list().catch(() => []);
	await Promise.all(
		all
			.filter((h) => h.name.startsWith(prefix))
			.map(async (h) => {
				try {
					if (h.status === "running") await h.stop(); // remove() needs it stopped
					await Sandbox.remove(h.name);
				} catch {
					// best-effort: ignore a sandbox that's already gone or wedged
				}
			}),
	);
}

// Best-effort graceful stop of this run's sandboxes on app shutdown. Uses stop
// (not remove), so rootfs contents are preserved for the next launch.
export async function stopAllSandboxes(): Promise<void> {
	const all: Promise<unknown>[] = [];
	for (const b of sessions.values()) {
		for (const sandbox of b.values()) all.push(sandbox.stop().catch(() => {}));
	}
	sessions.clear();
	images.clear();
	await Promise.all(all);
}
