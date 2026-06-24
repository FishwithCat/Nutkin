import { expect, test } from "bun:test";
import { parseNameStatus } from "./sandbox";

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
