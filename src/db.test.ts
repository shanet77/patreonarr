import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "bridge-")), "t.db");
const db = await import("./db.js");

test("creator add/list/remove round-trip", () => {
  assert.deepEqual(db.listCreators(), []);
  db.addCreator("https://www.patreon.com/c/x/posts");
  db.addCreator("https://www.patreon.com/c/x/posts");
  assert.equal(db.listCreators().length, 1);
  db.touchChecked("https://www.patreon.com/c/x/posts");
  assert.ok((db.listCreators()[0].last_check ?? 0) > 0);
  db.removeCreator("https://www.patreon.com/c/x/posts");
  assert.deepEqual(db.listCreators(), []);
});

test("seen record/lookup round-trip", () => {
  assert.equal(db.isSeen("p1"), false);
  db.recordSeen("p1", "Title", ["dQw4w9WgXcQ"]);
  db.recordSeen("p1", "Title", ["dQw4w9WgXcQ"]);
  assert.equal(db.isSeen("p1"), true);
  assert.deepEqual(db.getSeen(), [{ post_id: "p1", title: "Title", yt_ids: ["dQw4w9WgXcQ"] }]);
  db.recordSeen("p2", "T2", []);
  assert.equal(db.getSeen(1).length, 1);
});
