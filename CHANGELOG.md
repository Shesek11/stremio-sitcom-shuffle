# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
