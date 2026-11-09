import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDownloadArgs, createMediaDownloader, parseDownloadedFiles, ytdlpErrorMessage } from "./download.js";

const CONFIG = { dir: "/downloads", template: "%(uploader)s/%(title)s [%(id)s].%(ext)s", autostart: false };

test("buildDownloadArgs skips youtube entries and prints final paths", () => {
	const args = buildDownloadArgs(CONFIG, "/c.txt", "https://www.patreon.com/posts/1");
	assert.deepEqual(args.slice(0, 2), ["--cookies", "/c.txt"]);
	assert.equal(args[args.indexOf("--match-filter") + 1], "extractor_key!=Youtube");
	assert.equal(args[args.indexOf("--paths") + 1], "/downloads");
	assert.equal(args[args.indexOf("--output") + 1], CONFIG.template);
	assert.equal(args[args.indexOf("--print") + 1], "after_move:filepath");
	assert.equal(args.at(-1), "https://www.patreon.com/posts/1");
});

test("parseDownloadedFiles trims, drops blanks, dedupes", () => {
	assert.deepEqual(parseDownloadedFiles("/d/a.mp4\n\n/d/b.mp4  \n/d/a.mp4\n"), ["/d/a.mp4", "/d/b.mp4"]);
	assert.deepEqual(parseDownloadedFiles(""), []);
});

test("createMediaDownloader runs yt-dlp through the injected runner", async () => {
	const calls: string[][] = [];
	const downloader = createMediaDownloader(CONFIG, "/c.txt", async (args) => {
		calls.push(args);
		return "/downloads/Astrogoblin/x [1].mp4\n";
	});
	assert.deepEqual(await downloader.download("https://www.patreon.com/posts/1"), ["/downloads/Astrogoblin/x [1].mp4"]);
	assert.deepEqual(calls, [buildDownloadArgs(CONFIG, "/c.txt", "https://www.patreon.com/posts/1")]);
});

test("createMediaDownloader surfaces only the yt-dlp error line", async () => {
	const downloader = createMediaDownloader(CONFIG, "/c.txt", async () => {
		throw new Error("Command failed: yt-dlp --cookies /c.txt\nERROR: [patreon] 1: You do not have access to this post\n");
	});
	await assert.rejects(downloader.download("https://www.patreon.com/posts/1"), {
		message: "ERROR: [patreon] 1: You do not have access to this post",
	});
});

test("ytdlpErrorMessage falls back to the first line without an ERROR line", () => {
	assert.equal(ytdlpErrorMessage(new Error("spawn yt-dlp ENOENT")), "spawn yt-dlp ENOENT");
	assert.equal(ytdlpErrorMessage(new Error("Command failed\nERROR: a\nERROR: b")), "ERROR: b");
});
