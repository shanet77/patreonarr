import { test } from "node:test";
import assert from "node:assert/strict";
import { pushToTA } from "./ta.js";

test("skips push without fetching when unconfigured", async () => {
  delete process.env.TA_HOST;
  delete process.env.TA_API_TOKEN;
  let called = false;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("must not fetch");
  }) as typeof fetch;
  try {
    await pushToTA(["dQw4w9WgXcQ"]);
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(called, false);
});

test("posts ids to TA download endpoint", async () => {
  process.env.TA_HOST = "https://ta.example///";
  process.env.TA_API_TOKEN = "tok";
  let url = "";
  let init: RequestInit = {};
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    url = String(input);
    init = options ?? {};
    return new Response("ok", { status: 200 });
  };
  try {
    await pushToTA(["dQw4w9WgXcQ"]);
  } finally {
    globalThis.fetch = orig;
    delete process.env.TA_HOST;
    delete process.env.TA_API_TOKEN;
  }
  assert.equal(url, "https://ta.example/api/download/?autostart=true");
  assert.deepEqual(JSON.parse(init.body as string), {
    data: [{ youtube_id: "dQw4w9WgXcQ", status: "pending" }],
  });
  assert.equal((init.headers as Record<string, string>).Authorization, "Token tok");
});

test("throws on TA error response", async () => {
  process.env.TA_HOST = "https://ta.example";
  process.env.TA_API_TOKEN = "tok";
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  try {
    await assert.rejects(pushToTA(["dQw4w9WgXcQ"]), /TA push failed: 500/);
  } finally {
    globalThis.fetch = orig;
    delete process.env.TA_HOST;
    delete process.env.TA_API_TOKEN;
  }
});
