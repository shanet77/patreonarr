import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Deep Config: one module owns "how is this app configured".
 *
 * Every env read, default, and validation happens here — exactly once — at
 * startup. Downstream modules (Store, pusher, Poll wiring) receive plain
 * values and never touch `process.env` themselves, so a path or token change
 * is a one-file concern.
 *
 * Cookie file care lives here too: the file path is config, and the
 * sanitize/clean/newline rules must not drift between "save from UI" and
 * "clean before poll" — so both go through the same functions.
 */

export interface TAConfig {
	host: string;
	token: string;
	autostart: boolean;
}

export interface Config {
	port: number;
	pollMin: number;
	dbPath: string;
	cookiesPath: string;
	ta: TAConfig;
}

/** Parse an int env var, falling back to `fallback` when absent or garbage. */
function intEnv(value: string | undefined, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return {
		port: intEnv(env.PORT, 8080),
		pollMin: intEnv(env.POLL_INTERVAL_MIN, 30),
		dbPath: env.DB_PATH ?? "/data/bridge.db",
		cookiesPath: env.COOKIES_PATH ?? "/data/patreon-cookies.txt",
		ta: {
			host: (env.TA_HOST ?? "").replace(/\/+$/, ""),
			token: env.TA_API_TOKEN ?? "",
			// README: false = queue only (default); only "true" opts in.
			autostart: (env.TA_AUTOSTART ?? "false").toLowerCase() === "true",
		},
	};
}

export function isTAConfigured(ta: TAConfig): boolean {
	return Boolean(ta.host && ta.token);
}

/**
 * Keep only `*.patreon.com` cookie lines. Stale `.youtube.com` cookies make
 * YouTube reject every embed as "Video unavailable", so anything foreign is
 * stripped before the file is ever used.
 */
export function sanitizeCookies(text: string): string {
	return text
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			if (!t || t.startsWith("#")) return true;
			const domain = t.split("\t")[0] ?? "";
			return domain === ".patreon.com" || domain === "www.patreon.com" || domain === "patreon.com";
		})
		.join("\n");
}

/** yt-dlp requires a trailing newline; this guard is the single authority. */
function ensureTrailingNewline(raw: string): string {
	return raw.endsWith("\n") ? raw : raw + "\n";
}

/** Overwrite the cookies file with sanitized content, owner-only perms. */
export function writeCookiesFile(path: string, raw: string): void {
	writeFileSync(path, sanitizeCookies(ensureTrailingNewline(raw)), { mode: 0o600 });
}

/** Sanitize the file in place before a poll; missing file is a no-op. */
export function cleanCookieFile(path: string): void {
	if (!existsSync(path)) return;
	const raw = readFileSync(path, "utf8");
	const clean = sanitizeCookies(ensureTrailingNewline(raw));
	if (clean !== raw) writeFileSync(path, clean, { mode: 0o600 });
}
