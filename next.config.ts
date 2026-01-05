import type { NextConfig } from "next";

// Patch for broken localStorage in Node.js environment (e.g. experimental features)
if (typeof localStorage !== "undefined" && typeof localStorage.getItem !== "function") {
	try {
		Object.defineProperty(global, "localStorage", {
			value: undefined,
			writable: true,
			configurable: true,
		});
		console.log("Patched broken global.localStorage to undefined");
	} catch (e) {
		console.warn("Failed to patch global.localStorage:", e);
	}
}

const nextConfig: NextConfig = {
	webpack: (config, { isServer }) => {
		// Fix for @ffmpeg/ffmpeg dynamic imports
		if (!isServer) {
			config.resolve.fallback = {
				...config.resolve.fallback,
				fs: false,
				path: false,
				crypto: false,
			};
		}

		// Handle FFmpeg worker files
		config.module.rules.push({
			test: /\.wasm$/,
			type: "asset/resource",
		});

		// Ignore FFmpeg in server-side rendering
		if (isServer) {
			config.externals.push("@ffmpeg/ffmpeg", "@ffmpeg/util");
		}

		return config;
	},

	// Experimental features for better compatibility
	// experimental: {
	//   esmExternals: 'loose',
	// },

	// Headers for SharedArrayBuffer (required for FFmpeg)
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: [
					{
						key: "Cross-Origin-Embedder-Policy",
						value: "require-corp",
					},
					{
						key: "Cross-Origin-Opener-Policy",
						value: "same-origin",
					},
				],
			},
		];
	},
	compiler: {
		removeConsole: true,
	},
};

export default nextConfig;
