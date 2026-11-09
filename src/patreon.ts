import { createDefaultRunner, type YtdlpRunner } from "./ytdlp.js";

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
		"%(id)s\t%(title|)s\t%(webpage_url)s",
		campaignUrl,
	]);
	return parsePostList(stdout);
}

export interface PostDetail {
	ids: string[];
	title: string;
	direct: boolean;
}

interface InfoDict {
	title?: string;
	extractor_key?: string;
	entries?: (InfoDict | null)[];
}

export const YOUTUBE_EXTRACTOR = "Youtube";

function hasDirectMedia(info: InfoDict): boolean {
	const entries = info.entries ?? [info];
	return entries.some((e) => Boolean(e?.extractor_key) && e?.extractor_key !== YOUTUBE_EXTRACTOR);
}

export function parsePostDetail(text: string): PostDetail {
	let info: InfoDict = {};
	try {
		info = (JSON.parse(text) as InfoDict | null) ?? {};
	} catch {
		info = {};
	}
	return { ids: parseYoutubeIds(text), title: info.title ?? "", direct: hasDirectMedia(info) };
}

const NO_MEDIA_RE = /No supported media found in this post/;

export function isNoMediaError(err: unknown): boolean {
	return NO_MEDIA_RE.test(err instanceof Error ? err.message : String(err));
}

export async function inspectPost(
	postUrl: string,
	cookies: string,
	runner: YtdlpRunner = createDefaultRunner(),
): Promise<PostDetail> {
	let stdout: string;
	try {
		stdout = await runner(["--cookies", cookies, "--skip-download", "--no-warnings", "-J", postUrl]);
	} catch (err) {
		if (isNoMediaError(err)) return { ids: [], title: "", direct: false };
		throw err;
	}
	return parsePostDetail(stdout);
}
