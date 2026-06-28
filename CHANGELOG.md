# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Binge / autoplay series.** A second catalog, *Sitcom Shuffle (Binge / Autoplay)*,
  exposes the whole shuffle as a single `series` (`scs:binge`) with every episode as a
  sequential video (`S01E01..N`). Stremio plays them in order and autoplays the next
  episode after each one. Each video keeps its real `imdb:season:episode` id, so
  external stream addons (Torrentio, etc.) resolve playback exactly as before. The
  original per-episode catalog is unchanged and lives alongside it. The binge order is
  re-shuffled every time the binge catalog is opened and cached so the order stays
  stable mid-watch. Addon version bumped to `25.0.0` so Stremio picks up the new catalog.

### Fixed

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
