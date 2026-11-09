import type { DownloadItem } from "./db.js";

export interface DownloadAdapter {
	download(postUrl: string): Promise<string[]>;
}

export interface QueueStore {
	queuedDownloads(): DownloadItem[];
	markDownloading(postId: string): void;
	markDownloaded(postId: string, files: string[]): void;
	markDownloadFailed(postId: string, error: string): void;
}

export interface DrainDeps {
	store: QueueStore;
	downloader: DownloadAdapter;
	log?: (msg: string) => void;
}

export interface DrainSummary {
	downloaded: number;
	files: number;
	failed: number;
}

export async function drainQueue(deps: DrainDeps, only?: ReadonlySet<string>): Promise<DrainSummary> {
	const log = deps.log ?? console.log;
	const summary: DrainSummary = { downloaded: 0, files: 0, failed: 0 };
	const pending = deps.store.queuedDownloads().filter((item) => !only || only.has(item.post_id));
	for (const item of pending) {
		deps.store.markDownloading(item.post_id);
		try {
			const files = await deps.downloader.download(item.url);
			deps.store.markDownloaded(item.post_id, files);
			summary.downloaded += 1;
			summary.files += files.length;
			log(`downloaded ${files.length} file(s) from "${item.title}"`);
		} catch (err) {
			const message = (err as Error).message;
			deps.store.markDownloadFailed(item.post_id, message);
			summary.failed += 1;
			log(`download failed for ${item.url}: ${message}`);
		}
	}
	return summary;
}
