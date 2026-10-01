# Warden

Warden provides guided VS Code workflows for provisioning, auditing, freezing, stripping, snapshotting, restoring, and comparing Salesforce users. All eight commands run in the extension host through `@syntax-syllogism/warden-core`.

## Requirements

Authenticate an org with `sf org login web` before running a command. The Salesforce CLI is needed for login; the Warden CLI plugin is not required. When no authenticated org is found, the extension offers a terminal shortcut for login.

## Features

- Command Palette actions and a Warden sidebar for Provision, Access, Diff, Freeze, Unfreeze, Strip, Snapshot, and Restore.
- Prompts based on core option schemas and UI hints, including related records, CSV input format and list delimiter, and the `record-type` access type.
- A rendered plan preview and modal confirmation before every write. Closing the confirmation applies nothing.
- Cancellable progress notifications, human results in the Warden output channel, and optional workspace-relative `.csv` or JSON output files.
- JSON validation for persona, users, and related-catalog definitions. When a filename does not match an association pattern, set `$schema` to the corresponding core schema ID:
  - Persona: `https://raw.githubusercontent.com/Syntax-Syllogism/warden-core/release/schemas/persona-definitions.schema.json`
  - Users: `https://raw.githubusercontent.com/Syntax-Syllogism/warden-core/release/schemas/users-definition.schema.json`
  - Related catalog: `https://raw.githubusercontent.com/Syntax-Syllogism/warden-core/release/schemas/related-catalog.schema.json`

`warden.defaultTargetOrg` sets the initial org picker value. Last-used input values are stored per command and option key.

## Development

```sh
npm ci --ignore-scripts
npm run compile
xvfb-run -a npm run test
npm run package:vsix
```

When warden-core descriptors change, pin the new exact version and run `npm run sync:contributes`. See the [documentation index](docs/README.md) for implementation details.
