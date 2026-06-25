// Pure text transforms behind the Markdown editor toolbar. Kept free of React/DOM
// so the selection math can be unit-tested (see mdToolbar.test.ts).

export type MdAction = "heading" | "bold" | "italic" | "list" | "code" | "link";

export interface MdResult {
	text: string;
	selStart: number;
	selEnd: number;
}

/** Apply a toolbar action to `text` over the selection [start, end). */
export function applyMd(
	text: string,
	start: number,
	end: number,
	action: MdAction,
): MdResult {
	const sel = text.slice(start, end);

	// Wrap the selection in `mark` on both sides; empty selection drops the
	// caret between the marks.
	const wrap = (mark: string): MdResult => {
		const at = start + mark.length;
		return {
			text: text.slice(0, start) + mark + sel + mark + text.slice(end),
			selStart: at,
			selEnd: sel ? end + mark.length : at,
		};
	};

	// Prefix every line the selection touches (grows left to the line start).
	const prefixLines = (prefix: string): MdResult => {
		const lineStart = text.lastIndexOf("\n", start - 1) + 1;
		const block = text.slice(lineStart, Math.max(end, lineStart));
		const replaced = block
			.split("\n")
			.map((l) => prefix + l)
			.join("\n");
		return {
			text: text.slice(0, lineStart) + replaced + text.slice(end),
			selStart: lineStart,
			selEnd: lineStart + replaced.length,
		};
	};

	switch (action) {
		case "bold":
			return wrap("**");
		case "italic":
			return wrap("*");
		case "code":
			if (sel.includes("\n")) {
				const fenced = "```\n" + sel + "\n```";
				return {
					text: text.slice(0, start) + fenced + text.slice(end),
					selStart: start + 4,
					selEnd: start + 4 + sel.length,
				};
			}
			return wrap("`");
		case "heading":
			return prefixLines("## ");
		case "list":
			return prefixLines("- ");
		case "link": {
			const label = sel || "文本";
			const inserted = `[${label}](url)`;
			const urlAt = start + label.length + 3; // [label](  -> url
			return {
				text: text.slice(0, start) + inserted + text.slice(end),
				selStart: urlAt,
				selEnd: urlAt + 3,
			};
		}
	}
}
