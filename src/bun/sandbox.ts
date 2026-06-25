// Per-session microVM sandboxes, backed by the `microsandbox` SDK.
//
// Each chat session can hold several named sandboxes. The agent creates them
// explicitly and runs commands inside them. microsandbox persists each sandbox
// (its rootfs) on the host under ~/.microsandbox/, so sandboxes — and the files
// written into them — survive an app restart. The in-memory map below only
// caches handles to sandboxes we've started this run; anything not cached is
// re-attached lazily from disk by `reattach()`.
import { Sandbox, allSandboxMetrics } from "microsandbox";
import type { ReviewEntry, ReviewFileContent, ReviewStatus, SandboxInfo } from "../shared/rpc";

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

// Cap a before/after pair for the UI diff. A blind prefix cap hides the change
// when it sits past MAX_OUTPUT (e.g. package-lock.json: both sides identical in
// the first 10k → diff shows nothing). So drop the shared head/tail lines first,
// keeping a little context, so whatever budget is left lands on the actual diff.
// ponytail: line numbers restart at 1 in truncated files; fine for lockfile noise.
export function capPair(
	oldText: string,
	newText: string,
): Omit<ReviewFileContent, "commitHash"> {
	if (oldText.length <= MAX_OUTPUT && newText.length <= MAX_OUTPUT) {
		return { oldText, newText };
	}
	const o = oldText.split("\n");
	const n = newText.split("\n");
	let p = 0;
	while (p < o.length && p < n.length && o[p] === n[p]) p++;
	let s = 0;
	while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s++;
	const ctx = 3;
	const head = Math.max(0, p - ctx);
	const tail = Math.max(0, s - ctx);
	const oTrim = o.slice(head, o.length - tail).join("\n");
	const nTrim = n.slice(head, n.length - tail).join("\n");
	return { oldText: cap(oTrim), newText: cap(nTrim), truncated: true };
}

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
const DEFAULT_TIMEOUT_MS = 30_000;

