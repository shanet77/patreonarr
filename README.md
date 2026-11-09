# patreonarr

Sidecar that watches your Patreon memberships, queues embedded YouTube videos in
[TubeArchivist](https://www.tubearchivist.com/), and queues Patreon-hosted
videos for download straight to disk.

TubeArchivist downloads from YouTube (based on yt-dlp). Many Patreon creators embed (often
unlisted) YouTube videos in their posts, so this bridge polls your Patreon
feed, pulls out the embedded YouTube IDs, and pushes them to TubeArchivist's
download queue via its API. TubeArchivist then handles downloading, indexing,
and playback like any other video.
Potentially in the future will propose this as a feature directly within TubeArchivist or spin an entirely standalone application.
```
patreon (cookies) → bridge ─┬─ YouTube IDs ──────────→ TubeArchivist /api/download/
                            └─ Patreon-hosted video ─→ download queue → yt-dlp → DOWNLOAD_DIR
```

Videos uploaded directly to Patreon (served from Patreon's Mux CDN, no DRM) and
other non-YouTube embeds such as Vimeo can't go through TubeArchivist, which
only knows YouTube IDs. The bridge keeps its own download queue for those and
fetches them with yt-dlp into `DOWNLOAD_DIR`, ready for Jellyfin/Plex or any
file-based library.

## Setup

You need three things: a running TubeArchivist, Patreon cookies, and a
TubeArchivist API token. Two ways to run the bridge:

- **locally with Docker Compose** - quickest way to try it next to a local TA
- **hosted with Podman Quadlet** - how it runs next to a hosted TA install

Both need the same prerequisites.

### 1. TubeArchivist API token

In TubeArchivist go to **Settings → Application → Integrations** and show the
API token. The bridge sends it as `Authorization: Token <key>` with every
push.

### 2. Patreon cookies

The bridge reads your Patreon feed as you, using a `cookies.txt` export. It
never sees your password.

1. In your browser, log into patreon.com and open a post from a membership
   you pay for.
2. Export cookies for patreon however is easiest to you.
3. Paste the file into the bridge UI (cookies box → save). It is stored with
   `0600` permissions at `COOKIES_PATH`.

Only `*.patreon.com` cookies are kept so anything else in the export
(e.g. stale `.youtube.com` cookies, which make YouTube reject every embed as
"Video unavailable") is stripped on upload and before every poll. Cookies
expire after a few weeks; when polls start failing with auth errors in the
container logs, re-export and re-paste.

### 3a. Run locally (Docker Compose)

TubeArchivist must be running first so its `tubearchivist_default` network
exists.

```bash
cd /path/to/tubearchivist && docker compose up -d
docker network ls | grep tubearchivist   # expect tubearchivist_default

cp .env.example .env   # set TA_API_TOKEN
docker compose up -d --build
```

Open `http://localhost:8080`, paste cookies, add a creator URL like
`https://www.patreon.com/c/<vanity>/posts`, hit **poll now**.

> ARM Macs: the stock TA compose pins `bbilly1/tubearchivist-es`, which is
> amd64-only and crashes Elasticsearch with a `seccomp unavailable` error.
> Swap it for `docker.elastic.co/elasticsearch/elasticsearch:8.19.0` (same
> version, native ARM).

### 3b. Run hosted (Podman Quadlet)

On the host, copy the repo over, build the image, and register the quadlet:

```bash
# from your machine
tar --exclude=node_modules --exclude=dist --exclude=data --exclude=.git \
  -czf /tmp/patreonarr-src.tgz .
scp /tmp/patreonarr-src.tgz you@host:/tmp/
ssh you@host 'mkdir -p ~/patreonarr/data \
  && tar -xzf /tmp/patreonarr-src.tgz -C ~/patreonarr'

# on the host
cd ~/patreonarr
podman build -t localhost/patreonarr-bridge:latest .
printf 'TA_API_TOKEN=<token>\n' > ~/patreonarr/bridge.env
chmod 600 ~/patreonarr/bridge.env
cp patreonarr-bridge.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start patreonarr-bridge.service
```

`patreonarr-bridge.container` joins the existing `tubearchivist.network`,
puts the UI on port `8095` (change `PublishPort` if taken), and restarts with
the service. Give it a `Volume=<host media dir>:/downloads:Z` line so
Patreon-hosted videos land somewhere persistent. Paste cookies and add creators at `http://host:8095`.

## How it works

Every `POLL_INTERVAL_MIN` minutes (plus on startup and on demand via
**poll now**), the bridge walks each creator, lists new posts with yt-dlp's
Patreon extractor, and inspects each unseen post. Embedded YouTube URLs
(watch/shorts/live/embed/`youtu.be`) are recorded in SQLite and POSTed to
TubeArchivist:

```
POST {TA_HOST}/api/download/?autostart=<true|false>
{"data": [{"youtube_id": "...", "status": "pending"}]}
```

`TA_AUTOSTART=false` (the default) queues videos for manual download in the
TA UI. Set it to `true` to download immediately.

Patreon-hosted video (and any other non-YouTube media yt-dlp resolves in the
post) goes into the bridge's download queue, mirroring TA's queue-first
default. Start downloads from the **Downloads** section of the UI (one at a
time or **Download all**), or set `DOWNLOAD_AUTOSTART=true` to drain the queue
after every poll. Downloads run one at a time with yt-dlp into `DOWNLOAD_DIR`
using `DOWNLOAD_TEMPLATE`, by default
`<creator>/<YYYYMMDD> <title> [<post id>].mp4`, with title/date metadata
embedded. YouTube entries are filtered out so TA stays their only owner.

Adding a creator queues their whole back catalog of Patreon-hosted video, so
size `DOWNLOAD_DIR` accordingly before hitting **Download all**, or remove
entries you don't want. Failed downloads keep yt-dlp's error and can be
retried; a download cut off by a restart is requeued on startup. A failed TA
push leaves the post unseen so the next poll retries it. Text and image-only
posts are marked seen without a push or download; posts above your tier stay
unseen and are retried each poll. Already-seen posts are never re-processed.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `TA_HOST` | `http://tubearchivist:8000` | TubeArchivist base URL |
| `TA_API_TOKEN` | _(empty)_ | TA API token; pushes are skipped until set |
| `TA_AUTOSTART` | `false` | `true` = download immediately, `false` = queue only |
| `POLL_INTERVAL_MIN` | `30` | Minutes between polls |
| `PORT` | `8080` | Bridge UI/API port |
| `DB_PATH` | `/data/bridge.db` | SQLite file (creators, seen posts) |
| `COOKIES_PATH` | `/data/patreon-cookies.txt` | Patreon cookies file |
| `DOWNLOAD_DIR` | `/downloads` | Where Patreon-hosted videos are saved |
| `DOWNLOAD_AUTOSTART` | `false` | `true` = download queued videos after each poll, `false` = queue only |
| `DOWNLOAD_TEMPLATE` | `%(uploader)s/%(upload_date)s %(title)s [%(id)s].%(ext)s` | yt-dlp output template, relative to `DOWNLOAD_DIR` |

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Web UI: cookies, creators, poll now, recent posts |
| `GET` | `/api/health` | Health check |
| `GET` / `POST` | `/api/creators` | List / add a creator feed URL |
| `DELETE` | `/api/creators?url=` | Remove a creator |
| `GET` | `/api/seen` | Recently scanned posts and pushed video IDs |
| `GET` | `/api/downloads` | Download queue (`queued`/`downloading`/`done`/`failed`) and whether it is running |
| `POST` | `/api/downloads/start` | Download everything queued, or `{"post_id": "..."}` to start/retry one |
| `DELETE` | `/api/downloads?post_id=` | Drop an entry from the queue |
| `POST` | `/api/poll` | Trigger a poll (returns immediately) |
| `POST` | `/api/cookies` | Upload `cookies.txt` content |

## Development

```bash
npm install
npm test    # tsc + node --test, pure parsers in *.test.ts
npm run dev # watch mode (needs yt-dlp and ffmpeg on PATH for real polls)
```
