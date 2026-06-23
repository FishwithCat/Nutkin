import { memo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternal } from "../rpc";

// Tailwind-styled element map for react-markdown. The preflight reset strips
// default heading/list/table styling, so each tag is restyled to match the
// stone/clay palette used across the chat UI.
const markdownComponents: Components = {
	h1: ({ children }) => (
		<h1 className="text-base font-bold text-stone-900 mt-4 mb-2 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="text-base font-semibold text-stone-900 mt-4 mb-2 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-sm font-semibold text-stone-900 mt-3 mb-1.5 first:mt-0">
			{children}
		</h3>
	),
	p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
	ul: ({ children }) => (
		<ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>
	),
	li: ({ children }) => <li className="marker:text-stone-400">{children}</li>,
	a: ({ href, children }) => (
		<a
			href={href}
			// WKWebView won't open target="_blank" itself; route clicks through the
			// Bun process, which opens the link in the system default browser.
			onClick={(e) => {
				e.preventDefault();
				if (href) openExternal(href);
			}}
			className="text-clay-600 underline underline-offset-2 hover:text-clay-700 cursor-pointer"
		>
			{children}
		</a>
	),
	strong: ({ children }) => (
		<strong className="font-semibold text-stone-900">{children}</strong>
	),
	blockquote: ({ children }) => (
		<blockquote className="my-2 border-l-2 border-stone-300 pl-3 text-stone-600 italic">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-3 border-stone-200" />,
	code: ({ className, children }) => {
		// Inline code has no language class and no newline; block code is wrapped
		// in <pre> below, so here we only need to style the inline variant. A
		// fenced block without a language tag still has no `language-` class, so
		// fall back to detecting the multi-line content to avoid styling it as an
		// orange inline chip inside the dark <pre>.
		const isBlock =
			/language-/.test(className ?? "") || /\n/.test(String(children));
		if (isBlock) {
			return <code className={className}>{children}</code>;
		}
		return (
			<code className="rounded bg-stone-100 px-1 py-0.5 text-[0.85em] font-mono text-clay-700">
				{children}
			</code>
		);
	},
	pre: ({ children }) => (
		<pre className="my-2 overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs leading-relaxed text-stone-100">
			{children}
		</pre>
	),
	table: ({ children }) => (
		<div className="my-2 overflow-x-auto">
			<table className="w-full border-collapse text-xs">{children}</table>
		</div>
	),
	th: ({ children }) => (
		<th className="border border-stone-200 bg-stone-50 px-2 py-1 text-left font-semibold">
			{children}
		</th>
	),
	td: ({ children }) => (
		<td className="border border-stone-200 px-2 py-1 align-top">{children}</td>
	),
};

// Memoized so a streaming token only re-parses the message it changed, not
// every Markdown block already on screen.
export const Markdown = memo(function Markdown({
	children,
}: { children: string }) {
	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
			{children}
		</ReactMarkdown>
	);
});
