# Warden

Warden is a VS Code extension for guided `@syntax-syllogism/warden` Salesforce CLI workflows: provisioning, auditing, freezing, and restoring users.

## Features

- Command Palette entries and Warden sidebar actions for every supported command.
- User Lifecycle commands:
  - `SF Warden: Provision` (`sf warden provision`)
  - `SF Warden: Access` (`sf warden access`)
  - `SF Warden: Strip` (`sf warden strip`)
  - `SF Warden: Freeze` (`sf warden freeze`)
  - `SF Warden: Unfreeze` (`sf warden unfreeze`)
  - `SF Warden: Snapshot` (`sf warden snapshot`)
  - `SF Warden: Restore` (`sf warden restore`)
  - `SF Warden: Diff` (`sf warden diff`)
- Dedicated Warden activity-bar view: all 8 commands are listed flat under a single User Lifecycle group.
- Guided native inputs:
  - Salesforce org picker with `warden.defaultTargetOrg` fallback.
  - Workspace JSON Quick Pick for definition-file flags such as `--users-def` and `--personas-def`, with last-used files surfaced first.
  - QuickPick enums for flags such as `--type` on Access.
  - Single-select QuickPick for mutually exclusive user targeting (`--user` or `--users-def`).
  - Multi-select QuickPick for boolean options, such as `--dry-run`.
  - InputBox prompts for string values such as usernames and match fields.
- Background `sf warden ...` execution through `child_process.spawn`, streamed to the `Warden` Output Channel.
- Cancellable progress notifications while commands run.
- Human-readable CLI output by default; the extension does not force `--json`.
- Automatic `--no-prompt` only for commands that support it (`Restore` exposes `--no-prompt` as an ordinary picker option instead).
- **Strip dry-run/apply flow:** `SF Warden: Strip` is the one destructive command in the set. Running it always previews first:
  1. The extension confirms you want to run the command, then spawns `sf warden strip ... --dry-run` and streams the preview to the Warden output channel.
  2. If the dry run fails, an error is shown and the flow stops.
  3. On success, a modal warning asks "Apply the strip changes shown in the Warden output channel?" — only on confirming **Apply** does the extension re-run the same command without `--dry-run` to perform the actual strip.
  No other Warden command uses this two-step strategy.
- Pre-run detection for the Salesforce CLI and the warden plugin, with an install action when the plugin is missing.

## Requirements

Install the Salesforce CLI and the warden plugin before running commands:

```sh
sf plugins install @syntax-syllogism/warden
```

The extension checks for `sf` and `sf warden --help` before the first command run. If the plugin is missing, it offers an install action.

## Extension Settings

- `warden.defaultTargetOrg`: default Salesforce org alias or username for Warden commands.

## Development

### Quick Start

```sh
npm install
npm test
npm run package:vsix
```

See [docs/README.md](docs/README.md) for comprehensive developer documentation, including:

- **[Architecture Overview](docs/architecture.md)** — Design and components
- **[Input System](docs/input-system.md)** — How user input is collected
- **[Command Runner](docs/command-runner.md)** — Command execution, including the strip dry-run/apply flow
- **[Command Registry](docs/command-registry.md)** — Command definitions and generation
- **[Extending the Extension](docs/extending.md)** — Adding new commands and features
- **[Testing Guide](docs/testing.md)** — Writing and running tests

### Updating Commands

Refresh the committed command registry from a warden oclif manifest:

```sh
npm run gen:commands -- vendor/warden.oclif.manifest.json src/registry/commands.generated.ts
```

This is needed when the warden CLI plugin adds new commands or changes flag definitions. `vendor/warden.oclif.manifest.json` is a manually vendored, point-in-time copy of the warden CLI's `oclif.manifest.json` (generated there by `yarn build`); refresh it by copying the file from the sibling `warden` CLI repo whenever the plugin changes.
