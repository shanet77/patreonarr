import { test } from "node:test";
import assert from "node:assert/strict";
import { pollOnce, type PollDeps } from "./poll.js";

function makeDeps(overrides: Partial<PollDeps> = {}): PollDeps & {
	seen: Map<string, { title: string; ids: string[] }>;
	touched: string[];
	pushed: string[][];
	logs: string[];
} {
	const seen = new Map<string, { title: string; ids: string[] }>();
	const touched: string[] = [];
	const pushed: string[][] = [];
	const logs: string[] = [];
	return {
		seen,
		touched,
		pushed,
		logs,
		store: {
			listCreators: () => [{ url: "https://www.patreon.com/c/x/posts", last_check: null }],
			isSeen: (id) => seen.has(id),
			recordSeen: (id, title, ids) => {
				seen.set(id, { title, ids });
			},
			touchChecked: (url) => {
				touched.push(url);
			},
		},
		feed: {
			listPosts: async () => [{ id: "p1", title: "Post 1", url: "https://www.patreon.com/posts/p1" }],
			extractIds: async () => ({ ids: ["dQw4w9WgXcQ"], title: "Vid" }),
		},
		pusher: {
			push: async (ids) => {
				pushed.push(ids);
			},
		},
		log: (msg) => {
			logs.push(msg);
		},
		...overrides,
	};
}

test("push success commits seen and touches creator", async () => {
	const d = makeDeps();
	const summary = await pollOnce(d);
	assert.equal(summary.pushedPosts, 1);
	assert.equal(summary.pushedVideos, 1);
	assert.deepEqual(d.seen.get("p1"), { title: "Vid", ids: ["dQw4w9WgXcQ"] });
	assert.deepEqual(d.touched, ["https://www.patreon.com/c/x/posts"]);
	assert.equal(d.pushed.length, 1);
});

test("no push → no commit, touchChecked skipped, retry succeeds", async () => {
	const d = makeDeps();
	let calls = 0;
	d.pusher.push = async (ids) => {
		calls += 1;
		if (calls === 1) throw new Error("TA down");
		d.pushed.push(ids);
	};
	const first = await pollOnce(d);
	assert.equal(first.pushedPosts, 0);
	assert.equal(first.failedPushes, 1);
	assert.equal(d.seen.has("p1"), false);
	assert.deepEqual(d.touched, []);
	const second = await pollOnce(d);
	assert.equal(second.pushedPosts, 1);
	assert.deepEqual(d.seen.get("p1"), { title: "Vid", ids: ["dQw4w9WgXcQ"] });
	assert.deepEqual(d.touched, ["https://www.patreon.com/c/x/posts"]);
});

test("no embeds commit without push but still touch", async () => {
	const d = makeDeps({
		feed: {
			listPosts: async () => [{ id: "p1", title: "Post 1", url: "https://www.patreon.com/posts/p1" }],
			extractIds: async () => ({ ids: [], title: "" }),
		},
	});
	const summary = await pollOnce(d);
	assert.equal(summary.noEmbedPosts, 1);
	assert.equal(d.pushed.length, 0);
	assert.deepEqual(d.seen.get("p1"), { title: "Post 1", ids: [] });
	assert.deepEqual(d.touched, ["https://www.patreon.com/c/x/posts"]);
});

test("already-seen posts never hit extract or push", async () => {
	const d = makeDeps();
	d.store.isSeen = () => true;
	let extracted = 0;
	d.feed.extractIds = async () => {
		extracted += 1;
		return { ids: ["dQw4w9WgXcQ"], title: "Vid" };
	};
	const summary = await pollOnce(d);
	assert.equal(summary.skippedSeen, 1);
	assert.equal(extracted, 0);
	assert.equal(d.pushed.length, 0);
	assert.equal(d.seen.size, 0);
});

test("listPosts failure skips creator without touchChecked", async () => {
	const d = makeDeps({
		feed: {
			listPosts: async () => {
				throw new Error("auth");
			},
			extractIds: async () => ({ ids: [], title: "" }),
		},
	});
	const summary = await pollOnce(d);
	assert.deepEqual(summary.failedCreators, ["https://www.patreon.com/c/x/posts"]);
	assert.deepEqual(d.touched, []);
});

test("cookies missing skips whole poll", async () => {
	const d = makeDeps({ cookiesReady: () => false });
	let listed = false;
	d.store.listCreators = () => {
		listed = true;
		return [];
	};
	const summary = await pollOnce(d);
	assert.equal(listed, false);
	assert.equal(summary.creators, 0);
	assert.match(d.logs[0], /no cookies file/);
});
