import { ChevronDown } from "lucide-react";

export interface SelectorOption {
	value: string;
	label: string;
}

// A standard styled dropdown: a native <select> stripped of its cramped browser
// chrome (appearance-none) and given the same border/padding/focus treatment as
// our text inputs, plus a consistent chevron. Reach for this instead of a raw
// <select> so every dropdown in the app reads the same.
export function Selector({
	value,
	onChange,
	options,
	className = "",
	"aria-label": ariaLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	options: SelectorOption[];
	className?: string;
	"aria-label"?: string;
}) {
	return (
		<div className={`relative ${className}`}>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				aria-label={ariaLabel}
				className="w-full appearance-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-stone-800 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition cursor-pointer"
			>
				{options.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
			<ChevronDown
				size={16}
				className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400"
				aria-hidden="true"
			/>
		</div>
	);
}
