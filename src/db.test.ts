import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore, openStore, type Store } from "./db.js";

function sqliteStore(): Store {
	return openStore(join(mkdtempSync(join(tmpdir(), "bridge-")), "t.db"));
}

const adapters: [string, () => Store][] = [
	["sqlite", sqliteStore],
	["memory", () => createMemoryStore()],
];

for (const [name, make] of adapters) {
	test(`${name}: creator add/list/remove round-trip`, () => {
		const store = make();
		try {
			assert.deepEqual(store.listCreators(), []);
			store.addCreator("https://www.patreon.com/c/x/posts");
			store.addCreator("https://www.patreon.com/c/x/posts");
			assert.equal(store.listCreators().length, 1);
			store.touchChecked("https://www.patreon.com/c/x/posts");
			assert.ok((store.listCreators()[0].last_check ?? 0) > 0);
			store.removeCreator("https://www.patreon.com/c/x/posts");
			assert.deepEqual(store.listCreators(), []);
		} finally {
			store.close();
		}
	});

	test(`${name}: seen claim/commit round-trip`, () => {
		const store = make();
		try {
			assert.equal(store.claim("p1"), true);
			store.commit("p1", "Title", ["dQw4w9WgXcQ"]);
			store.commit("p1", "Title", ["dQw4w9WgXcQ"]);
			assert.equal(store.claim("p1"), false);
			assert.deepEqual(store.getSeen(), [{ post_id: "p1", title: "Title", yt_ids: ["dQw4w9WgXcQ"] }]);
			store.commit("p2", "T2", []);
			assert.equal(store.getSeen(1).length, 1);
		} finally {
			store.close();
		}
	});

	test(`${name}: claim is read-only until commit`, () => {
		const store = make();
		try {
			assert.equal(store.claim("p9"), true);
			assert.equal(store.claim("p9"), true);
			assert.deepEqual(store.getSeen(), []);
		} finally {
			store.close();
		}
	});

	test(`${name}: commit upserts title/ids`, () => {
		const store = make();
		try {
			store.commit("p1", "Old", ["a"]);
			store.commit("p1", "New", ["b", "c"]);
			assert.deepEqual(store.getSeen(), [{ post_id: "p1", title: "New", yt_ids: ["b", "c"] }]);
		} finally {
			store.close();
		}
	});
}

test("touchChecked honors injected clock", () => {
	const store = createMemoryStore({ now: () => 123 });
	try {
		store.addCreator("u");
		store.touchChecked("u");
		assert.equal(store.listCreators()[0].last_check, 123);
	} finally {
		store.close();
	}
});

for (const [name, make] of adapters) {
	test(`${name}: enqueue is idempotent and starts queued`, () => {
		const store = make();
		try {
			store.enqueue("p1", "https://www.patreon.com/posts/p1", "T");
			store.enqueue("p1", "https://www.patreon.com/posts/other", "Other");
			const items = store.listDownloads();
			assert.equal(items.length, 1);
			assert.deepEqual(
				{ ...items[0], created_at: 0, updated_at: 0 },
				{
					post_id: "p1",
					url: "https://www.patreon.com/posts/p1",
					title: "T",
					status: "queued",
					files: [],
					error: null,
					created_at: 0,
					updated_at: 0,
				},
			);
		} finally {
			store.close();
		}
	});

	test(`${name}: download lifecycle and retry rules`, () => {
		const store = make();
		try {
			store.enqueue("p1", "u1", "T1");
			store.enqueue("p2", "u2", "T2");
			assert.deepEqual(store.queuedDownloads().map((i) => i.post_id), ["p1", "p2"]);
			store.markDownloading("p1");
			assert.equal(store.retryDownload("p1"), false);
			assert.deepEqual(store.queuedDownloads().map((i) => i.post_id), ["p2"]);
			store.markDownloaded("p1", ["/d/a.mp4"]);
			assert.equal(store.retryDownload("p1"), false);
			assert.deepEqual(store.listDownloads().find((i) => i.post_id === "p1")?.files, ["/d/a.mp4"]);
			store.markDownloadFailed("p2", "boom");
			assert.equal(store.listDownloads().find((i) => i.post_id === "p2")?.error, "boom");
			assert.equal(store.retryDownload("p2"), true);
			assert.equal(store.listDownloads().find((i) => i.post_id === "p2")?.error, null);
			assert.equal(store.retryDownload("missing"), false);
			store.removeDownload("p2");
			assert.deepEqual(store.listDownloads().map((i) => i.post_id), ["p1"]);
		} finally {
			store.close();
		}
	});

	test(`${name}: requeueInterrupted resets only in-flight downloads`, () => {
		const store = make();
		try {
			store.enqueue("p1", "u1", "T1");
			store.enqueue("p2", "u2", "T2");
			store.markDownloading("p1");
			store.markDownloaded("p2", []);
			assert.equal(store.requeueInterrupted(), 1);
			assert.deepEqual(store.queuedDownloads().map((i) => i.post_id), ["p1"]);
		} finally {
			store.close();
		}
	});
}

test("sqlite: download queue survives reopen", () => {
	const path = join(mkdtempSync(join(tmpdir(), "bridge-")), "q.db");
	const first = openStore(path);
	first.enqueue("p1", "u1", "T1");
	first.markDownloading("p1");
	first.close();
	const second = openStore(path);
	try {
		assert.equal(second.listDownloads()[0].status, "downloading");
		assert.equal(second.requeueInterrupted(), 1);
		assert.equal(second.queuedDownloads()[0].post_id, "p1");
	} finally {
		second.close();
	}
});
