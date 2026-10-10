import { test } from "node:test";
import assert from "node:assert/strict";
import { pollOnce, type PollDeps } from "./poll.js";
import { createMemoryStore, type Store } from "./db.js";

const CREATOR = "https://www.patreon.com/c/x/posts";

function makeDeps(overrides: Omit<Partial<PollDeps>, "store"> = {}): Omit<PollDeps, "store"> & {
	store: Store;
	pushed: string[][];
	logs: string[];
} {
	const store = createMemoryStore();
	store.addCreator(CREATOR);
	const pushed: string[][] = [];
	const logs: string[] = [];
	return {
		store,
		pushed,
		logs,
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
	assert.deepEqual(d.store.getSeen(), [{ post_id: "p1", title: "Vid", yt_ids: ["dQw4w9WgXcQ"] }]);
	assert.ok((d.store.listCreators()[0].last_check ?? 0) > 0);
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
	assert.equal(d.store.claim("p1"), true);
	assert.equal(d.store.listCreators()[0].last_check, null);
	const second = await pollOnce(d);
	assert.equal(second.pushedPosts, 1);
	assert.deepEqual(d.store.getSeen(), [{ post_id: "p1", title: "Vid", yt_ids: ["dQw4w9WgXcQ"] }]);
	assert.ok((d.store.listCreators()[0].last_check ?? 0) > 0);
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
	assert.deepEqual(d.store.getSeen(), [{ post_id: "p1", title: "Post 1", yt_ids: [] }]);
	assert.ok((d.store.listCreators()[0].last_check ?? 0) > 0);
});

test("already-seen posts never hit extract or push", async () => {
	const d = makeDeps();
	d.store.commit("p1", "Vid", ["dQw4w9WgXcQ"]);
	let extracted = 0;
	d.feed.extractIds = async () => {
		extracted += 1;
		return { ids: ["dQw4w9WgXcQ"], title: "Vid" };
	};
	const summary = await pollOnce(d);
	assert.equal(summary.skippedSeen, 1);
	assert.equal(extracted, 0);
	assert.equal(d.pushed.length, 0);
	assert.equal(d.store.getSeen().length, 1);
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
	assert.deepEqual(summary.failedCreators, [CREATOR]);
	assert.equal(d.store.listCreators()[0].last_check, null);
});

test("cookies missing skips whole poll", async () => {
	const d = makeDeps({ cookiesReady: () => false });
	let listed = false;
	const origList = d.store.listCreators;
	d.store.listCreators = () => {
		listed = true;
		return origList();
	};
	const summary = await pollOnce(d);
	assert.equal(listed, false);
	assert.equal(summary.creators, 0);
	assert.match(d.logs[0], /no cookies file/);
});
