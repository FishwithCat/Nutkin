import { expect, test } from "bun:test";
import { htmlToText } from "./agent";

test("htmlToText strips scripts, styles, and tags", () => {
	const html =
		`<html><head><style>p{color:red}</style></head>` +
		`<body><script>alert(1)</script><p>Hello&nbsp;<b>world</b></p></body></html>`;
	const out = htmlToText(html);
	expect(out).toContain("Hello world");
	expect(out).not.toContain("alert");
	expect(out).not.toContain("color:red");
	expect(out).not.toContain("<");
});
