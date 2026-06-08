# Sitcom Shuffle — Stremio Addon

A self-hosted [Stremio](https://www.stremio.com/) addon that serves a continuously
re-shuffled catalog of episodes from your favorite sitcoms. Point it at a
[Trakt](https://trakt.tv/) list of shows and it builds a "fair shuffle" catalog —
one episode from each show in rotation (round-robin), re-mixed every time you open
it so you keep discovering different episodes instead of seeing the same few.

## How it works

1. **Data fetch (slow, scheduled).** A cron job (`fetchAndShuffle`) reads the shows
   from your Trakt list, pulls every episode via the Trakt API, enriches them with
   poster/background art from TMDB, and stores the result in `~/data/episodes.json`.
   Runs every 6 hours by default.
2. **Shuffle (fast, on demand).** The shuffle is **decoupled** from the fetch. Every
   time the catalog is opened (`skip=0`), the stored episodes are re-shuffled fresh,
   so the top of the list changes on each open. Scrolling further (`skip>0`) reads
   from a cached order so pagination stays consistent during a single scroll.

### Fair shuffle algorithm

`fairShuffle` groups episodes by show, shuffles each show's episodes internally,
then emits them round-robin: each round takes one episode from every show (in a
randomized show order), so consecutive items come from different shows. Because the
shuffle now runs on every catalog open, you progressively reach all episodes of
every show rather than being stuck on the same first few.

## Setup

### Requirements

- Node.js >= 18
- A Trakt account + API app (client id/secret) — https://trakt.tv/oauth/applications
- A Trakt list of shows
- (Optional) A TMDB API key for poster/background art — https://www.themoviedb.org/settings/api

### Install

```bash
npm install
```

### Environment variables

Create a `.env` file in the project root (or in the home directory — the app checks
the project dir first, then `~/.env`, so config survives redeploys):

| Variable               | Required | Description                                              |
|------------------------|----------|----------------------------------------------------------|
| `TRAKT_USERNAME`       | yes      | Your Trakt username                                       |
| `TRAKT_LIST_SLUG`      | yes      | Slug of the Trakt list of shows to pull from             |
| `TRAKT_CLIENT_ID`      | yes      | Trakt API app client id                                  |
| `TRAKT_CLIENT_SECRET`  | yes      | Trakt API app client secret                              |
| `TRAKT_ACCESS_TOKEN`   | yes      | OAuth access token (auto-refreshed and cached on disk)   |
| `TRAKT_REFRESH_TOKEN`  | yes      | OAuth refresh token                                      |
| `TMDB_API_KEY`         | no       | TMDB key for poster/background images                    |
| `CRON_SCHEDULE`        | no       | Cron expression for the data refresh (default `0 */6 * * *`) |
| `PORT`                 | no       | HTTP port (default `3020`)                               |

Tokens are persisted to `~/data/tokens.json` and refreshed automatically on 401/403.

### Run

```bash
npm start
```

On first start, if `~/data/episodes.json` doesn't exist, an initial fetch runs
automatically. After that the cron handles periodic refreshes.

## Install in Stremio

Add the addon by URL:

```
http://<your-host>:<port>/manifest.json
```

## Endpoints

| Path                  | Purpose                                                        |
|-----------------------|---------------------------------------------------------------|
| `/manifest.json`      | Stremio addon manifest                                         |
| `/catalog/...`        | Shuffled episode catalog (re-shuffles on each fresh open)      |
| `/meta/...`           | Episode metadata                                               |
| `/stream/...`         | Stream handler (returns no streams — discovery only)           |
| `/`                   | Health check (used by TV clients)                              |
| `/reshuffle`          | Manually trigger a full Trakt fetch + shuffle (returns count)  |

## Deployment

Deployed on **xCloud** (not Vercel). The app runs under PM2 and serves over HTTP.
Pushing to the `main` branch triggers auto-deploy.

> **Note on persistence:** xCloud/PM2 can drop processes after a server reboot. If
> the catalog stops refreshing with new shows/episodes, verify the cron is actually
> running — see the `xcloud-nodejs-persistence` guidance (PM2 `@reboot` cron +
> ecosystem config). The on-open shuffle works regardless of the cron, but new Trakt
> data only arrives when the fetch runs.

## Project layout

| File / dir       | Role                                                              |
|------------------|------------------------------------------------------------------|
| `server.js`      | **Active app** — Express + stremio-addon-sdk, fetch, shuffle, serve |
| `api/`           | Legacy Vercel serverless implementation (not used on xCloud)     |
| `~/data/`        | Runtime data (`episodes.json`, `tokens.json`) — outside the repo  |

## License

MIT
