import { expect, test } from "bun:test";
import { capPair, parseNameStatus } from "./sandbox";

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
