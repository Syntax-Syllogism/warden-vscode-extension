# Input System

How the extension collects flag values from the user before running a Warden CLI command.

## Overview

`src/input/gatherInputs.ts` is the entry point. `gatherInputs(command, store, inputApi)` iterates over a command's flag definitions and calls `gatherFlag(...)` for each one. The return value is `GatheredInputs` — an `args` array ready to pass to the CLI and a `displayArgs` array for the Output Channel.

`InputApi` is the seam between business logic and VS Code UI. Tests stub it directly; `createVsCodeInputApi()` wires the real pickers for production.

## Flag kinds and their pickers

| `flag.kind` | Picker called | Source file |
|---|---|---|
| `org` | `inputApi.pickOrg(lastValue)` | `src/input/orgPicker.ts` |
| `file` | `inputApi.pickDefFile(options)` | `src/input/defFilePicker.ts` |
| `outputDir` | `inputApi.pickOutputDirectory(options)` | `src/input/outputDirPicker.ts` (not currently exercised by any warden command) |
| `enum` | `inputApi.showQuickPick(options)` | inline in `gatherFlag` |
| `string` / `apiVersion` | `inputApi.showInputBox(options)` | inline in `gatherFlag` |
| `boolean` | collected separately via `inputApi.showBooleanPick(...)` | inline in `gatherInputs` |

The exclusive group `--user` / `--users-def` is gathered by `gatherExclusiveGroup(...)` when the first group member is reached in the loop, using `inputApi.showQuickPick`. A flag carrying `dependsOnFlag` is skipped in the main loop and gathered as a follow-up right after its target flag is selected inside the group — for example `--external-id` is only prompted once `--users-def` is chosen, never in the single-user (`--user`) path. `warden diff`'s `--against` and `--personas-def` use the same mechanism, keyed off `--user` and `--users-def` respectively.

## Definition file picker (`file`)

`pickDefFile` in `src/input/defFilePicker.ts` is the default picker for `file`-kind flags. It presents a workspace-scoped Quick Pick of `.json` files and does not offer a native OS file dialog fallback.

Candidates are discovered with `vscode.workspace.findFiles('**/*.json', JSON_EXCLUDE_GLOB, 200)`, where the exclude glob skips noisy folders such as `.git`, `.sf`, `.sfdx`, `.vscode`, `node_modules`, `dist`, `out`, and `coverage`. The discovered workspace-relative paths are then filtered through `git check-ignore --stdin -z`, so files ignored by `.gitignore`, `.git/info/exclude`, or global git ignore rules are omitted. If Git is unavailable or the workspace is not a Git repository, the filter fails open and keeps the discovered candidates.

`warden restore --snapshot` opts into including Git-ignored JSON files, so ephemeral snapshots remain selectable while ordinary definition-file prompts keep the default filter.

The last-used value is stored as a workspace-relative file path. On the next run, the picker checks that the path still exists, is not a directory, remains inside the workspace, and is not ignored by Git. Valid last-used files are injected as the first Quick Pick item with description `Last used - <parent directory>`.

Selected values are passed to the CLI as workspace-relative paths, for example `config/users.json`. Cancelling a required `file` prompt aborts the command; cancelling an optional non-exclusive `file` prompt skips that flag. Cancelling after choosing a member of an exclusive group, such as `Users definition file` in the `userTarget` group, aborts the command because the user has already committed to that targeting path.

## Output directory picker (`outputDir`)

`pickOutputDirectory` in `src/input/outputDirPicker.ts` presents a Quick Pick before falling back to the native OS folder dialog. No warden command currently declares an `outputDir`-kind flag (this was used only by the AEP-generation domain's `--output-path` flag before the CLI/extension split); the module is kept as shared generic scaffolding — duplication of this kind of code between the `warden-code-ext` and `apx-code-ext` extensions is accepted rather than shared, per the split decision. Candidates, when used, are built in this order:

1. **Default** — the flag's `default` value, labelled `Default`.
2. **Last used** — the memento-stored value from the previous run, labelled `Last used`, shown only when it differs from the default.
3. **Package directories** — paths from `sfdx-project.json` `packageDirectories`, with the `default: true` entry first, labelled `Package directory`. Missing or malformed JSON is silently skipped.
4. **Workspace child folders** — direct subdirectories of the workspace root that are not noise dirs (`.git`, `.sf`, `.sfdx`, `node_modules`, `dist`, `out`, `coverage`, `.vscode`), labelled `Workspace folder`.
5. **Choose Different Folder...** — opens the native OS folder picker via `pickFolder(...)` from `src/input/filePicker.ts`, which enforces workspace-relative output and rejects out-of-workspace selections with a warning.

Candidates are deduplicated through `showWorkspaceQuickPick(...)` in `src/input/workspaceQuickPick.ts`; the first label/description wins. On Windows, deduplication is case-insensitive.

The picker returns a **workspace-relative path string** in all cases (or `undefined` on cancel).

`pickFolder(...)` in `src/input/filePicker.ts` remains the native folder-dialog helper used only by the output-directory custom fallback. `pickFile(...)` remains available for future specialized file prompts, but the generic `file` flag flow uses `pickDefFile(...)`.

## Adding a new flag kind

1. Add the kind string to `FlagKind` in `src/registry/types.ts`.
2. Add a new method to `InputApi` in `src/input/gatherInputs.ts` if the picker logic warrants a testable seam; otherwise call a VS Code API directly in `gatherFlag`.
3. Wire the real implementation in `createVsCodeInputApi()`.
4. Add the dispatch branch in `gatherFlag(...)`.
5. Add the new kind to the `knownKinds` set in `src/test/extension.test.ts` and write targeted tests.

## Last-value persistence

`LastValueStore` (`src/util/memento.ts`) wraps a VS Code `Memento` and keys values by `(commandId, flagName)`, prefixed with `warden:`. `gatherFlag` reads it before prompting and writes it after a successful pick.

For `file`-kind flags, the stored value is the selected workspace-relative file path. Older memento values that point at directories or paths outside the workspace are treated as absent by `pickDefFile(...)`. For `outputDir` flags, the stored value is the selected workspace-relative directory path.
