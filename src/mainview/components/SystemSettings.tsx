import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound } from "lucide-react";
import type { AppSettings } from "../../shared/rpc";
import { loadSettings, saveSettings } from "../rpc";

// 系统设置: a full-screen, app-level (global) settings page. Scope is the whole
// instance, not a project. For now it holds one section — 模型与 API Key — where
// the DeepSeek API key and model live (moved here out of .env). The mockup's
// other sections (通用/默认运行镜像/凭据与集成/存储与限额) are not built yet.
export function SystemSettings({ onClose }: { onClose: () => void }) {
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	// The last-saved values, so we can show/enable "放弃更改" only when dirty.
	const [saved, setSaved] = useState<AppSettings>({ deepseekApiKey: "", deepseekModel: "" });

	useEffect(() => {
		loadSettings().then((s) => {
			setSaved(s);
			setApiKey(s.deepseekApiKey);
			setModel(s.deepseekModel);
		});
	}, []);

	const dirty = apiKey !== saved.deepseekApiKey || model !== saved.deepseekModel;

	function submit() {
		const next: AppSettings = { deepseekApiKey: apiKey.trim(), deepseekModel: model.trim() };
		saveSettings(next);
		setSaved(next);
		setApiKey(next.deepseekApiKey);
		setModel(next.deepseekModel);
	}

	function revert() {
		setApiKey(saved.deepseekApiKey);
		setModel(saved.deepseekModel);
	}

	return (
		<div className="flex flex-col h-screen bg-stone-100 text-stone-800">
			<header className="flex items-center gap-3 px-6 h-16 bg-white border-b border-stone-200 shrink-0">
				<button
					type="button"
					onClick={onClose}
					className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition"
				>
					<ArrowLeft size={16} aria-hidden="true" />
					返回
				</button>
				<span className="font-semibold text-stone-900">系统设置</span>
			</header>

			<div className="flex-1 flex min-h-0">
				{/* Left nav. Only one entry for now; add rows here as sections land. */}
				<nav className="w-56 shrink-0 border-r border-stone-200 bg-white px-3 py-5">
					<p className="px-2 mb-2 text-xs font-medium text-stone-400">系统设置</p>
					<button
						type="button"
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium bg-clay-50 text-clay-700"
					>
						<KeyRound size={15} aria-hidden="true" />
						模型与 API Key
					</button>
				</nav>

				<div className="flex-1 overflow-y-auto">
					<div className="max-w-2xl mx-auto px-8 py-10 space-y-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2 className="text-lg font-semibold text-stone-900">模型与 API Key</h2>
								<p className="mt-1 text-sm text-stone-500">
									DeepSeek 凭据作用于整个实例，所有项目共用。
								</p>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								<button
									type="button"
									onClick={revert}
									disabled={!dirty}
									className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
								>
									放弃更改
								</button>
								<button
									type="button"
									onClick={submit}
									disabled={!dirty}
									className="rounded-xl bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
								>
									保存
								</button>
							</div>
						</div>

						<div>
							<label className="block text-sm font-medium text-stone-700 mb-1.5">
								DeepSeek API Key
							</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="sk-…"
								autoComplete="off"
								className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
							/>
						</div>

						<div>
							<label className="block text-sm font-medium text-stone-700 mb-1.5">
								DeepSeek 模型
							</label>
							<p className="-mt-1 mb-2 text-xs text-stone-400">
								留空则使用默认 deepseek-v4-pro
							</p>
							<input
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder="如: deepseek-v4-pro"
								className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none focus:border-clay-400 focus:ring-1 focus:ring-clay-200 transition"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
