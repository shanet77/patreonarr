import { test } from "node:test";
import assert from "node:assert/strict";
import { createTAPusher } from "./ta.js";
import { loadConfig, isTAConfigured } from "./config.js";

test("unconfigured pusher never fetches and resolves", async () => {
  const pusher = createTAPusher({ host: "", token: "", autostart: false }, async () => {
    throw new Error("must not fetch");
  });
  await pusher.push(["dQw4w9WgXcQ"]);
  assert.equal(isTAConfigured({ host: "", token: "", autostart: false }), false);
});

test("posts ids to TA download endpoint using configured host", async () => {
  let url = "";
  let init: RequestInit = {};
  const pusher = createTAPusher(
    { host: "https://ta.example", token: "tok", autostart: true },
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

test("TA settings validated once in loadConfig: trim, default, opt-in autostart", () => {
  assert.equal(loadConfig({}).ta.autostart, false);
  assert.equal(loadConfig({ TA_AUTOSTART: "true" }).ta.autostart, true);
  assert.equal(loadConfig({ TA_AUTOSTART: "false" }).ta.autostart, false);
  assert.equal(loadConfig({}).ta.host, "");
  assert.equal(loadConfig({ TA_HOST: "https://ta.example///" }).ta.host, "https://ta.example");

  let url = "";
  const pusher = createTAPusher(
    loadConfig({ TA_HOST: "https://ta.example", TA_API_TOKEN: "tok" }).ta,
    async (input) => {
      url = String(input);
      return new Response("ok", { status: 200 });
    },
  );
  return pusher.push(["dQw4w9WgXcQ"]).then(() => {
    assert.equal(url, "https://ta.example/api/download/?autostart=false");
  });
});

test("throws on TA error response", async () => {
  const pusher = createTAPusher({ host: "https://ta.example", token: "tok", autostart: false }, async () =>
    new Response("boom", { status: 500 }));
  await assert.rejects(pusher.push(["dQw4w9WgXcQ"]), /TA push failed: 500/);
});
