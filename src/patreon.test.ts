import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePostList, parsePostDetail, parseYoutubeIds, inspectPost, listPosts } from "./patreon.js";

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

test("parsePostDetail pulls title and ids from -J dump", () => {
  const dump = JSON.stringify({
    title: "Cool Post",
    description: "watch https://youtu.be/9bZkp7q19f0 today",
  });
  assert.deepEqual(parsePostDetail(dump), { ids: ["9bZkp7q19f0"], title: "Cool Post", direct: false });
  assert.deepEqual(parsePostDetail("not json https://youtu.be/9bZkp7q19f0"), {
    ids: ["9bZkp7q19f0"],
    title: "",
    direct: false,
  });
});

test("parsePostDetail flags patreon-hosted video as direct", () => {
  const dump = JSON.stringify({ title: "Native", extractor_key: "Patreon", id: "172881499" });
  assert.deepEqual(parsePostDetail(dump), { ids: [], title: "Native", direct: true });
});

test("parsePostDetail treats a resolved youtube embed as push-only", () => {
  const dump = JSON.stringify({
    title: "Embed",
    extractor_key: "Youtube",
    webpage_url: "https://www.youtube.com/watch?v=dsjYJTRoA-Y",
  });
  assert.deepEqual(parsePostDetail(dump), { ids: ["dsjYJTRoA-Y"], title: "Embed", direct: false });
});

test("parsePostDetail inspects every playlist entry", () => {
  const dump = JSON.stringify({
    _type: "playlist",
    title: "Mixed",
    entries: [
      { extractor_key: "Youtube", webpage_url: "https://www.youtube.com/watch?v=dsjYJTRoA-Y" },
      null,
      { extractor_key: "Patreon", id: "1-2" },
    ],
  });
  assert.deepEqual(parsePostDetail(dump), { ids: ["dsjYJTRoA-Y"], title: "Mixed", direct: true });
  assert.equal(parsePostDetail("null").direct, false);
});

test("inspectPost passes cookies and post url to the runner", async () => {
  let seen: string[] = [];
  const detail = await inspectPost("https://www.patreon.com/posts/1", "/c.txt", async (args) => {
    seen = args;
    return JSON.stringify({ title: "T", extractor_key: "Patreon" });
  });
  assert.deepEqual(detail, { ids: [], title: "T", direct: true });
  assert.deepEqual(seen.slice(0, 2), ["--cookies", "/c.txt"]);
  assert.equal(seen.at(-1), "https://www.patreon.com/posts/1");
});

test("inspectPost treats text/image-only posts as having no video", async () => {
  const detail = await inspectPost("https://www.patreon.com/posts/1", "/c.txt", async () => {
    throw new Error("Command failed: yt-dlp\nERROR: [patreon] 1: No supported media found in this post\n");
  });
  assert.deepEqual(detail, { ids: [], title: "", direct: false });
});

test("inspectPost still fails on locked posts and other errors", async () => {
  await assert.rejects(
    inspectPost("https://www.patreon.com/posts/1", "/c.txt", async () => {
      throw new Error("ERROR: [patreon] 1: You do not have access to this post");
    }),
    /do not have access/,
  );
});

test("listPosts asks yt-dlp for an empty title instead of NA", async () => {
  let seen: string[] = [];
  await listPosts("https://www.patreon.com/c/x/posts", "/c.txt", async (args) => {
    seen = args;
    return "";
  });
  assert.equal(seen[seen.indexOf("--print") + 1], "%(id)s\t%(title|)s\t%(webpage_url)s");
});
