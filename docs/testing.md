# Testing Guide

This extension uses VS Code's test infrastructure (`@vscode/test-cli`) and Mocha for unit testing.

## Running Tests

### Run All Tests

```bash
npm test
```

This compiles TypeScript tests, runs them with Mocha, and reports results.

### Run Tests in Watch Mode

```bash
npm run watch-tests
```

Tests recompile and re-run on file changes during development.

### Run with Coverage

The test runner is configured in `package.json`. To add coverage:

```bash
npm test -- --reporter json > test-results.json
```

Then analyze with your coverage tool.

## Test Structure

Tests are in `src/test/` and follow the same directory structure as source files:

```
src/
  extension.ts
  input/
    gatherInputs.ts
    filePicker.ts
    orgPicker.ts
  runner/
    commandRunner.ts
    sfProcess.ts
  tree/
    wardenCommandsProvider.ts

src/test/
  extension.test.ts        # Main test file
  sfProcess.test.ts        # SF process spawning tests
```

## Key Test Patterns

### Mocking VS Code APIs

Tests stub VS Code interfaces to avoid UI interactions:

```typescript
const mockInputApi = {
  pickOrg: async () => 'my-org',
  pickFile: async () => undefined,  // Retained for specialized native file prompts
  pickDefFile: async () => 'config/users.json',
  pickOutputDirectory: async () => 'generated-files',
  showQuickPick: async (options) => options.items[0],
  showInputBox: async (options) => 'user input',
  showBooleanPick: async (options) => [],
  // ...
};
```

### Mocking Child Processes

The command runner is tested by stubbing `spawnProcess`:

```typescript
const mockSpawnProcess = (file: string, args: string[], options: SpawnOptions) => {
  const mockProcess = new EventEmitter() as ChildProcess;
  mockProcess.stdout = new PassThrough();
  mockProcess.stderr = new PassThrough();

  process.nextTick(() => {
    mockProcess.stdout?.emit('data', Buffer.from('command output\n'));
    mockProcess.emit('exit', 0);
  });

  return mockProcess;
};
```

### Testing Input Gathering

Test that `gatherInputs()` prompts for each flag and builds correct args:

```typescript
it('should gather inputs and build args', async () => {
  const command = commands[0];  // Get a test command
  const store = createMockStore();
  const inputs = await gatherInputs(command, store, mockInputApi);

  expect(inputs.args).toContain('--target-org');
  expect(inputs.args).toContain('my-org');
});
```

### Testing Destructive Workflows

`warden strip` is the only command with `destructive: true`. Test its two-step process:

```typescript
it('should run dry-run then apply on confirmation', async () => {
  const mockMessages = {
    showInformationMessage: async () => 'Run',  // Confirm run
    showWarningMessage: async () => 'Apply',     // Confirm apply
    // ...
  };

  const runner = createCommandRunner({
    ...deps,
    showInformationMessage: mockMessages.showInformationMessage,
    showWarningMessage: mockMessages.showWarningMessage,
  });

  await runner.run(stripCommand, gatherInputs);

  // Verify two spawns: one with --dry-run, one without
  expect(spawnedCommands).toHaveLength(2);
  expect(spawnedCommands[0]).toContain('--dry-run');
  expect(spawnedCommands[1]).not.toContain('--dry-run');
});
```

### Testing Cancellation

Verify that user cancellation aborts the operation:

```typescript
it('should abort on user cancel', async () => {
  const mockMessages = {
    showInformationMessage: async () => undefined,  // User clicked Cancel
  };

  const runner = createCommandRunner({
    ...deps,
    showInformationMessage: mockMessages.showInformationMessage,
  });

  await runner.run(command, inputs);

  // Verify no spawn occurred
  expect(spawnedCommands).toHaveLength(0);
});
```

## Testing Flag Kinds

Each flag kind that a warden command actually uses has corresponding tests in `extension.test.ts`.

### Org Kind

```typescript
it('should prompt for org with pickOrg', async () => {
  const mockInputApi = {
    pickOrg: async (lastValue) => {
      expect(lastValue).toBe(undefined);  // First time
      return 'my-org';
    },
    // ...
  };

  const inputs = await gatherInputs(command, store, mockInputApi);
  expect(inputs.args).toContain('--target-org');
});
```

### File Kind

```typescript
it('should prompt for a workspace definition file with pickDefFile', async () => {
  const mockInputApi = {
    pickDefFile: async (options) => {
      expect(options.label).toBe('Path to user definition JSON file.');
      expect(options.lastValue).toBe(undefined);
      return 'config/users.json';
    },
    // ...
  };

  const inputs = await gatherInputs(command, store, mockInputApi);
  expect(inputs.args).toContain('--users-def');
  expect(inputs.args).toContain('config/users.json');
});
```

