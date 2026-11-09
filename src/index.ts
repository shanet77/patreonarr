import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { openStore } from "./db.js";
import { listPosts, inspectPost } from "./patreon.js";
import { createMediaDownloader } from "./download.js";
import { createTAPusher } from "./ta.js";
import { pollOnce } from "./poll.js";
import { drainQueue } from "./queue.js";
import { loadConfig, isTAConfigured, cleanCookieFile, writeCookiesFile } from "./config.js";

const config = loadConfig();
const { port: PORT, pollMin: POLL_MIN, cookiesPath: COOKIES } = config;

const store = openStore(config.dbPath);
const pusher = createTAPusher(config.ta);
const downloader = createMediaDownloader(config.download, COOKIES);
const interrupted = store.requeueInterrupted();
if (interrupted) {
	console.log(`requeued ${interrupted} download(s) interrupted by restart`);
}
if (!isTAConfigured(config.ta)) {
	console.log("TA not configured, pushes will be skipped until TA_HOST and TA_API_TOKEN are set");
}

let polling = false;
async function poll(): Promise<void> {
	if (polling) {
		console.log("poll already running, skipping");
		return;
	}
	polling = true;
	try {
		await pollOnce({
			store,
			feed: {
				listPosts: (url) => listPosts(url, COOKIES),
				inspect: (url) => inspectPost(url, COOKIES),
			},
			pusher,
			cookiesReady: () => existsSync(COOKIES),
			prepareCookies: () => cleanCookieFile(COOKIES),
		});
	} finally {
		polling = false;
	}
	if (config.download.autostart) {
		await runDownloads();
	}
}

let downloading = false;
async function runDownloads(only?: ReadonlySet<string>): Promise<void> {
	if (downloading) {
		console.log("downloads already running, skipping");
		return;
	}
	downloading = true;
	try {
		cleanCookieFile(COOKIES);
		await drainQueue({ store, downloader }, only);
	} finally {
		downloading = false;
	}
}

function json(res: ServerResponse, code: number, body: unknown): void {
	res.setHeader("Content-Type", "application/json");
	res.statusCode = code;
	res.end(JSON.stringify(body));
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

const routes: Record<string, Handler> = {
	"GET /api/health": (_req, res) => json(res, 200, { ok: true }),
	"GET /api/creators": (_req, res) => json(res, 200, store.listCreators()),
	"POST /api/creators": async (req, res) => {
		const { url: creatorUrl } = JSON.parse((await readBody(req)).toString() || "{}") as { url?: string };
		if (!creatorUrl || !creatorUrl.startsWith("http")) {
			json(res, 400, { error: "url required, e.g. https://www.patreon.com/c/<vanity>/posts" });
			return;
		}
		store.addCreator(creatorUrl);
		json(res, 201, { ok: true });
	},
	"DELETE /api/creators": (req, res, url) => {
		store.removeCreator(url.searchParams.get("url") ?? "");
		json(res, 200, { ok: true });
	},
	"GET /api/seen": (_req, res) => json(res, 200, store.getSeen()),
	"POST /api/poll": (_req, res) => {
		poll().catch((err: Error) => console.log(`manual poll failed: ${err.message}`));
		json(res, 202, { ok: true });
	},
	"GET /api/downloads": (_req, res) => json(res, 200, { running: downloading, items: store.listDownloads() }),
	"POST /api/downloads/start": async (req, res) => {
		const { post_id: postId } = JSON.parse((await readBody(req)).toString() || "{}") as { post_id?: string };
		if (postId && !store.retryDownload(postId)) {
			json(res, 409, { error: "download is not queued or failed" });
			return;
		}
		runDownloads(postId ? new Set([postId]) : undefined).catch((err: Error) =>
			console.log(`downloads failed: ${err.message}`),
		);
		json(res, 202, { ok: true });
	},
	"DELETE /api/downloads": (_req, res, url) => {
		store.removeDownload(url.searchParams.get("post_id") ?? "");
		json(res, 200, { ok: true });
	},
	"POST /api/cookies": async (req, res) => {
		const raw = (await readBody(req)).toString();
		writeCookiesFile(COOKIES, raw);
		json(res, 200, { ok: true });
	},
	"GET /": (_req, res) => {
		res.setHeader("Content-Type", "text/html");
		res.end(readFileSync(new URL("./public.html", import.meta.url)));
	},
};

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://x");
	const handler = routes[`${req.method} ${url.pathname}`];
	try {
		if (!handler) {
			json(res, 404, { error: "not found" });
			return;
		}
		await handler(req, res, url);
	} catch (err) {
		json(res, 500, { error: (err as Error).message });
	}
});

server.listen(PORT, () => {
	console.log(`bridge on :${PORT}, polling every ${POLL_MIN}m`);
	setInterval(() => poll().catch((err: Error) => console.log(`poll failed: ${err.message}`)), POLL_MIN * 60 * 1000);
	poll().catch((err: Error) => console.log(`initial poll failed: ${err.message}`));
});
