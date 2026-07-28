# Command Registry

The Command Registry defines all available Warden commands and their flags. It is automatically generated from the warden CLI plugin's oclif manifest.

## Overview

The registry has two layers:

1. **Type definitions** (`src/registry/types.ts`) — `CommandDef` and `FlagDef` interfaces
2. **Command data** (`src/registry/commands.generated.ts`) — Auto-generated from the oclif manifest

## Regenerating Commands

When the warden plugin releases new commands or changes flag definitions, regenerate the registry:

```bash
npm run gen:commands -- vendor/warden.oclif.manifest.json src/registry/commands.generated.ts
```

This script:

1. Parses the oclif manifest (JSON)
2. Filters to whitelisted commands (see `allowList`)
3. Extracts flags and infers UI metadata
4. Writes `src/registry/commands.generated.ts`
5. Updates `package.json` contributes list

## Command Definition (`CommandDef`)

```typescript
interface CommandDef {
  id: string;                     // VS Code command ID (e.g., 'warden.provision')
  cliId: string;                  // CLI command ID (e.g., 'warden provision')
  title: string;                  // Display title (e.g., 'SF Warden: Provision')
  group: string;                  // Sidebar group (always 'User Lifecycle' for warden)
  subgroup?: string;              // Unused by warden — no command sets it
  supportsNoPrompt?: boolean;     // If true, add --no-prompt automatically
  destructive?: boolean;          // If true, use dry-run → confirm → apply workflow
  requireOneOf?: string[];        // Unused by warden — no command requires a choice among booleans
  flags: FlagDef[];               // Flag definitions in prompt order
}
```

## Flag Definition (`FlagDef`)

```typescript
interface FlagDef {
  name: string;                 // CLI flag name (e.g., 'target-org')
  kind: FlagKind;               // UI type ('org' | 'file' | 'outputDir' | 'outputFile' | 'string' | 'boolean' | 'apiVersion' | 'enum')
  summary?: string;             // Description shown to user
  required?: boolean;           // If true, flag is mandatory
  options?: string[];           // For enum kind: allowed values
  placeholder?: string;         // For string/file kinds: example text
  exclusiveGroup?: string;      // Mutually exclusive group name
  dependsOnFlag?: string;       // Only prompt once the named flag has been chosen
  default?: string;             // Default value
}
```

## Flag Kinds

The UI presentation of each flag is determined by its `kind`:

| Kind | Picker | Use case |
|------|--------|----------|
| `org` | Org picker with cached value | `--target-org` |
| `file` | Workspace JSON/CSV Quick Pick for `--users-def`; JSON Quick Pick for other file flags | Definition files like `--users-def`, `--personas-def`, `--snapshot` |
| `outputDir` | Directory picker (Quick Pick + fallback to native dialog) | Not currently used by any warden command; the picker remains shared scaffolding |
| `outputFile` | Workspace-relative text input path | `--output-file` |
| `string` | Text input box | Usernames, external-id field names |
| `apiVersion` | Text input box with version number validation | `--api-version` (currently hidden from the UI for all warden commands) |
| `enum` | Quick Pick with predefined options | `--type` on `warden access` |
| `boolean` | Multi-select Quick Pick | `--dry-run`, `--no-prompt` (on `warden restore` only), `warden strip`'s `--no-freeze`/`--no-deactivate`/`--keep-*` toggles |

## Generation Rules

The `scripts/gen-commands.ts` script applies these rules:

### Whitelisting

Only commands in the `allowList` are exposed. This prevents accidental inclusion of CLI-only or internal commands. The complete whitelist for this extension:

- `warden provision`
- `warden access`
- `warden strip`
- `warden freeze`
- `warden unfreeze`
- `warden snapshot`
- `warden restore`
- `warden diff`

### Flag Kind Inference

Flag kind is inferred based on the flag name and type:

```typescript
function flagKind(commandId: string, name: string, flag: ManifestFlag): string {
  if (name === 'target-org') return 'org';
  if (name === 'api-version') return 'apiVersion';
  if (name === 'output-path') return 'outputDir';
  if (name === 'output-file') return 'outputFile';
  if (commandId === 'warden restore' && name === 'snapshot') return 'file';
  if (flag.type === 'boolean') return 'boolean';
  if (flag.options?.length) return 'enum';
  if (flag.type === 'option' && /file|path|def$/.test(name)) return 'file';
  return 'string';  // Default
}
```

### Exclusive Groups

Flags are mutually exclusive and grouped for single-select UI:

- **`userTarget`** — Flags: `--user`, `--users-def`
  - Used to select how users are specified: a single user (`field:value`) or a JSON/CSV definition file
  - Only one can be selected
  - `--external-id` depends on this choice (see Flag Ordering): it is only prompted when `--users-def` is selected, since it sets the default match field for definition-file entries

### Hidden Flags

Some CLI flags are hidden from the UI (not prompted for):

- `--json` — Extension reads human-readable output
- `--no-prompt` — Added automatically if `supportsNoPrompt: true` (except on `warden restore`, where it is exposed as a normal picker option instead — see below)
- `--api-version` — Not exposed; could be added if needed
- `--flags-dir` — Not supported

Some commands have additional hidden flags:

