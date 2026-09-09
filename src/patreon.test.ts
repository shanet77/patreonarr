import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostList, parsePostDetail, parseYoutubeIds, sanitizeCookies } from "./patreon.js";

test("parsePostList skips blank and broken lines", () => {
  const stdout = [
    "abc123\tSome Title\thttps://www.patreon.com/posts/abc123",
    "",
    "\t\t",
    "notab",
    "nourl\tTitle\t",
  ].join("\n");
  assert.deepEqual(parsePostList(stdout), [
    { id: "abc123", title: "Some Title", url: "https://www.patreon.com/posts/abc123" },
  ]);
});

test("parseYoutubeIds matches all embed styles, dedupes, ignores junk", () => {
  const text = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    "https://youtu.be/9bZkp7q19f0",
    "https://www.youtube.com/shorts/M7lc1UVf-VE",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "just some text",
  ].join(" ");
  assert.deepEqual(parseYoutubeIds(text), ["dQw4w9WgXcQ", "9bZkp7q19f0", "M7lc1UVf-VE"]);
});

test("parseYoutubeIds returns empty when nothing matches", () => {
  assert.deepEqual(parseYoutubeIds("no videos here"), []);
});

test("sanitizeCookies keeps patreon domains, drops foreign ones", () => {
  const raw = [
    "# Netscape HTTP Cookie File",
    ".patreon.com\tTRUE\t/\tTRUE\t0\tsession_id\tabc",
    "www.patreon.com\tTRUE\t/\tTRUE\t0\tfoo\tbar",
    ".youtube.com\tTRUE\t/\tTRUE\t0\tGPS\t1",
    "",
  ].join("\n");
  const clean = sanitizeCookies(raw);
  assert.match(clean, /session_id/);
  assert.match(clean, /www\.patreon\.com/);
  assert.doesNotMatch(clean, /youtube/);
});

test("parsePostDetail pulls title and ids from -J dump", () => {
  const dump = JSON.stringify({
    title: "Cool Post",
    description: "watch https://youtu.be/9bZkp7q19f0 today",
  });
  assert.deepEqual(parsePostDetail(dump), { ids: ["9bZkp7q19f0"], title: "Cool Post" });
  assert.deepEqual(parsePostDetail("not json https://youtu.be/9bZkp7q19f0"), {
    ids: ["9bZkp7q19f0"],
    title: "",
  });
});