export async function runCommand(
	sessionId: string,
	name: string,
	command: string,
	args: string[] = [],
	timeoutMs = DEFAULT_TIMEOUT_MS,
	signal?: AbortSignal,
	background = false,
) {
	const sandbox = await ensure(sessionId, name);
	if (!sandbox) {
		return {
			error: `No sandbox named "${name}" in this session. Create one with createSandbox first.`,
		};
	}
	const script = [command, ...args].join(" ");

	// Detached: launch inside the VM and return the PID + log path immediately, so
	// a long-running server (vite preview, npm start) keeps running instead of
	// blocking the tool until its timeout fires and kills the very process we want.
	if (background) {
		const log = `/tmp/nutkin-bg-${Date.now()}.log`;
		const detached = `nohup sh -c ${shq(script)} > ${shq(log)} 2>&1 & echo $!`;
		const exec = await sandbox.execWith("sh", (b) =>
			b.args(["-c", detached]).timeout(10_000),
		);
		return {
			background: true,
			pid: exec.stdout().trim(),
			log,
			hint: `Started in background. Inspect output with: cat ${log}`,
		};
	}

	// Run through the VM's shell so "uname -a", pipes, and && parse correctly —
	// exec() treats the whole string as one executable name and hangs if it's
	// not a real file. The timeout kills a runaway process instead of blocking.
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

// Race a sandbox op against the abort signal so 中止 returns at once instead of
// waiting for the (uncancellable) RPC to finish. ponytail: the RPC keeps running
// host-side until it resolves; only the await returns early.
function raceAbort<T>(op: Promise<T>, signal?: AbortSignal): Promise<T> {
	return signal ? Promise.race([op, rejectOnAbort(signal)]) : op;
}

// Read a file's contents from a sandbox, or null if it doesn't exist. Native fs
// RPC — no shell spawn, no base64 round trip.
async function readFileRaw(
	sandbox: Sandbox,
	path: string,
	signal?: AbortSignal,
): Promise<string | null> {
	const read = sandbox.fs().readToString(path).catch(() => null); // missing / unreadable
	return raceAbort(read, signal);
}

// Write content to a file in a sandbox, creating parent dirs. Native fs RPC.
async function writeFileRaw(
	sandbox: Sandbox,
	path: string,
	content: string,
	signal?: AbortSignal,
): Promise<void> {
	const fs = sandbox.fs();
	const dir = path.replace(/\/[^/]*$/, ""); // dirname; "" for a bare/leading-slash name
	if (dir && dir !== path) await raceAbort(fs.mkdir(dir).catch(() => {}), signal); // may exist
	await raceAbort(fs.write(path, content), signal);
}

// Create or overwrite a file with the given content. Returns the before/after
// text (capped) so the UI can render a diff, plus whether the file is new.
export async function writeFile(
	sessionId: string,
	name: string,
	path: string,
	content: string,
	signal?: AbortSignal,
) {
	const sandbox = await ensure(sessionId, name);
	if (!sandbox) {
		return {
			error: `No sandbox named "${name}" in this session. Create one with createSandbox first.`,
		};
	}
	const oldText = await readFileRaw(sandbox, path, signal);
	await writeFileRaw(sandbox, path, content, signal);
	return { path, created: oldText === null, ...capPair(oldText ?? "", content) };
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
	signal?: AbortSignal,
) {
	const sandbox = await ensure(sessionId, name);
	if (!sandbox) {
		return {
			error: `No sandbox named "${name}" in this session. Create one with createSandbox first.`,
		};
	}
	const oldText = await readFileRaw(sandbox, path, signal);
	if (oldText === null) {
		return { error: `No such file "${path}" in sandbox "${name}".` };
	}
	if (!oldText.includes(oldString)) {
		return { error: `oldString not found in ${path}.` };
	}
	const newText = replaceAll
		? oldText.split(oldString).join(newString)
		: oldText.replace(oldString, newString);
	await writeFileRaw(sandbox, path, newText, signal);
	return { path, ...capPair(oldText, newText) };
}

// --- Per-turn git snapshots ------------------------------------------------
//
// After a turn edits files we commit each touched repo so a diff card can later
// be discussed against an immutable whole-repo state: the commit hash lets the
// agent `git show <hash>:<file>` to look at related code at that exact moment.

export interface ChangedFile {
	sandboxName: string;
	path: string;
}
export interface CommitInfo {
	path: string;
	sandboxName: string;
	repoRoot: string;
	commitHash: string;
}

// Identity flags inlined per-commit so we never touch the VM's global git config.
const GIT_ID = "-c user.email=nutkin@local -c user.name=Nutkin";

async function sh(sandbox: Sandbox, script: string): Promise<{ code: number; out: string }> {
	const exec = await sandbox.execWith("sh", (b) =>
		b.args(["-c", script]).timeout(DEFAULT_TIMEOUT_MS),
	);
	return { code: exec.code, out: exec.stdout().trim() };
}

// alpine ships without git. ponytail: apk-only — for non-alpine images bake git
// into the image instead of installing it on first use.
async function ensureGit(sandbox: Sandbox): Promise<void> {
	const has = await sh(sandbox, "command -v git >/dev/null 2>&1 && echo y || echo n");
	if (has.out !== "y") await sh(sandbox, "apk add --no-cache git >/dev/null 2>&1 || true");
}

// Repo root containing `path`, initialising one at the file's directory if the
// file isn't tracked yet. ponytail: per-dir init can fragment nested projects;
// steer the agent to `git init` project roots to keep snapshots coarse.
async function repoRoot(sandbox: Sandbox, path: string): Promise<string> {
	const dir = `$(dirname ${shq(path)})`;
	const top = await sh(sandbox, `git -C ${dir} rev-parse --show-toplevel 2>/dev/null`);
	if (top.code === 0 && top.out) return top.out;
	await sh(sandbox, `mkdir -p ${dir} && git -C ${dir} init -q`);
	const again = await sh(sandbox, `git -C ${dir} rev-parse --show-toplevel 2>/dev/null`);
	return again.out;
}

// Stage everything and commit. --allow-empty so a turn that only touched
// already-committed content still yields a hash to anchor against. Returns the
// new HEAD, or null if the repo root is unknown / the commit failed.
async function commitRepo(sandbox: Sandbox, root: string): Promise<string | null> {
	if (!root) return null;
	const r = shq(root);
	// Anchor a session-start baseline on the first commit, before we stage anything,
	// so Review All can diff against the pre-Nutkin state even with no upstream. Set
	// once (later turns see the ref and skip): existing HEAD for a cloned/non-empty
	// repo, else the empty tree for a freshly-`init`'d dir so every file reads as
	// added. Always planting it also marks the repo as one Nutkin tracks, which is
	// what reviewList uses to include no-remote repos.
	const hasBase = await sh(sandbox, `git -C ${r} rev-parse --verify -q ${BASE_REF}`);
	if (!hasBase.out) {
		const head = await sh(sandbox, `git -C ${r} rev-parse --verify -q HEAD`);
		await sh(sandbox, `git -C ${r} update-ref ${BASE_REF} ${head.out || EMPTY_TREE}`);
	}
	await sh(sandbox, `git -C ${r} add -A`);
	await sh(sandbox, `git -C ${r} ${GIT_ID} commit -q --allow-empty -m "nutkin turn"`);
	const head = await sh(sandbox, `git -C ${r} rev-parse HEAD 2>/dev/null`);
	return head.code === 0 && head.out ? head.out : null;
}

// Commit each repo a turn touched (one commit per sandbox+repo, all its files
// share the hash). Best-effort: a file we can't commit just yields no CommitInfo
// and its card's discussion stays disabled.
export async function commitChanges(
	sessionId: string,
	changes: ChangedFile[],
): Promise<CommitInfo[]> {
	const bySandbox = new Map<string, string[]>();
	for (const c of changes) {
		const list = bySandbox.get(c.sandboxName) ?? [];
		list.push(c.path);
		bySandbox.set(c.sandboxName, list);
	}
	const out: CommitInfo[] = [];
	for (const [sandboxName, paths] of bySandbox) {
		const sandbox = await ensure(sessionId, sandboxName);
		if (!sandbox) continue;
		await ensureGit(sandbox);
		const repoOf = new Map<string, string>();
		for (const p of paths) repoOf.set(p, await repoRoot(sandbox, p));
		const hashOf = new Map<string, string | null>();
		for (const root of new Set(repoOf.values())) {
			hashOf.set(root, await commitRepo(sandbox, root));
		}
		for (const p of paths) {
			const root = repoOf.get(p) ?? "";
			const hash = hashOf.get(root);
			if (hash) out.push({ path: p, sandboxName, repoRoot: root, commitHash: hash });
		}
	}
	return out;
}

// --- Push review ------------------------------------------------------------
//
// "Ready to Push" shows every change a session made, across all its sandboxes,
// as a net diff per repo. We discover the repos by scanning the sandbox for
// `.git` dirs (so a repo cloned/built purely via runCommand is found too, not
// just ones an edit tool touched), then diff each against its upstream.

// git's empty-tree object: diffing against it makes every tracked file read as
// added, the right base for a repo with no upstream to compare against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// Ref marking a repo's session-start state — the diff base for repos with no
// upstream, and the signal that this is a repo Nutkin is actually tracking.
const BASE_REF = "refs/nutkin/base";

// Map a `git diff --name-status` letter to our status. Renames/copies (R/C) are
// reported as their destination path, so treat them as a modification.
function mapStatus(letter: string): ReviewStatus {
	if (letter === "A") return "added";
	if (letter === "D") return "deleted";
	return "modified"; // M, R*, C*, T, …
}

// Parse `git diff --name-status` output into {status, path} rows.
// ponytail: line/tab split, not -z. Switch to -z if paths with newlines bite.
export function parseNameStatus(out: string): { status: ReviewStatus; path: string }[] {
	const rows: { status: ReviewStatus; path: string }[] = [];
	for (const line of out.split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split("\t");
		const letter = parts[0]?.[0] ?? "";
		// Renames/copies are "R100\told\tnew" — the destination is the last field.
		const path = parts[parts.length - 1];
		if (!letter || !path) continue;
		rows.push({ status: mapStatus(letter), path });
	}
	return rows;
}

// Find git repo roots inside a sandbox: every `.git` dir under `/`, pruning the
// virtual/irrelevant trees (proc/sys/dev) and node_modules so it stays fast, with
// a depth cap as a backstop. Searching from `/` (not a guessed list of roots)
// avoids missing a repo the agent put somewhere unexpected.
// ponytail: depth 7 from /. Raise it if a deeply-nested repo is missed.
async function findRepos(sandbox: Sandbox): Promise<string[]> {
	const script =
		"find / -maxdepth 7 \\( -path /proc -o -path /sys -o -path /dev -o -name node_modules \\) -prune " +
		"-o -type d -name .git -print 2>/dev/null";
	const r = await sh(sandbox, script);
	const repos = new Set<string>();
	for (const line of r.out.split("\n")) {
		const dir = line.trim();
		if (dir.endsWith("/.git")) repos.add(dir.slice(0, -"/.git".length) || "/");
	}
	return [...repos];
}

// Read a path at a git ref via stdout, base64'd so binary-ish content survives
// the shell. Empty string when the path doesn't exist at that ref (added/deleted).
async function showAt(sandbox: Sandbox, root: string, ref: string, path: string): Promise<string> {
	const r = shq(root);
	const exec = await sandbox.execWith("sh", (b) =>
		b.args(["-c", `git -C ${r} show ${shq(`${ref}:${path}`)} 2>/dev/null | base64`]).timeout(DEFAULT_TIMEOUT_MS),
	);
	if (exec.code !== 0) return "";
	return Buffer.from(exec.stdout(), "base64").toString("utf8");
}

// The ref a repo is reviewed against: its upstream if the branch has one, else
// our session-start baseline, else git's empty tree (so every file reads as added).
async function resolveBase(sandbox: Sandbox, root: string): Promise<string> {
	const r = shq(root);
	const res = await sh(
		sandbox,
		`git -C ${r} rev-parse --verify -q '@{u}' || git -C ${r} rev-parse --verify -q ${BASE_REF} || echo ${EMPTY_TREE}`,
	);
	return res.out.trim() || EMPTY_TREE;
}

// The list of changed files across a session's sandboxes — no per-file content,
// so it's cheap (one name-status per repo). Falls back to all of the session's
// sandboxes when the caller passes none.
export async function reviewList(
	sessionId: string,
	sandboxNames: string[],
): Promise<ReviewEntry[]> {
	let names = sandboxNames;
	if (names.length === 0) {
		const listed = await listSandboxes(sessionId);
		names = listed.sandboxes.map((s) => s.name);
	}
	const out: ReviewEntry[] = [];
	for (const name of names) {
		const sandbox = await ensure(sessionId, name);
		if (!sandbox) continue;
		for (const root of await findRepos(sandbox)) {
			// Include a repo if it has a remote (a real push target) OR our baseline
			// ref (a repo Nutkin committed to — works for non-git/no-remote projects).
			// Stray `git init`s the agent leaves in system dirs (e.g. editing /etc) have
			// neither unless we committed there, so they stay filtered out.
			const r = shq(root);
			const remotes = await sh(sandbox, `git -C ${r} remote`);
			const hasBase = await sh(sandbox, `git -C ${r} rev-parse --verify -q ${BASE_REF}`);
			if (!remotes.out.trim() && !hasBase.out.trim()) continue;
			const base = await resolveBase(sandbox, root);
			const names2 = await sh(sandbox, `git -C ${r} diff --name-status ${base} HEAD`);
			for (const { status, path } of parseNameStatus(names2.out)) {
				out.push({ sandboxName: name, repoRoot: root, path, status });
			}
		}
	}
	return out;
}

// The before/after text for one reviewed file, fetched when the user opens it.
// A path missing at a ref (added/deleted) reads back as empty, so we just fetch
// both sides unconditionally.
export async function reviewFile(
	sessionId: string,
	sandboxName: string,
	repoRoot: string,
	path: string,
): Promise<ReviewFileContent> {
	const sandbox = await ensure(sessionId, sandboxName);
	if (!sandbox) return { oldText: "", newText: "", commitHash: "" };
	const base = await resolveBase(sandbox, repoRoot);
	const oldText = await showAt(sandbox, repoRoot, base, path);
	const newText = await showAt(sandbox, repoRoot, "HEAD", path);
	// HEAD's hash lets a review diff anchor a discussion (`newText` is read from it).
	const head = await sh(sandbox, `git -C ${shq(repoRoot)} rev-parse HEAD`);
	return { ...capPair(oldText, newText), commitHash: head.out.trim() };
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

// Pull the image ref out of a sandbox's config JSON. Shape is
// {"image":{"Oci":{"reference":"python",...}}}. "" when not found.
function imageFromConfig(configJson: string): string {
	try {
		const cfg = JSON.parse(configJson) as { image?: { Oci?: { reference?: string } } };
		return cfg.image?.Oci?.reference ?? "";
	} catch {
		// malformed/absent config — fall through to ""
		return "";
	}
}

// Every sandbox in the whole instance, split back into {sessionId, name} and
// enriched with image, timestamps, and live metrics. The global 沙箱管理 page
// uses this to monitor and clean up sandboxes across all sessions. Friendly
// names can contain "__", so split on the FIRST separator only. Returns the raw
// fields; index.ts adds sessionTitle/projectName from the DB.
type RawSandbox = Omit<SandboxInfo, "sessionTitle" | "projectName">;
export async function listAllSandboxes(): Promise<RawSandbox[]> {
	// list() rejects when the microsandbox server isn't up (e.g. nothing created
	// yet) — treat that as "no sandboxes" so the admin page doesn't hang.
	// allSandboxMetrics() covers only running sandboxes (stopped ones have no
	// live stats), keyed by full VM name; one call for all of them.
	const [all, metrics] = await Promise.all([
		Sandbox.list().catch(() => []),
		allSandboxMetrics().catch(() => ({} as Awaited<ReturnType<typeof allSandboxMetrics>>)),
	]);
	return all.map((h) => {
		const i = h.name.indexOf("__");
		const sessionId = i === -1 ? "" : h.name.slice(0, i);
		const name = i === -1 ? h.name : h.name.slice(i + 2);
		const m = metrics[h.name];
		return {
			sessionId,
			name,
			status: h.status,
			image: imageFromConfig(h.configJson),
			createdAt: h.createdAt ? h.createdAt.getTime() : null,
			updatedAt: h.updatedAt ? h.updatedAt.getTime() : null,
			cpuPercent: m ? m.cpuPercent : null,
			memoryBytes: m ? m.memoryBytes : null,
			memoryLimitBytes: m ? m.memoryLimitBytes : null,
			uptimeMs: m ? m.uptimeMs : null,
		};
	});
}

// The captured output log for one sandbox (exec.log), newest 500 lines. Readable
// without starting the sandbox, so it works for stopped ones too.
export async function sandboxLogs(sessionId: string, name: string): Promise<string> {
	try {
		const handle = await Sandbox.get(vmName(sessionId, name));
		const entries = await handle.logs({ tail: 500 });
		return entries.map((e) => e.text()).join("");
	} catch {
		return "";
	}
}

// Permanently delete one sandbox (its rootfs too). The single-sandbox version of
// removeSessionSandboxes, for the 沙箱管理 page. Best-effort: a sandbox already
// gone or wedged is ignored.
export async function removeSandbox(sessionId: string, name: string): Promise<void> {
	const b = sessions.get(sessionId);
	const cached = b?.get(name);
	if (cached) {
		images.delete(cached);
		b?.delete(name);
	}
	try {
		const handle = await Sandbox.get(vmName(sessionId, name));
		if (handle.status === "running") await handle.stop(); // remove() needs it stopped
		await Sandbox.remove(handle.name);
	} catch {
		// already gone or wedged — nothing to do
	}
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
