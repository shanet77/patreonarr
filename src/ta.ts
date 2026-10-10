export interface TAConfig {
	host: string;
	token: string;
	autostart: boolean;
}

export type TAFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface TAPusher {
	push(ids: string[]): Promise<void>;
}

export function resolveTAConfig(env: NodeJS.ProcessEnv = process.env): TAConfig {
	return {
		host: (env.TA_HOST ?? "").replace(/\/+$/, ""),
		token: env.TA_API_TOKEN ?? "",
		autostart: (env.TA_AUTOSTART ?? "false").toLowerCase() === "true",
	};
}

export function isTAConfigured(config: TAConfig): boolean {
	return Boolean(config.host && config.token);
}

export function createTAPusher(config: TAConfig, fetchFn: TAFetch = globalThis.fetch): TAPusher {
	const host = config.host.replace(/\/+$/, "");
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

export function createTAPusherFromEnv(
	env: NodeJS.ProcessEnv = process.env,
	fetchFn: TAFetch = globalThis.fetch,
): TAPusher {
	return createTAPusher(resolveTAConfig(env), fetchFn);
}
