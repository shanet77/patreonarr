import type { TAConfig } from "./config.js";

export type TAFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface TAPusher {
	push(ids: string[]): Promise<void>;
}

/** Push adapter: config and fetch are injected; no env reads, no globals. */
export function createTAPusher(config: TAConfig, fetchFn: TAFetch = globalThis.fetch): TAPusher {
	const host = config.host;
	if (!host || !config.token) {
		return { push: async () => {} };
	}
	return {
		async push(ids: string[]): Promise<void> {
			const res = await fetchFn(`${host}/api/download/?autostart=${config.autostart}`, {
				method: "POST",
				headers: {
					Authorization: `Token ${config.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					data: ids.map((youtube_id) => ({ youtube_id, status: "pending" as const })),
				}),
			});
			if (!res.ok) throw new Error(`TA push failed: ${res.status} ${await res.text()}`);
		},
	};
}
