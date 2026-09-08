import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.DB_PATH ?? "/data/bridge.db");

db.exec(`
CREATE TABLE IF NOT EXISTS creators(url TEXT PRIMARY KEY, last_check INTEGER);
CREATE TABLE IF NOT EXISTS seen(post_id TEXT PRIMARY KEY, title TEXT, yt_ids TEXT, created_at INTEGER);
`);

export interface Creator {
	url: string;
	last_check: number | null;
}

export interface SeenPost {
	post_id: string;
	title: string;
	yt_ids: string[];
}

export function listCreators(): Creator[] {
	return db.prepare("SELECT url, last_check FROM creators").all() as unknown as Creator[];
}

export function addCreator(url: string): void {
	db.prepare("INSERT OR IGNORE INTO creators(url) VALUES (?)").run(url);
}

export function removeCreator(url: string): void {
	db.prepare("DELETE FROM creators WHERE url = ?").run(url);
}

export function touchChecked(url: string): void {
	db.prepare("UPDATE creators SET last_check = ? WHERE url = ?").run(
		Math.floor(Date.now() / 1000),
		url,
	);
}

export function isSeen(post_id: string): boolean {
	const row = db
		.prepare("SELECT 1 AS ok FROM seen WHERE post_id = ?")
		.get(post_id) as { ok: number } | undefined;
	return !!row;
}

export function recordSeen(post_id: string, title: string, yt_ids: string[]): void {
	db.prepare(
		"INSERT OR IGNORE INTO seen(post_id, title, yt_ids, created_at) VALUES (?, ?, ?, ?)",
	).run(post_id, title, JSON.stringify(yt_ids), Math.floor(Date.now() / 1000));
}

export function getSeen(limit = 100): SeenPost[] {
	const rows = db
		.prepare("SELECT post_id, title, yt_ids FROM seen ORDER BY created_at DESC LIMIT ?")
		.all(limit) as { post_id: string; title: string; yt_ids: string }[];
	return rows.map((r) => ({ ...r, yt_ids: JSON.parse(r.yt_ids) as string[] }));
}
