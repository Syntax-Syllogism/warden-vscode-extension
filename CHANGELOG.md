# Change Log

All notable changes to the "warden-ext" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0] - 2026-07-27

### Added

- Synced the generated command registry with warden CLI v0.2.0, including profile-only flows, reverse-audit flags, CSV definition files, and `--output-file` capture with an Open File action.

## [0.1.0] - 2026-07-12

### Added

- Initial release — extracted from jawn-code-ext. Ships the 8 User Lifecycle commands (`SF Warden: Provision`, `Access`, `Strip`, `Freeze`, `Unfreeze`, `Snapshot`, `Restore`, `Diff`) targeting the standalone `@syntax-syllogism/warden` Salesforce CLI plugin, including the Strip dry-run/apply confirmation flow.
