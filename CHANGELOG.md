# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Rich episode details (Nuvio / Stremio episode cards).** Episodes now carry a
  thumbnail (TMDB episode still), overview, real air date, runtime and rating, on the
  binge series, the per-episode meta and the catalog tiles (background, description,
  rating). Trakt is queried with `extended=full,episodes` (overviews were always
  empty before) and each season is enriched from TMDB. `runtime`/`rating` are sent
  as strings because Nuvio parses them that way.

- **Hands-free binge: built-in stream aggregation.** Binge episodes now use a
  `scs:`-prefixed video id, so their stream requests route to this addon instead of
  showing every installed addon's list. The addon fetches streams from upstream
  addons itself (`UPSTREAM_ADDONS` env — comma-separated base URLs in priority
  order, default Torrentio), returns them in that order, and tags every stream with
  a constant `behaviorHints.bingeGroup` (`scs-binge`). With Stremio's *Play next
  episode* setting on, the top stream of each next episode is auto-selected — one
  stream click on the first episode, then non-stop playback with no source-selection
  screen. The per-episode catalog still uses raw imdb ids and external addons.

- **Binge / autoplay series.** A second catalog, *Sitcom Shuffle (Binge / Autoplay)*,
  exposes the whole shuffle as a single `series` (`scs:binge`) with every episode as a
  sequential video (`S01E01..N`). Stremio plays them in order and autoplays the next
  episode after each one. Each video keeps its real `imdb:season:episode` id, so
  external stream addons (Torrentio, etc.) resolve playback exactly as before. The
  original per-episode catalog is unchanged and lives alongside it. The binge order is
  re-shuffled every time the binge catalog is opened and cached so the order stays
  stable mid-watch. Addon version bumped to `25.0.0` so Stremio picks up the new catalog.

### Fixed

- Trakt token refresh now sends an https redirect URI (`TRAKT_REDIRECT_URI`), since
  apps on the new Trakt developer portal no longer accept the `urn:ietf:wg:oauth:2.0:oob` URI.
- A data fetch that returns 0 episodes (Trakt outage / API change) no longer
  overwrites the stored catalog with an empty one.
- **Haverot (חברות) never appeared in the catalog.** Trakt and TMDB have no IMDB id
  for the show even though IMDB lists it (`tt3046098`), and the catalog filters out
  episodes without an IMDB id. Added a local `IMDB_OVERRIDES` map that fills in
  missing IMDB ids at fetch time; Haverot's 51 episodes now enter the shuffle.
  Same treatment for Prudim (פרודים, `tt4792146`), which was also added to the
  Trakt list via API since its Hebrew-only title makes it hard to find in search.

- **Shuffle felt static — same few episodes always at the top.** The shuffle was
  coupled to the Trakt data fetch, which only runs every 6 hours (and may not run at
  all if the cron isn't persisted), so the stored list stayed frozen between fetches.
  Since Stremio always shows the head of the list, users saw the same 4-5 episodes
  per show on every open. The shuffle is now **decoupled** from the fetch and runs on
  every fresh catalog open (`skip=0`), re-mixing the stored episodes each time.
  Pagination within a single scroll (`skip>0`) reads from a cached order to stay
  consistent. The round-robin "fair shuffle" behavior is unchanged.

### Added

- `README.md` documenting setup, environment variables, endpoints, the shuffle
  algorithm, and xCloud deployment notes.
- `CHANGELOG.md` (this file).

## Notes

This changelog was introduced partway through the project's life. Earlier history is
available in the git log — recent milestones include migrating to `stremio-addon-sdk`
for TV compatibility, catalog pagination via the `skip` extra, and Trakt private-list
support via the `/users/me/` endpoint.
