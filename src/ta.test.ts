import { test } from "node:test";
import assert from "node:assert/strict";
import { createTAPusher, resolveTAConfig, isTAConfigured } from "./ta.js";

test("unconfigured pusher never fetches and resolves", async () => {
  const pusher = createTAPusher({ host: "", token: "", autostart: false }, async () => {
    throw new Error("must not fetch");
  });
  await pusher.push(["dQw4w9WgXcQ"]);
  assert.equal(isTAConfigured({ host: "", token: "", autostart: false }), false);
});

test("posts ids to TA download endpoint with trimmed host", async () => {
  let url = "";
  let init: RequestInit = {};
  const pusher = createTAPusher(
    { host: "https://ta.example///", token: "tok", autostart: true },
    async (input, options) => {
      url = String(input);
      init = options ?? {};
      return new Response("ok", { status: 200 });
    },
  );
  await pusher.push(["dQw4w9WgXcQ"]);
  assert.equal(url, "https://ta.example/api/download/?autostart=true");
  assert.deepEqual(JSON.parse(init.body as string), {
    data: [{ youtube_id: "dQw4w9WgXcQ", status: "pending" }],
  });
  assert.equal((init.headers as Record<string, string>).Authorization, "Token tok");
});

test("autostart defaults to false and only true opts in", async () => {
  assert.equal(resolveTAConfig({}).autostart, false);
  assert.equal(resolveTAConfig({ TA_AUTOSTART: "true" }).autostart, true);
  assert.equal(resolveTAConfig({ TA_AUTOSTART: "false" }).autostart, false);
  assert.equal(resolveTAConfig({}).host, "");
  assert.equal(resolveTAConfig({ TA_HOST: "https://ta.example///" }).host, "https://ta.example");

  let url = "";
  const pusher = createTAPusher(resolveTAConfig({ TA_HOST: "https://ta.example", TA_API_TOKEN: "tok" }), async (
    input,
  ) => {
    url = String(input);
    return new Response("ok", { status: 200 });
  });
  await pusher.push(["dQw4w9WgXcQ"]);
  assert.equal(url, "https://ta.example/api/download/?autostart=false");
});

test("throws on TA error response", async () => {
  const pusher = createTAPusher({ host: "https://ta.example", token: "tok", autostart: false }, async () =>
    new Response("boom", { status: 500 }));
  await assert.rejects(pusher.push(["dQw4w9WgXcQ"]), /TA push failed: 500/);
});
