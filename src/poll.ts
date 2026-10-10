import type { Creator } from "./db.js";
import type { Post, PostDetail } from "./patreon.js";

export interface FeedAdapter {
	listPosts(creatorUrl: string): Promise<Post[]>;
	extractIds(postUrl: string): Promise<PostDetail>;
}

export interface PushAdapter {
	push(ids: string[]): Promise<void>;
}

export interface SeenStore {
	listCreators(): Creator[] | Promise<Creator[]>;
	isSeen(postId: string): boolean;
	recordSeen(postId: string, title: string, ytIds: string[]): void;
	touchChecked(creatorUrl: string): void;
}

export interface PollDeps {
	store: SeenStore;
	feed: FeedAdapter;
	pusher: PushAdapter;
	cookiesReady?: () => boolean;
	prepareCookies?: () => void;
	log?: (msg: string) => void;
}

export interface PollSummary {
	creators: number;
	postsScanned: number;
	skippedSeen: number;
	pushedPosts: number;
	pushedVideos: number;
	noEmbedPosts: number;
	failedPushes: number;
	failedCreators: string[];
}

const emptySummary = (): PollSummary => ({
	creators: 0,
	postsScanned: 0,
	skippedSeen: 0,
	pushedPosts: 0,
	pushedVideos: 0,
	noEmbedPosts: 0,
	failedPushes: 0,
	failedCreators: [],
});

export async function pollOnce(deps: PollDeps): Promise<PollSummary> {
	const log = deps.log ?? console.log;
	const summary = emptySummary();

	if (deps.cookiesReady?.() === false) {
		log("no cookies file yet, skipping poll");
		return summary;
	}
	deps.prepareCookies?.();

	const creators = await deps.store.listCreators();
	summary.creators = creators.length;

	for (const creator of creators) {
		let posts: Post[];
		try {
			posts = await deps.feed.listPosts(creator.url);
		} catch (err) {
			log(`poll failed for ${creator.url}: ${(err as Error).message}`);
			summary.failedCreators.push(creator.url);
			continue;
		}
		let creatorFailed = false;
		for (const post of posts) {
			summary.postsScanned += 1;
			if (deps.store.isSeen(post.id)) {
				summary.skippedSeen += 1;
				continue;
			}
			let detail: PostDetail;
			try {
				detail = await deps.feed.extractIds(post.url);
			} catch (err) {
				log(`extract failed for ${post.url}: ${(err as Error).message}`);
				creatorFailed = true;
				continue;
			}
			const { ids, title } = detail;
			const resolvedTitle = title || post.title;
			if (!ids.length) {
				deps.store.recordSeen(post.id, resolvedTitle, ids);
				summary.noEmbedPosts += 1;
				log(`no youtube embeds in ${post.url}`);
				continue;
			}
			try {
				await deps.pusher.push(ids);
			} catch (err) {
				log(`TA push failed: ${(err as Error).message}`);
				summary.failedPushes += 1;
				creatorFailed = true;
				continue;
			}
			deps.store.recordSeen(post.id, resolvedTitle, ids);
			summary.pushedPosts += 1;
			summary.pushedVideos += ids.length;
			log(`pushed ${ids.length} video(s) from "${resolvedTitle}"`);
		}
		if (!creatorFailed) {
			deps.store.touchChecked(creator.url);
		}
	}

	return summary;
}
