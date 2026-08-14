# Changelog

All notable changes to this project are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [0.4.3] - 2026-08-14

### Fixed

- Treat unavailable optional enrichment as informational output instead of a plugin warning.
- Prevent normal SCOPE.GG, FACEIT lifetime-stat, and recent K/D gaps from showing a yellow warning in Millennium.

### Added

- Public release documentation, real Steam screenshots, CI, and an installable archive script.

## [0.4.2] - 2026-08-14

### Fixed

- Keep match count and K/D inside narrow profile cards with responsive wrapping.

## [0.4.1] - 2026-08-14

### Changed

- Refined Aim presentation: `85–92` uses a target marker and values above `92` use an anomalous-rating marker.

## [0.4.0] - 2026-08-14

### Added

- Recent K/D and tracked-match count in the compact card.
- FACEIT level, match count, and rank colors.
- Premier rank colors and Aim rating markers.
- On-demand public CS2 inventory estimates using Steam Market prices.

### Fixed

- FACEIT lifetime-stat lookup now uses the discovered FACEIT nickname.

## [0.3.0] - 2026-08-14

### Changed

- Rebuilt the profile card with a Steam-native compact summary and detail tabs.

### Added

- Recent match form and match history.
- Graceful empty and partial-data states.
