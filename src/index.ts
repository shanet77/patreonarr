import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
	addCreator,
	listCreators,
	isSeen,
	recordSeen,
	removeCreator,
	touchChecked,
	getSeen,
} from "./db.js";
import { listPosts, extractYoutubeIds } from "./patreon.js";
import { pushToTA } from "./ta.js";

const PORT = Number(process.env.PORT ?? 8080);
const COOKIES = process.env.COOKIES_PATH ?? "/data/patreon-cookies.txt";
const POLL_MIN = Number(process.env.POLL_INTERVAL_MIN ?? 30);

let polling = false;
async function poll(): Promise<void> {
	if (polling) {
		console.log("poll already running, skipping");
		return;
	}
	polling = true;
	try {
		await pollInner();
	} finally {
		polling = false;
	}
}

async function pollInner(): Promise<void> {
	if (!existsSync(COOKIES)) {
		console.log("no cookies file yet, skipping poll");
		return;
	}
	for (const creator of listCreators()) {
		let posts;
		try {
			posts = await listPosts(creator.url, COOKIES);
		} catch (err) {
			console.log(`poll failed for ${creator.url}: ${(err as Error).message}`);
			continue;
		}
		for (const post of posts) {
			if (isSeen(post.id)) continue;
			recordSeen(post.id, "", []);
			const { ids, title } = await extractYoutubeIds(post.url, COOKIES);
			recordSeen(post.id, title || post.title, ids);
			if (!ids.length) {
				console.log(`no youtube embeds in ${post.url}`);
				continue;
			}
			try {
				await pushToTA(ids);
				console.log(`pushed ${ids.length} video(s) from "${title || post.title}"`);
			} catch (err) {
				console.log(`TA push failed: ${(err as Error).message}`);
			}
		}
		touchChecked(creator.url);
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
	"GET /api/creators": (_req, res) => json(res, 200, listCreators()),
	"POST /api/creators": async (req, res) => {
		const { url: creatorUrl } = JSON.parse((await readBody(req)).toString() || "{}") as { url?: string };
		if (!creatorUrl || !creatorUrl.startsWith("http")) {
			json(res, 400, { error: "url required, e.g. https://www.patreon.com/c/<vanity>/posts" });
			return;
		}
		addCreator(creatorUrl);
		json(res, 201, { ok: true });
	},
	"DELETE /api/creators": (req, res, url) => {
		removeCreator(url.searchParams.get("url") ?? "");
		json(res, 200, { ok: true });
	},
	"GET /api/seen": (_req, res) => json(res, 200, getSeen()),
	"POST /api/poll": (_req, res) => {
		poll().catch((err: Error) => console.log(`manual poll failed: ${err.message}`));
		json(res, 202, { ok: true });
	},
	"POST /api/cookies": async (req, res) => {
		writeFileSync(COOKIES, await readBody(req), { mode: 0o600 });
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
