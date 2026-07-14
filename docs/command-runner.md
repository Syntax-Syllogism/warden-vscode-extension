# Command Runner

The Command Runner is responsible for executing Warden CLI commands, managing their lifecycle, and communicating results to the user.

## Overview

`src/runner/commandRunner.ts` exports `createCommandRunner(deps)` which returns a `CommandRunner` interface with a single method:

```typescript
run(command: CommandDef, inputs: GatheredInputs): Promise<void>
```

## Execution Flow

### Normal Commands

1. **Build arguments** — Combine command ID, user inputs, and internal flags
2. **Display command** — Show the full `sf warden ...` command in the Output Channel
3. **Spawn process** — Use `spawnSf(args)` to start the CLI as a child process
4. **Stream output** — Pipe stdout/stderr to the Output Channel in real-time
5. **Wait for exit** — Track the process exit code and handle completion

### Destructive Commands

The one command with `destructive: true` (`warden strip`) follows a two-step workflow:

1. **Dry-run phase** —
   - Spawn with `--dry-run` flag automatically added
   - Display the changes that would be made
   - Let user review the preview in the Output Channel
   - If dry-run fails, abort the operation
   - On cancellation, return early

2. **Confirmation phase** —
   - Show a warning modal: "Apply the strip changes shown in the Warden output channel?"
   - User can accept or decline
   - If accepted, proceed to apply phase

3. **Apply phase** —
   - Spawn again without `--dry-run` flag
   - Execute the actual command
   - User sees live output in the Output Channel

If the user cancels at any phase, the operation stops cleanly.

## Confirmation Dialogs

Two types of confirmation modes are supported:

### Dry-Run Confirmation (Destructive Commands)

```
[Preview sf warden strip, then confirm before applying changes?]
[Don't run]  [Run]
```

Then after the dry-run preview:

```
[Apply the strip changes shown in the Warden output channel?]
[Cancel]  [Apply]
```

### Pre-run Confirmation (Optional)

For non-destructive commands that might benefit from user review, the `requiresRunConfirmation()` logic can prompt:

```
[Run sf warden ...]
[Don't run]  [Run]
```

Currently this is not used for any commands, but the infrastructure is in place.

## Progress Management

While a command runs, the extension shows a progress notification:

```
Running sf warden <command>... 
[Cancel button]
```

If the user clicks Cancel, the child process is killed. The cancellation is detected via `cancelled` flag in the `RunResult`.

## Output Channel

All command activity is logged to the "Warden" Output Channel:

```
$ sf warden provision --target-org my-org
[detailed command output with colors]
sf warden provision exited with code 0
```

The Output Channel is automatically shown if:

- A command starts (via `output.show(true)`)
- An error occurs
- A destructive preview begins

## Internal Flags

Some flags are added automatically and not prompted for:

- `--no-prompt` — Added for commands that support it (`supportsNoPrompt: true`), to skip CLI prompts. Not injected for `warden restore`, which exposes `--no-prompt` as an ordinary picker option instead.
- `--json` — Never added; the extension reads human-readable output by default
- `--flags-dir` — Not supported by the extension

The `internalFlags(command)` function handles this logic.

## Process Spawning

### `spawnSf(args)`

Spawns `sf <args>` as a child process:

```typescript
const child = spawnSf(['warden', 'provision', '--target-org', 'my-org']);
child.stdout.on('data', (data) => { /* handle output */ });
child.stderr.on('data', (data) => { /* handle output */ });
child.on('exit', (code) => { /* handle exit */ });
```

**Environment**: The process inherits the parent's environment. The working directory defaults to the workspace folder if available.

### Error Handling

- **Plugin not found** — Caught by `SfDetector` pre-flight check before `CommandRunner` is called
- **Process spawn failure** — Rejected promise; user sees an error message
- **Process exit with non-zero code** — Treated as failure; Output Channel is shown

## Dependencies (`RunnerDeps`)

The Command Runner is dependency-injected to enable testing:

```typescript
interface RunnerDeps {
  output: vscode.OutputChannel;              // Where to log
  spawnProcess: SpawnProcess;                // Process spawner (for testing)
  withProgress: typeof vscode.window.withProgress;
  showInformationMessage: typeof vscode.window.showInformationMessage;
  showWarningMessage: typeof vscode.window.showWarningMessage;
  showErrorMessage: typeof vscode.window.showErrorMessage;
  executeCommand?: typeof vscode.commands.executeCommand;
  workspaceFolder?: string;
}
```

In production, `createCommandRunner()` is called with real VS Code APIs. In tests, these are stubbed.

## Result Tracking

Internal `RunResult` interface tracks command completion:

```typescript
interface RunResult {
  code: number | null;      // Exit code (null = terminated)
  stdout: string;           // Combined stdout
  stderr: string;           // Combined stderr
  cancelled: boolean;       // User clicked Cancel
}
```

Success is determined by exit code 0 (or a `status: 0` JSON envelope) and no cancellation.

## Example: Running a Command

```typescript
const command = {
  id: 'warden.provision',
  cliId: 'warden provision',
  title: 'SF Warden: Provision',
  flags: [/* ... */],
};

const inputs = {
  args: ['--target-org', 'my-org', '--users-def', 'config/users.json'],
  displayArgs: ['--target-org', 'my-org', '--users-def', 'config/users.json'],
};

await runner.run(command, inputs);
// → Spawns: sf warden provision --target-org my-org --users-def config/users.json --no-prompt
// → Streams output to Output Channel
// → Shows success/error notification
```

## Testing

Tests for the Command Runner are in `src/test/extension.test.ts`. Key test patterns:

- Stub `spawnProcess` to return a mock child process
- Mock VS Code message dialogs to avoid interactive prompts
- Verify that the correct arguments are built
- Test the destructive `warden strip` workflow: dry-run → confirmation → apply
- Verify cancellation is handled correctly
