# patreonarr

Sidecar that watches your Patreon memberships and queues new videos in
[TubeArchivist](https://www.tubearchivist.com/) for download.

TubeArchivist downloads from YouTube (based on yt-dlp). Many Patreon creators embed (often
unlisted) YouTube videos in their posts, so this bridge polls your Patreon
feed, pulls out the embedded YouTube IDs, and pushes them to TubeArchivist's
download queue via its API. TubeArchivist then handles downloading, indexing,
and playback like any other video. Leaves TubeArchivist unmodified. Potentially in the future will propose this as a feature directly within TubeArchivist or spin an entirely standalone application.
```
patreon (cookies) → bridge → YouTube IDs → TubeArchivist /api/download/
```

Native Patreon-hosted videos (not YouTube embeds) are skipped. Roadmap will include this feature.

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
the service. Paste cookies and add creators at `http://host:8095`.

## How it works

Every `POLL_INTERVAL_MIN` minutes (plus on startup and on demand via
**poll now**), the bridge walks each creator, lists new posts with yt-dlp's
Patreon extractor, and checks each unseen post for embedded YouTube URLs
(watch/shorts/live/embed/`youtu.be`). New IDs are recorded in SQLite and
POSTed to TubeArchivist:

```
POST {TA_HOST}/api/download/?autostart=<true|false>
{"data": [{"youtube_id": "...", "status": "pending"}]}
```

`TA_AUTOSTART=false` (the default) queues videos for manual download in the
TA UI. Set it to `true` to download immediately. Posts with no embeds are
logged and skipped; already-seen posts are never re-pushed.

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

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Web UI: cookies, creators, poll now, recent posts |
| `GET` | `/api/health` | Health check |
| `GET` / `POST` | `/api/creators` | List / add a creator feed URL |
| `DELETE` | `/api/creators?url=` | Remove a creator |
| `GET` | `/api/seen` | Recently scanned posts and found video IDs |
| `POST` | `/api/poll` | Trigger a poll (returns immediately) |
| `POST` | `/api/cookies` | Upload `cookies.txt` content |

## Development

```bash
npm install
npm test    # tsc + node --test, pure parsers in *.test.ts
npm run dev # watch mode (needs yt-dlp on PATH for real polls)
```

TypeScript on Node 24, `node:http`, `node:sqlite`. The image is
`node:24-slim` plus the `yt-dlp` binary and `python3` (yt-dlp is a Python
zipapp and won't start without it).
