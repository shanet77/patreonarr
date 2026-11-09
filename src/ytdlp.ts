import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type YtdlpRunner = (args: string[]) => Promise<string>;

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

export function createDefaultRunner(): YtdlpRunner {
	return async (args) => {
		const { stdout } = await exec("yt-dlp", args, { maxBuffer: DEFAULT_MAX_BUFFER });
		return stdout;
	};
}
