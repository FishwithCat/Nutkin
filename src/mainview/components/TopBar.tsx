export function TopBar() {
	return (
		<header className="flex items-center gap-3 px-5 h-14 border-b border-stone-200 bg-white shrink-0">
			<div className="w-8 h-8 rounded-lg bg-clay-500 flex items-center justify-center text-white font-bold text-sm">
				N
			</div>
			<span className="font-semibold text-stone-900">Nutkin</span>
			<span className="text-stone-300">|</span>
			<span className="text-sm text-stone-500">Agent</span>
		</header>
	);
}