- All commands — Hide `--output`, `--input-format`, and `--csv-list-delimiter`; output format is selected internally when `--output-file` is used.
- `warden snapshot` — Hides `--out`
- `warden diff` — Hides `--fail-on-drift`

### `warden restore`'s `--no-prompt` special case

`warden restore` is the one command where `--no-prompt` is exposed as an ordinary picker option rather than injected automatically. Two places in `scripts/gen-commands.ts` special-case `'warden restore'` for this:

- `commandDef()` skips setting `supportsNoPrompt` when `cliId === 'warden restore'`.
- `shouldPromptForFlag()` does not hide `no-prompt` when `commandId === 'warden restore'`.

### Flag Ordering

Flags are prompted in this order:

1. Flags specified in the flag order rules
2. All other flags in manifest order

Order rules apply to `warden strip`, `warden freeze`, `warden unfreeze`, `warden snapshot`, and `warden diff`:

- `--user` is ordered first so the `userTarget` choice (single user vs. definition file) is surfaced before `--target-org`
- `--output-file` is ordered last so the destination is prompted after command inputs
- Rest in manifest order

`--external-id` carries `dependsOnFlag: 'users-def'`, so it is skipped in the normal
sequence and only prompted after `--users-def` is selected in the `userTarget` group.
Single-user targeting never prompts for it. See [Deferred (dependent) flags](#deferred-dependent-flags).

### Deferred (dependent) flags

A flag with `dependsOnFlag: '<other-flag>'` is not prompted in the normal sequence.
Instead, it is gathered as a follow-up immediately after `<other-flag>` is selected
inside its exclusive group. This is how `--external-id` is deferred until the
`--users-def` branch of the `userTarget` choice is taken, keeping it out of the
single-user path where it is meaningless. `warden diff`'s `--against` (depends on `--user`)
and `--personas-def` (depends on `--users-def`) use the same mechanism, wired explicitly
in `dependsOnFlagFor()`.

### Placeholders

Input boxes show placeholder text to guide the user:

- `*:user` → `Username:myUser@email.com` (any command; `--user` takes `field:value`)
- `warden access:target` → `Object__c.Field__c` (specific command)
- `warden diff:against` → `Username:otherUser@email.com` (specific command)

Placeholders are defined as `placeholderByCommandFlag` map and can be extended.

### Summaries

Summaries are displayed as descriptions in pickers and input boxes, sourced in this priority:

1. Custom summary from `summaryByCommandFlag` map
2. Wildcard summary (`*:flagName`)
3. Flag's own `summary` from manifest
4. Flag's own `description` from manifest
5. (no summary if none match)

## Extending the Registry

### To add a new command

1. Ensure the command is added to the warden CLI plugin (not this extension)
2. Add the command ID to `allowList` in `scripts/gen-commands.ts`
3. Add a title mapping to `titleById`
4. Add a group mapping to `groupById` (warden has no subgroups)
5. Add any ordering, placeholder, or summary overrides
6. Run `npm run gen:commands` to regenerate

### To add a new flag kind

1. Add the kind string to `FlagKind` in `src/registry/types.ts`
2. Add inference logic to `flagKind()` in `scripts/gen-commands.ts`
3. Add UI handling in `src/input/gatherInputs.ts` (new `gatherFlag()` branch or new method on `InputApi`)
4. Wire the real implementation in `createVsCodeInputApi()`
5. Add tests to `src/test/extension.test.ts`

See [input-system.md](input-system.md#adding-a-new-flag-kind) for the full process.

### To adjust UI metadata

Edit the maps in `scripts/gen-commands.ts`:

- `titleById` — Display name for Command Palette
- `groupById` — Sidebar group (always `User Lifecycle` for warden today)
- `placeholderByCommandFlag` — Placeholder text for input boxes
- `summaryByCommandFlag` — Description text for pickers
- `guiHiddenFlagsByCommand` — Flags to exclude from UI
- `userTargetFlags` — Exclusive flag group for `--user`/`--users-def`
- `dependsOnFlagFor()` — Defer a flag until another is selected (e.g. `--external-id` after `--users-def`)
- Flag ordering in `flagOrder()`

After editing, run `npm run gen:commands` to update.

## Example: Generated Command

Here's how `warden provision` looks after generation:

```typescript
{
  id: 'warden.provision',
  cliId: 'warden provision',
  title: 'SF Warden: Provision',
  group: 'User Lifecycle',
  supportsNoPrompt: true,
  flags: [
    {
      name: 'target-org',
      kind: 'org',
      required: true,
      summary: 'Target org username or alias.',
    },
    {
      name: 'users-def',
      kind: 'file',
      required: true,
      summary: 'Path to user definition JSON or CSV file.',
    },
    {
      name: 'personas-def',
      kind: 'file',
      required: true,
      summary: 'Path to persona definition JSON file.',
    },
    // ... more flags
  ],
}
```

When this is executed, the extension:

1. Prompts for each flag in order (target-org, users-def, personas-def, ...)
2. Builds args: `['warden', 'provision', '--target-org', 'my-org', '--users-def', 'config/users.json', ...]`
3. Adds internal flag: `--no-prompt` (because `supportsNoPrompt: true`)
4. Spawns: `sf warden provision --target-org my-org --users-def config/users.json --no-prompt`
