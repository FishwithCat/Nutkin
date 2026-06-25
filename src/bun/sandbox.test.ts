import { expect, test } from "bun:test";
import { capPair, HostTimeoutError, parseNameStatus, withTimeout } from "./sandbox";

// A change buried past the 10k cap must survive: a blind prefix cap would leave
// both sides identical (diff shows nothing). capPair drops the shared head/tail.
test("capPair keeps a change buried past the cap", () => {
	const head = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
	const old = `${head}\nOLD VALUE`;
	const neu = `${head}\nNEW VALUE`;
	const { oldText, newText, truncated } = capPair(old, neu);
	expect(truncated).toBe(true);
	expect(oldText).toContain("OLD VALUE");
	expect(newText).toContain("NEW VALUE");
	expect(oldText).not.toEqual(newText);
});

test("capPair leaves small files untouched", () => {
	expect(capPair("a\nb", "a\nc")).toEqual({ oldText: "a\nb", newText: "a\nc" });
});

// git diff --name-status maps letters → our status; rename/copy lines carry the
// destination path as the last tab field.
test("parseNameStatus maps A/M/D and renames", () => {
	const out = [
		"A\tsrc/new.ts",
		"M\tsrc/app.ts",
		"D\tsrc/old.ts",
		"R100\tsrc/from.ts\tsrc/to.ts",
		"", // blank line ignored
	].join("\n");
	expect(parseNameStatus(out)).toEqual([
		{ status: "added", path: "src/new.ts" },
		{ status: "modified", path: "src/app.ts" },
		{ status: "deleted", path: "src/old.ts" },
		{ status: "modified", path: "src/to.ts" },
	]);
});

// The fix for the hung writeFile: a wedged fs RPC must reject, not block forever.
// The fuse must reject with HostTimeoutError specifically, so withSandbox can tell
// a wedge (retry) from a relay-delivered error like the guest's ExecTimeoutError
// (don't retry — re-running just doubles the wait).
test("withTimeout rejects a hung op with HostTimeoutError, passes a fast one through", async () => {
	await expect(withTimeout(new Promise(() => {}), 20, "fs op")).rejects.toBeInstanceOf(
		HostTimeoutError,
	);
	expect(await withTimeout(Promise.resolve(42), 1000, "fs op")).toBe(42);
	// A delivered rejection passes through untouched — NOT turned into a HostTimeoutError.
	const guestTimeout = new Error("exec timed out after 120s");
	await expect(withTimeout(Promise.reject(guestTimeout), 1000, "exec")).rejects.toBe(guestTimeout);
});
