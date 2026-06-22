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
