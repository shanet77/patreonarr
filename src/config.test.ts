import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, sanitizeCookies, writeCookiesFile, cleanCookieFile } from "./config.js";

test("loadConfig applies documented defaults", () => {
  const c = loadConfig({});
  assert.deepEqual(
    { ...c, ta: c.ta },
    {
      port: 8080,
      pollMin: 30,
      dbPath: "/data/bridge.db",
      cookiesPath: "/data/patreon-cookies.txt",
      ta: { host: "", token: "", autostart: false },
    },
  );
});

test("loadConfig honors explicit values", () => {
  const c = loadConfig({
    PORT: "9000",
    POLL_INTERVAL_MIN: "5",
    DB_PATH: "/tmp/x.db",
    COOKIES_PATH: "/tmp/c.txt",
    TA_HOST: "http://ta:8000/",
    TA_API_TOKEN: "tok",
    TA_AUTOSTART: "TRUE",
  });
  assert.equal(c.port, 9000);
  assert.equal(c.pollMin, 5);
  assert.equal(c.dbPath, "/tmp/x.db");
  assert.equal(c.cookiesPath, "/tmp/c.txt");
  assert.deepEqual(c.ta, { host: "http://ta:8000", token: "tok", autostart: true });
});

test("loadConfig falls back on garbage numbers instead of producing NaN", () => {
  assert.equal(loadConfig({ PORT: "abc" }).port, 8080);
  assert.equal(loadConfig({ POLL_INTERVAL_MIN: "0" }).pollMin, 30);
  assert.equal(loadConfig({ POLL_INTERVAL_MIN: "-3" }).pollMin, 30);
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

test("writeCookiesFile sanitizes, guarantees trailing newline, writes 0600", () => {
  const path = join(mkdtempSync(join(tmpdir(), "cookies-")), "c.txt");
  writeCookiesFile(path, ".patreon.com\tTRUE\t/\tTRUE\t0\tsession\tabc");
  const written = readFileSync(path, "utf8");
  assert.match(written, /session\tabc\n$/);
  assert.equal((statSync(path).mode & 0o777), 0o600);
});

test("writeCookiesFile strips foreign domains on upload", () => {
  const path = join(mkdtempSync(join(tmpdir(), "cookies-")), "c.txt");
  writeCookiesFile(path, ".patreon.com\tx\n.youtube.com\ty\n");
  const written = readFileSync(path, "utf8");
  assert.doesNotMatch(written, /youtube/);
});

test("cleanCookieFile sanitizes in place and is a no-op when missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "cookies-"));
  const path = join(dir, "c.txt");
  cleanCookieFile(path); // missing: no throw, no file created
  assert.equal(statSync(path, { throwIfNoEntry: false }), undefined);

  writeCookiesFile(path, ".patreon.com\ta\n.youtube.com\tb\n");
  cleanCookieFile(path);
  const cleaned = readFileSync(path, "utf8");
  assert.match(cleaned, /patreon/);
  assert.doesNotMatch(cleaned, /youtube/);
});
