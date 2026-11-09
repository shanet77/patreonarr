import type { DownloadConfig } from "./config.js";
import { YOUTUBE_EXTRACTOR } from "./patreon.js";
import { createDefaultRunner, type YtdlpRunner } from "./ytdlp.js";

export interface MediaDownloader {
	download(postUrl: string): Promise<string[]>;
}

export function buildDownloadArgs(config: DownloadConfig, cookies: string, postUrl: string): string[] {
	return [
		"--cookies",
		cookies,
		"--no-warnings",
		"--match-filter",
		`extractor_key!=${YOUTUBE_EXTRACTOR}`,
		"--paths",
		config.dir,
		"--output",
		config.template,
		"--embed-metadata",
		"--print",
		"after_move:filepath",
		postUrl,
	];
}

export function parseDownloadedFiles(stdout: string): string[] {
	return [...new Set(stdout.split("\n").map((line) => line.trim()).filter(Boolean))];
}

export function ytdlpErrorMessage(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	const lines = message.split("\n").map((line) => line.trim());
	return lines.filter((line) => line.startsWith("ERROR:")).at(-1) ?? lines[0] ?? message;
}

export function createMediaDownloader(
	config: DownloadConfig,
	cookies: string,
	runner: YtdlpRunner = createDefaultRunner(),
): MediaDownloader {
	return {
		async download(postUrl: string): Promise<string[]> {
			let stdout: string;
			try {
				stdout = await runner(buildDownloadArgs(config, cookies, postUrl));
			} catch (err) {
				throw new Error(ytdlpErrorMessage(err));
			}
			return parseDownloadedFiles(stdout);
		},
	};
}
