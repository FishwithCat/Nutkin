import { expect, test } from "bun:test";
import { applyMd } from "./mdToolbar";

test("bold wraps a selection and keeps it selected", () => {
	const r = applyMd("hello world", 6, 11, "bold");
	expect(r.text).toBe("hello **world**");
	expect(r.text.slice(r.selStart, r.selEnd)).toBe("world");
});

test("bold on empty selection drops caret between marks", () => {
	const r = applyMd("ab", 1, 1, "italic");
	expect(r.text).toBe("a**b");
	expect(r.selStart).toBe(r.selEnd);
	expect(r.selStart).toBe(2);
});

test("heading prefixes the whole line, not just the selection", () => {
	const r = applyMd("title here", 6, 10, "heading");
	expect(r.text).toBe("## title here");
});

test("list prefixes every selected line", () => {
	const r = applyMd("a\nb\nc", 0, 5, "list");
	expect(r.text).toBe("- a\n- b\n- c");
});

test("code fences a multiline selection and selects the inner text", () => {
	const r = applyMd("x\ny", 0, 3, "code");
	expect(r.text).toBe("```\nx\ny\n```");
	expect(r.text.slice(r.selStart, r.selEnd)).toBe("x\ny");
});

test("link selects the url placeholder", () => {
	const r = applyMd("see foo", 4, 7, "link");
	expect(r.text).toBe("see [foo](url)");
	expect(r.text.slice(r.selStart, r.selEnd)).toBe("url");
});
