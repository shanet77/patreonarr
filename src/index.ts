import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { openStore } from "./db.js";
import { listPosts, extractYoutubeIds, sanitizeCookies, cleanCookieFile } from "./patreon.js";
import { createTAPusher, isTAConfigured, resolveTAConfig } from "./ta.js";
import { pollOnce } from "./poll.js";

const PORT = Number(process.env.PORT ?? 8080);
const COOKIES = process.env.COOKIES_PATH ?? "/data/patreon-cookies.txt";
const POLL_MIN = Number(process.env.POLL_INTERVAL_MIN ?? 30);

const store = openStore();
const taConfig = resolveTAConfig(process.env);
const pusher = createTAPusher(taConfig);
if (!isTAConfigured(taConfig)) {
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
				extractIds: (url) => extractYoutubeIds(url, COOKIES),
			},
			pusher,
			cookiesReady: () => existsSync(COOKIES),
			prepareCookies: () => cleanCookieFile(COOKIES),
		});
	} finally {
		polling = false;
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
	"POST /api/cookies": async (req, res) => {
		const raw = (await readBody(req)).toString();
		writeFileSync(COOKIES, sanitizeCookies(raw.endsWith("\n") ? raw : raw + "\n"), { mode: 0o600 });
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
