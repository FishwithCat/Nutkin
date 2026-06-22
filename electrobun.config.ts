import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "react-tailwind-vite",
		identifier: "reacttailwindvite.electrobun.dev",
		version: "0.0.1",
	},
	build: {
		// microsandbox is a native NAPI module — it can't be bundled into the flat
		// app file. Keep it external and ship the package + its native binary next
		// to the bundled bun process so `require("microsandbox")` resolves at runtime.
		bun: {
			external: ["microsandbox"],
		},
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"node_modules/microsandbox": "bun/node_modules/microsandbox",
			"node_modules/@superradcompany": "bun/node_modules/@superradcompany",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
