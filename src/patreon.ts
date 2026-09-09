import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

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

export function sanitizeCookies(text: string): string {
	return text
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			if (!t || t.startsWith("#")) return true;
			const domain = t.split("\t")[0] ?? "";
			return domain === ".patreon.com" || domain === "www.patreon.com" || domain === "patreon.com";
		})
		.join("\n");
}

export function cleanCookieFile(path: string): void {
	if (!existsSync(path)) return;
	const raw = readFileSync(path, "utf8");
	const clean = sanitizeCookies(raw.endsWith("\n") ? raw : raw + "\n");
	if (clean !== raw) writeFileSync(path, clean, { mode: 0o600 });
}

export async function listPosts(campaignUrl: string, cookies: string): Promise<Post[]> {
	const { stdout } = await exec(
		"yt-dlp",
		[
			"--cookies",
			cookies,
			"--flat-playlist",
			"--no-warnings",
			"--print",
			"%(id)s\t%(title)s\t%(webpage_url)s",
			campaignUrl,
		],
		{ maxBuffer: 32 * 1024 * 1024 },
	);
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

export async function extractYoutubeIds(postUrl: string, cookies: string): Promise<PostDetail> {
	let stdout: string;
	try {
		({ stdout } = await exec(
			"yt-dlp",
			["--cookies", cookies, "--skip-download", "--no-warnings", "-J", postUrl],
			{ maxBuffer: 64 * 1024 * 1024 },
		));
	} catch {
		return { ids: [], title: "" };
	}
	return parsePostDetail(stdout);
}
