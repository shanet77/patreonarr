import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Seam for tests: takes full yt-dlp argv, resolves with stdout. */
export type YtdlpRunner = (args: string[]) => Promise<string>;

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

function createDefaultRunner(): YtdlpRunner {
	return async (args) => {
		const { stdout } = await exec("yt-dlp", args, { maxBuffer: DEFAULT_MAX_BUFFER });
		return stdout;
	};
}

export interface Post {
	id: string;
	title: string;
	url: string;
}

const YT_RE =
	/(?:youtube\.com\/(?:watch\?[^"'\s]*?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/g;

export function parsePostList(stdout: string): Post[] {
	return stdout
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => {
			const [id, title, url] = line.split("\t");
			return { id, title: title ?? "", url: url ?? "" };
		})
		.filter((p) => p.id && p.url);
}

export function parseYoutubeIds(text: string): string[] {
	const ids = new Set<string>();
	for (const m of text.matchAll(YT_RE)) ids.add(m[1]);
	return [...ids];
}

export async function listPosts(
	campaignUrl: string,
	cookies: string,
	runner: YtdlpRunner = createDefaultRunner(),
): Promise<Post[]> {
	const stdout = await runner([
		"--cookies",
		cookies,
		"--flat-playlist",
		"--no-warnings",
		"--print",
		"%(id)s\t%(title)s\t%(webpage_url)s",
		campaignUrl,
	]);
	return parsePostList(stdout);
}

export interface PostDetail {
	ids: string[];
	title: string;
}

export function parsePostDetail(text: string): PostDetail {
	let title = "";
	try {
		title = (JSON.parse(text) as { title?: string }).title ?? "";
	} catch {
		title = "";
	}
	return { ids: parseYoutubeIds(text), title };
}

export async function extractYoutubeIds(
	postUrl: string,
	cookies: string,
	runner: YtdlpRunner = createDefaultRunner(),
): Promise<PostDetail> {
	const stdout = await runner([
		"--cookies",
		cookies,
		"--skip-download",
		"--no-warnings",
		"-J",
		postUrl,
	]);
	return parsePostDetail(stdout);
}
