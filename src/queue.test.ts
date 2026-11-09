import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "./db.js";
import { drainQueue, type DownloadAdapter } from "./queue.js";

function setup(download: DownloadAdapter["download"]) {
	const store = createMemoryStore();
	const logs: string[] = [];
	return { store, logs, deps: { store, downloader: { download }, log: (m: string) => logs.push(m) } };
}

const statuses = (items: { post_id: string; status: string }[]) => items.map((i) => [i.post_id, i.status]);

test("drainQueue downloads queued items oldest first and records files", async () => {
	const order: string[] = [];
	const { store, deps } = setup(async (url) => {
		order.push(url);
		return [`/downloads/${url.split("/").pop()}.mp4`];
	});
	store.enqueue("a", "https://www.patreon.com/posts/a", "A");
	store.enqueue("b", "https://www.patreon.com/posts/b", "B");
	const summary = await drainQueue(deps);
	assert.deepEqual(summary, { downloaded: 2, files: 2, failed: 0 });
	assert.deepEqual(order, ["https://www.patreon.com/posts/a", "https://www.patreon.com/posts/b"]);
	assert.deepEqual(statuses(store.listDownloads()), [["b", "done"], ["a", "done"]]);
	assert.deepEqual(store.listDownloads()[1].files, ["/downloads/a.mp4"]);
	assert.deepEqual(store.queuedDownloads(), []);
});

test("drainQueue marks items downloading while yt-dlp runs", async () => {
	const { store, deps } = setup(async () => {
		assert.equal(store.listDownloads()[0].status, "downloading");
		return [];
	});
	store.enqueue("a", "u", "A");
	await drainQueue(deps);
	assert.equal(store.listDownloads()[0].status, "done");
});

test("drainQueue records failures and keeps going", async () => {
	const { store, logs, deps } = setup(async (url) => {
		if (url === "bad") throw new Error("You do not have access to this post");
		return ["/d/ok.mp4"];
	});
	store.enqueue("a", "bad", "A");
	store.enqueue("b", "good", "B");
	const summary = await drainQueue(deps);
	assert.deepEqual(summary, { downloaded: 1, files: 1, failed: 1 });
	const failed = store.listDownloads().find((i) => i.post_id === "a");
	assert.equal(failed?.status, "failed");
	assert.match(failed?.error ?? "", /do not have access/);
	assert.match(logs.join("\n"), /download failed for bad/);
});

test("drainQueue can be limited to specific posts", async () => {
	const { store, deps } = setup(async () => []);
	store.enqueue("a", "ua", "A");
	store.enqueue("b", "ub", "B");
	await drainQueue(deps, new Set(["b"]));
	assert.deepEqual(statuses(store.listDownloads()), [["b", "done"], ["a", "queued"]]);
});

test("drainQueue skips failed items until they are retried", async () => {
	let calls = 0;
	const { store, deps } = setup(async () => {
		calls += 1;
		if (calls === 1) throw new Error("mux 403");
		return ["/d/a.mp4"];
	});
	store.enqueue("a", "ua", "A");
	await drainQueue(deps);
	await drainQueue(deps);
	assert.equal(calls, 1);
	assert.equal(store.retryDownload("a"), true);
	await drainQueue(deps);
	assert.equal(calls, 2);
	assert.equal(store.listDownloads()[0].status, "done");
	assert.equal(store.listDownloads()[0].error, null);
});
