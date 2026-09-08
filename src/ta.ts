export async function pushToTA(ids: string[]): Promise<void> {
  const host = (process.env.TA_HOST ?? "").replace(/\/+$/, "");
  const token = process.env.TA_API_TOKEN ?? "";
  if (!host || !token) {
    console.log(`TA not configured, skipping push of ${ids.length} video(s)`);
    return;
  }
  const res = await fetch(`${host}/api/download/?autostart=true`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: ids.map((youtube_id) => ({ youtube_id, status: "pending" as const })),
    }),
  });
  if (!res.ok) throw new Error(`TA push failed: ${res.status} ${await res.text()}`);
}
