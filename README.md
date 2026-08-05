# OnNow

**A rotating poster display for your home media library** — movies, TV shows, music, books, coming-soon titles, and live "now playing" status, on any screen with a browser. Works with Plex, Jellyfin, Emby, and Kodi, plus optional Sonarr, Radarr, and Readarr integration.

![Platforms](https://img.shields.io/badge/platform-docker-blue)

<p align="center">
  <img src="https://raw.githubusercontent.com/jdub1120/onNow/main/doco/movie-now-playing.jpg" width="24%" alt="Movie Now Playing" />
  <img src="https://raw.githubusercontent.com/jdub1120/onNow/main/doco/tv-show-now-playing.jpg" width="24%" alt="TV show Now Playing" />
  <img src="https://raw.githubusercontent.com/jdub1120/onNow/main/doco/music-now-playing.jpg" width="24%" alt="Music Now Playing" />
  <img src="https://raw.githubusercontent.com/jdub1120/onNow/main/doco/sports-now-playing.jpg" width="24%" alt="Live sports Now Playing" />
</p>

**Source:** [github.com/jdub1120/onNow](https://github.com/jdub1120/onNow) · **Docker image:** [`jdub1120/onnow`](https://hub.docker.com/r/jdub1120/onnow) (`:latest`) · **Support/issues:** [github.com/jdub1120/onNow/issues](https://github.com/jdub1120/onNow/issues)

**Default settings password:** `raidisnotabackup`

### Lineage

OnNow is a fork of [PosterrX](https://github.com/binarygeek119/posterrX) (by binarygeek119), which is itself a fork of the original [Posterr](https://github.com/petersem/posterr) by Matt Petersen. All three are separate, independently maintained projects — please don't use one project's support channels for another:

- Original Posterr community Discord: [discord.gg/TcnEkMEf9J](https://discord.gg/TcnEkMEf9J)
- PosterrX community Discord: [discord.gg/AEhVjqX4Af](https://discord.gg/AEhVjqX4Af)
- OnNow issues/support: [github.com/jdub1120/onNow/issues](https://github.com/jdub1120/onNow/issues)

---

## What it does

- Shows a poster for whatever's currently playing — movies, TV episodes, music, or audiobooks — pulled from your media server's "now playing" state.
- Rotates through your library on a timer when nothing's playing, sourced from Plex, Jellyfin, Emby, or Kodi.
- Shows upcoming releases from Sonarr (season premieres) and Radarr, and upcoming books from Readarr.
- Optional dedicated **Now Showing** view (`/now-showing`) — a TMDB-backed "movies playing now" board with auto-generated showtimes, independent of your media server.
- Optional ad/announcement slides mixed into the rotation, or as their own full-screen view (`/ads`).
- Plays TV/movie theme music during slides, if available.
- Custom picture themes, background artwork, and a trivia quiz mode.
- Supports LED matrix displays running Awtrix, and custom web pages as experimental slides.
- Scales automatically across screen sizes (roughly 320px to 3500px tall) and supports 90° rotation for displays that don't do portrait natively.
- Scheduled "sleep timer" to blank the display during set hours, with optional CEC control so the screen itself powers down too.
- A small REST API for sleep mode: `POST /api/sleep` (headers `psw: your OnNow password`, `sleep: true|false`) toggles it; `GET` on the same endpoint returns the current sleep status.

## Apple TV Now Playing

An optional add-on (a local Python sidecar using [pyatv](https://pyatv.dev/)) that reads tvOS's system-wide Now Playing info directly from paired Apple TVs — no per-app integration needed on your end, though support depends on each app choosing to report to that system API (most do; a few, like Netflix, don't and can't be worked around). Pair and manage devices under **Settings → Apple TV**.

Three dedicated layouts on top of the base integration:

- **Movies & TV shows** — the normal poster flow, resolved against TMDB, with rating and content-rating badges.
- **Music** — an Apple Music-style card: album art on a dynamic color gradient extracted from the artwork, title/artist caption, an animated equalizer that freezes when paused, and a "Playing in {device}" pill.
- **Live sports** — recognizes when Apple TV content is a real sporting event by matching the on-screen title against ESPN's public scoreboard and team data (NFL, MLB, NBA, NHL, college football/basketball, MLS) — not just guessed from which app is open, so ordinary movies/shows/other live TV in the same apps (YouTube TV, ESPN, MLB, etc.) are unaffected. Shows both teams' logos and colors on a gradient split between them, a live or final score, and — for MLB specifically — inning, outs, and a runners-on-base indicator, all refreshed while the game is in progress.

## Free community custom posters

Community-sourced, open-use custom poster images (for OnNow and similar apps) live in [binarygeek119/open-custom-posters](https://github.com/binarygeek119/open-custom-posters). Use them in your `public/custom` / Docker `custom` picture themes; open an issue to request more, or submit a pull request with your art in a folder named for your GitHub username.

---

## Prerequisites

**Required:** Plex, Jellyfin, Emby, or Kodi (Kodi needs HTTP JSON-RPC enabled).

**Optional:**
- Sonarr, Radarr, and/or Readarr (or a Chaptarr-compatible book stack)
- A TMDB API key, for the Now Showing view, movie search, and artwork lookups — set it in **Settings → TMDB API** or via the `TMDB_API_KEY` environment variable. Don't have one? Create a free TMDB account and request a key (choose "Developer" / API, v3 auth) at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) — approval is usually instant.

---

## Installation

### Docker Compose

Create these directories in your Docker folder:
- `./docker/onnow`
- `./docker/onnow/config`
- `./docker/onnow/custom`

```yaml
services:
  onnow:
    image: jdub1120/onnow:latest
    container_name: onnow
    environment:
      TZ: America/Chicago
      BASEPATH: ""
    volumes:
      - ./docker/onnow/config:/usr/src/app/config
      - ./docker/onnow/custom:/usr/src/app/public/custom
    ports:
      - 9876:3000
    restart: unless-stopped
    # Linux: reach Plex/Jellyfin/Emby/Kodi running on the Docker host (not needed on all setups).
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### Docker CLI

```
docker run -d --name onnow \
-p 9876:3000 \
-v ~/docker/onnow/config:/usr/src/app/config \
-v ~/docker/onnow/custom:/usr/src/app/public/custom \
-e TZ=America/Chicago \
--add-host=host.docker.internal:host-gateway \
--restart=always \
jdub1120/onnow:latest
```

`--add-host=host.docker.internal:host-gateway` (Docker Engine 20.10+) lets OnNow reach Plex/Jellyfin/Emby/Kodi running on the host itself (Linux). Omit it if you only use container-to-container names on a custom network.

### Unraid

Install via Docker using the Compose or `docker run` examples above, or a Community Applications template if one matches this image.

### Options reference

| Option | Details |
|--|--|
| `TZ` | Your local timezone — use the `TZ Database Name` value from [this list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). |
| `config` volume | **Required.** Holds `settings.json` and everything under `cache/` (poster metadata, downloaded images, theme MP3s). Use a persistent host directory — see the table below. |
| `custom` volume | Optional — for custom picture themes under `public/custom`. Omit if unused. |
| Ports | Change the first number to use a different host port, e.g. `9876:3000`. |
| `BASEPATH` | Set to `"/your-prefix"` if a reverse proxy serves OnNow under a subpath. Leave empty/omit otherwise. |
| `extra_hosts: host.docker.internal` | Lets the container reach a media server running on the Docker host itself (Linux; Docker Engine 20.10+). |

### What lives in the config volume

| Path (inside container) | Purpose |
|--|--|
| `config/settings.json` | OnNow settings |
| `config/posterr-poster-metadata.db` | Poster/library sync metadata (SQLite) |
| `config/now-showing.db` | TMDB Now Showing movie list |
| `config/ads.db` | Ad slide list (titles, prices, paths) |
| `config/ads/`, `config/ads-view/` | Uploaded ad images and optional full-page `/ads` backdrop |
| `config/cache/imagecache/` | Downloaded posters, fan art, and related images |
| `config/cache/mp3cache/` | Cached TV/movie theme MP3s |
| `config/cache/randomthemes/` | Optional random theme storage |

Mount one host folder to `/usr/src/app/config`; OnNow creates `cache/` and its subfolders on first use. If this path isn't persisted, settings, poster sync, and cached artwork are lost whenever the container is recreated.

**Migrating from an older separate `saved` volume:** that layout is deprecated. On the host directory you now mount as `config`, create `cache/` and move in the old `saved/imagecache`, `saved/mp3cache`, and `saved/posterr-poster-metadata.db` (so inside the container they land at `config/cache/...`).

### Reaching your media server from Docker

OnNow only needs outbound HTTP(S) to your server — no extra packages in the image.

| Where the server runs | What to enter as **host** in OnNow settings |
|--|--|
| Another container on the same Compose network | The service name (e.g. `jellyfin`, `emby`) and that service's port (often `8096`). |
| Same machine as Docker, outside containers (typical Kodi or bare-metal Plex) | `host.docker.internal` (with `extra_hosts` as shown above on Linux; Docker Desktop often works without it). |
| Another machine on your LAN | That machine's IP or hostname (the container must be able to route to it). |

**Kodi:** set server type to Kodi, port to Kodi's Web server/JSON-RPC port (often `8080`), and Token only if HTTP auth is enabled (otherwise leave blank).

For very large Jellyfin/Emby libraries, the optional `POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT` environment variable controls items-per-request during a full library walk (integer, `50`–`500`, default `300`).

**Example: Jellyfin on the same stack** — see [`docker-compose.media-servers.example.yml`](docker-compose.media-servers.example.yml):

```
docker compose -f docker-compose.yml -f docker-compose.media-servers.example.yml up -d
```

Then set server type to Jellyfin, host `jellyfin`, port `8096`, and your API key.

### Apple TV pairing over Docker (optional)

The Apple TV sidecar's ongoing polling of an *already-paired* device just needs plain IP reachability and works fine on the default bridge network. Host networking (Linux only) is only needed for the "discover devices on my network" / pairing flow, which needs multicast (mDNS) visibility into your LAN — see [`docker-compose.appletv.example.yml`](docker-compose.appletv.example.yml) for that overlay. If you're not on Linux, pair once from any machine on the same LAN (e.g. with `atvremote pair`), then add the device manually in **Settings → Apple TV** using its identifier/address/credentials.

---

## CEC control script (Raspberry Pi only)

For displays where the sleep timer should also power off the screen itself (not just blank it): install instructions are at [`scripts/scriptdoco.md`](scripts/scriptdoco.md).

---

## Updates

After upgrading to a new app version, a red "new features" banner appears on the main display and settings pages until you open **Settings** and acknowledge it. Your choice is stored in `settings.json` and the banner reappears on the next version bump.

For automated container updates, consider [Watchtower](https://containrrr.dev/watchtower/) or your stack's own update policy.

---

## First-time setup

Reach the settings page a few ways:
- You'll be prompted automatically on first load.
- Go directly to `http://hostIP:9876/settings` (swap in your actual host/port).
- Click the banner title on any slide.
- On the "no content" placeholder page, click the prompt text.

The default password is `raidisnotabackup`.

- **Now Showing:** configure the TMDB movie list at `/settings/now-showing`. The public schedule view is at `/now-showing` (add `?lowPower=1` to reduce animation on weaker devices).
- **Ads:** configure slides and timings at `/settings/ads`. The dedicated slideshow is at `/ads`, with independent timers for seconds-per-slide and how long to stay on the full-screen view before auto-returning home.

---

## Possible uses

- Mount a display on the wall to showcase your media library.
- Run it on a second monitor to keep an eye on what's currently playing.
- Put a small screen outside a home theater room to show when it's in use.
- Reverse-proxy or port-forward it so friends/family can see what's playing, available, or coming soon.

---

## Technical notes

- Built in Node.js, packaged as a Docker image with a built-in health check.
- Low resource use — roughly 20–35 MB memory, ~75 MB disk, under 1% CPU on a low-power NAS.
- Polls now-playing status every 10 seconds (already-open browser tabs pick up changes once the current slide cycle finishes or the page refreshes).
- Browser-based — the app can run on one machine with the display on another.
- Auto-reconnects the browser if the OnNow process restarts (e.g. during a container update).
- Supports screen heights from roughly 320px to 3500px, and reverse-proxy setups with a custom base path.
- Falls back gracefully if the poster app or your media server goes temporarily offline.

Configuration not covered here largely still matches the original project — see the [upstream Posterr wiki](https://github.com/petersem/posterr/wiki/Posterr-Configuration) and [troubleshooting guide](https://github.com/petersem/posterr/wiki/Troubleshooting).

---

## Support this project

If OnNow has been useful to you, donations toward continued development are welcome: [paypal.me/jdub1120](https://paypal.me/jdub1120).

This project builds on real work by others — if you'd like to support them too:
- Matt Petersen (original Posterr author): [paypal.com/paypalme/thanksmp](https://www.paypal.com/paypalme/thanksmp)

---

## Built with

- Node.js & Express
- [node-plex-api](https://github.com/phillipj/node-plex-api)
- jQuery, Bootstrap, Font Awesome
- Plex (PlexAPI), Jellyfin/Emby (REST), Kodi (JSON-RPC over HTTP)
- Sonarr, Radarr, and Readarr (via their APIs)
- Posters and artwork from your media server, TVDB, and TMDB
- Awtrix (via API)
- pyatv, for Apple TV Now Playing

---

## Notice

OnNow depends on third-party applications and services. Some features may fail temporarily or permanently if those dependencies are unavailable or become incompatible. This software comes with no warranty. Images and themes you download may be copyrighted by their respective owners.

## License

MIT — see [`LICENSE`](LICENSE).
