/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				// Terracotta/clay accent used across the Nutkin UI.
				clay: {
					50: "#fdf6f3",
					100: "#fae8e1",
					200: "#f3cabb",
					300: "#eaa78f",
					400: "#df8064",
					500: "#d97757",
					600: "#c25c3c",
					700: "#a2492f",
					800: "#833e2a",
					900: "#6c3626",
				},
			},
		},
	},
	plugins: [],
};
