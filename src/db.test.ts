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
