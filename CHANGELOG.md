# Change Log

All notable changes to the "warden-ext" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.3.1] - 2026-10-01

### Changed

- Updated to warden-core 0.4.1.
- Commands run in process through warden-core. The Warden CLI plugin is no longer required; authenticate with `sf org login`.
- Every write previews a plan before Apply, replacing dry-run. Strip snapshot, provision fail-on-insufficient-license, diff verbose, and restore no-prompt CLI-only inputs were removed.
- Added related-records, CSV format and delimiter options, record-type access, and CSV output files.
- Last-used inputs reset once because persistence now uses core option keys.
- Added JSON Schema validation for persona, users, and related-catalog definitions.

### Performance

- Against the `warden-dev` scratch org, the packaged extension bundle took 2.143 s cold and 0.501 s warm to preview and cancel provision with an empty users file, and 2.098 s cold and 0.796 s warm for an object access audit. Each cold run started a fresh process; the warm run repeated the command in that process. The earlier spawned-command baseline was 5.6 s. These scripted bundle measurements do not cover the installed-VSIX UI smoke checklist.

## [0.2.0] - 2026-07-27

### Added

- Synced the generated command registry with warden CLI v0.2.0, including profile-only flows, reverse-audit flags, CSV definition files, and `--output-file` capture with an Open File action.

## [0.1.0] - 2026-07-12

### Added

- Initial release — extracted from jawn-code-ext. Ships the 8 User Lifecycle commands (`SF Warden: Provision`, `Access`, `Strip`, `Freeze`, `Unfreeze`, `Snapshot`, `Restore`, `Diff`) targeting the standalone `@syntax-syllogism/warden` Salesforce CLI plugin, including the Strip dry-run/apply confirmation flow.
