import { DatabaseSync } from "node:sqlite";

export interface Creator {
	url: string;
	last_check: number | null;
}

export interface SeenPost {
	post_id: string;
	title: string;
	yt_ids: string[];
}

/**
 * Deep Store: one module owns the creator + seen-ledger lifecycle.
 *
 * Ledger protocol: `claim(postId)` returns true when the post still needs
 * processing (unseen). It performs no writes, so a failed push stays
 * retryable. `commit(...)` records completion and owns JSON/upsert/time.
 * Poll owns ordering (extract → push → commit); the Store owns ledger rules.
 */
export interface Store {
	listCreators(): Creator[];
	addCreator(url: string): void;
	removeCreator(url: string): void;
	touchChecked(url: string): void;
	/** True when unseen (caller now owns processing); false when already seen. Read-only. */
	claim(postId: string): boolean;
	/** Record completion (upsert). Owns JSON serialization + timestamp. */
	commit(postId: string, title: string, ytIds: string[]): void;
	getSeen(limit?: number): SeenPost[];
	close(): void;
}

export interface StoreOptions {
	/** Unix seconds source. Defaults to Date.now. Injectable for tests. */
	now?: () => number;
}

const defaultNow = () => Math.floor(Date.now() / 1000);

function resolvePath(explicit?: string): string {
	return explicit ?? process.env.DB_PATH ?? "/data/bridge.db";
}

/** Open the SQLite-backed Store explicitly. No import-time side effects. */
export function openStore(path?: string, opts: StoreOptions = {}): Store {
	const now = opts.now ?? defaultNow;
	const db = new DatabaseSync(resolvePath(path));

	db.exec(`
CREATE TABLE IF NOT EXISTS creators(url TEXT PRIMARY KEY, last_check INTEGER);
CREATE TABLE IF NOT EXISTS seen(post_id TEXT PRIMARY KEY, title TEXT, yt_ids TEXT, created_at INTEGER);
`);

	const listCreatorsStmt = db.prepare("SELECT url, last_check FROM creators");
	const addCreatorStmt = db.prepare("INSERT OR IGNORE INTO creators(url) VALUES (?)");
	const removeCreatorStmt = db.prepare("DELETE FROM creators WHERE url = ?");
	const touchCheckedStmt = db.prepare("UPDATE creators SET last_check = ? WHERE url = ?");
	const isSeenStmt = db.prepare("SELECT 1 AS ok FROM seen WHERE post_id = ?");
	const commitStmt = db.prepare(
		"INSERT INTO seen(post_id, title, yt_ids, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET title=excluded.title, yt_ids=excluded.yt_ids",
	);
	const getSeenStmt = db.prepare(
		"SELECT post_id, title, yt_ids FROM seen ORDER BY created_at DESC, rowid DESC LIMIT ?",
	);

	return {
		listCreators(): Creator[] {
			return listCreatorsStmt.all() as unknown as Creator[];
		},
		addCreator(url: string): void {
			addCreatorStmt.run(url);
		},
		removeCreator(url: string): void {
			removeCreatorStmt.run(url);
		},
		touchChecked(url: string): void {
			touchCheckedStmt.run(now(), url);
		},
		claim(postId: string): boolean {
			const row = isSeenStmt.get(postId) as { ok: number } | undefined;
			return !row;
		},
		commit(postId: string, title: string, ytIds: string[]): void {
			// JSON + timestamp hidden inside the Store; callers pass domain values.
			commitStmt.run(postId, title, JSON.stringify(ytIds), now());
		},
		getSeen(limit = 100): SeenPost[] {
			const rows = getSeenStmt.all(limit) as { post_id: string; title: string; yt_ids: string }[];
			return rows.map((r) => ({ post_id: r.post_id, title: r.title, yt_ids: JSON.parse(r.yt_ids) as string[] }));
		},
		close(): void {
			db.close();
		},
	};
}

/** In-memory adapter with identical semantics. Used in tests (and Poll tests). */
export function createMemoryStore(opts: StoreOptions = {}): Store {
	const now = opts.now ?? defaultNow;
	const creators = new Map<string, number | null>();
	// created_at is kept from first commit (matching SQLite upsert semantics:
	// conflicts update title/yt_ids but not recency). seq breaks ties newest-first.
	const seen = new Map<string, { title: string; yt_ids: string[]; created_at: number; seq: number }>();
	let seq = 0;

	return {
		listCreators(): Creator[] {
			return [...creators.entries()].map(([url, last_check]) => ({ url, last_check }));
		},
		addCreator(url: string): void {
			if (!creators.has(url)) creators.set(url, null);
		},
		removeCreator(url: string): void {
			creators.delete(url);
		},
		touchChecked(url: string): void {
			if (creators.has(url)) creators.set(url, now());
		},
		claim(postId: string): boolean {
			return !seen.has(postId);
		},
		commit(postId: string, title: string, ytIds: string[]): void {
			const existing = seen.get(postId);
			if (existing) {
				existing.title = title;
				existing.yt_ids = [...ytIds];
			} else {
				seen.set(postId, { title, yt_ids: [...ytIds], created_at: now(), seq: seq++ });
			}
		},
		getSeen(limit = 100): SeenPost[] {
			return [...seen.entries()]
				.sort((a, b) => b[1].created_at - a[1].created_at || b[1].seq - a[1].seq)
				.slice(0, limit)
				.map(([post_id, v]) => ({ post_id, title: v.title, yt_ids: [...v.yt_ids] }));
		},
		close(): void {},
	};
}