Definition-file tests should cover Quick Pick selection, cancellation, last-used paths, `.gitignore` filtering, and deduplication. The production picker returns workspace-relative JSON paths and intentionally does not open the native OS file dialog.

### OutputDir Kind

No warden command currently declares an `outputDir`-kind flag, but the picker module is still tested directly (with a synthetic `CommandDef`/`FlagDef` fixture) since it remains as shared scaffolding — see `pickOutputDirectory` tests in `extension.test.ts`.

### Enum Kind

```typescript
it('should prompt with enum options', async () => {
  const mockInputApi = {
    showQuickPick: async (options) => {
      expect(options.items).toContain('field');
      expect(options.items).toContain('object');
      return 'field';
    },
    // ...
  };

  const inputs = await gatherInputs(command, store, mockInputApi);
  expect(inputs.args).toContain('--type');
  expect(inputs.args).toContain('field');
});
```

### Boolean Kind

For boolean/multi-select flags tested separately via `gatherBooleanFlags()`.

## Testing the Tree View

The sidebar tree view is tested for structure and icon assignment:

```typescript
it('should organize commands into a flat User Lifecycle group', () => {
  const provider = new WardenCommandsProvider(commands);
  const rootNodes = provider.getChildren();

  const groups = rootNodes.filter((n) => n.type === 'group');
  expect(groups).toHaveLength(1);
  expect(groups[0].label).toBe('User Lifecycle');
});

it('should assign correct icons', () => {
  const provider = new WardenCommandsProvider(commands);
  const stripCommand = commands.find((c) => c.cliId === 'warden strip');
  const item = provider.getTreeItem({
    type: 'command',
    command: stripCommand,
  });

  expect(item.iconPath).toBe(new vscode.ThemeIcon('warning'));  // Destructive
});
```

## Testing Command Registry Generation

The registry generation script (`scripts/gen-commands.ts`) has its own tests:

```typescript
it('should generate valid CommandDef from oclif manifest', () => {
  const manifest = /* load test manifest */;
  const registry = generateRegistry(manifest);
  const commands = eval(registry);  // Parse generated code

  expect(commands).toBeDefined();
  expect(commands.length).toBe(8);
  expect(commands[0].id).toMatch(/^warden\./);
});
```

## Test Data

Some tests load a minimal oclif manifest from `vendor/warden.oclif.manifest.json`. This file is a manually vendored copy of the warden CLI plugin's build output. If it's outdated, regenerate it:

```bash
cd ../warden
yarn build
cp oclif.manifest.json ../warden-code-ext/vendor/warden.oclif.manifest.json
```

## Coverage Goals

While full coverage is ideal, focus on:

1. **Critical paths** — Input gathering, command execution, the destructive strip workflow
2. **Error handling** — SF detection failures, process spawn errors, validation
3. **Edge cases** — Empty inputs, cancellations, exclusive groups
4. **Integration** — End-to-end flows from command prompt to execution

## Common Assertions

```typescript
assert.ok(inputs.args.includes('--target-org'));       // Arg presence
assert.strictEqual(inputs.args.length, 5);              // Arg count
assert.ok(!outputs.displayArgs.includes('password'));   // No sensitive data
await assert.rejects(runner.run(command, inputs));       // Error handling
assert.strictEqual(spawnedProcesses.length, 2);          // Process count
```

## Debugging Tests

### Run a Specific Test

Use Mocha's `.only()` modifier:

```typescript
test.only('should do something specific', async () => {
  // Only this test runs
});
```

### Add Debug Output

```typescript
console.log('Input API called with:', options);
```

Run tests with:

```bash
npm test 2>&1 | tee test-output.txt
```

### VS Code Test Explorer

If using VS Code's Test Explorer extension, you can run/debug individual tests from the editor.

## Integration Tests

VS Code extension tests run within the Extension Development Host environment, giving access to:

- Real VS Code APIs
- File system (workspace)
- User settings
- Terminal

This is valuable for testing end-to-end workflows, but slower than unit tests. Keep unit tests fast and focused.

## CI/CD Integration

Tests run automatically in CI (GitHub Actions) on each push. See `.github/workflows/ci.yml` for the configuration.

The CI workflow:

1. Installs dependencies
2. Runs `npm run lint` (ESLint)
3. Runs `npm run check-types` (TypeScript)
4. Runs `npm test` (Mocha, under `xvfb-run` on Linux CI)
5. Packages a VSIX artifact

Ensure all tests pass locally before pushing.

## Adding New Tests

When adding a feature:

1. Write a failing test first (TDD)
2. Implement the feature
3. Verify the test passes
4. Run full test suite to catch regressions
5. Commit with test

Template:

```typescript
suite('My Feature', () => {
  test('should do something', async () => {
    const result = await myFeature();
    assert.strictEqual(result, expected);
  });

  test('should handle edge case', async () => {
    assert.throws(() => myFeature(invalid));
  });
});
```
