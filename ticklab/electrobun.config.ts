import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "TickLab",
		identifier: "dev.ticklab.app",
		version: "0.1.0",
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			// Next.js static export, served over local HTTP by the Bun backend.
			"web/out": "web/out",
		},
		mac: {
			bundleCEF: false,
			// .iconset → .icns via iconutil at build time (requires macOS).
			icons: "assets/icon.iconset",
		},
		linux: {
			bundleCEF: false,
			// Desktop entry, window icon, and taskbar (PNG ≥ 256px).
			icon: "assets/icon.png",
		},
		win: {
			bundleCEF: false,
			// PNG input is converted to ICO by Hutch (installer, shortcuts, taskbar).
			icon: "assets/icon.png",
		},
	},
} satisfies ElectrobunConfig;
