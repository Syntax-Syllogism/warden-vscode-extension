# Warden Extension Documentation

This directory contains documentation for developers working on the Warden VS Code extension.

## Quick Start

New to the codebase? Start here:

1. **[Architecture Overview](architecture.md)** — High-level design and component overview
2. **[Extending the Extension](extending.md)** — How to add new commands, flag kinds, and features
3. **[Development Setup](#development-setup)** — Get your environment ready

## Core Documentation

### User-Facing Features

- **[Input System](input-system.md)** — How the extension collects user input (pickers, input boxes, etc.)
- **[Command Runner](command-runner.md)** — How commands are executed, including the `warden strip` dry-run workflow

### Developer Reference

- **[Command Registry](command-registry.md)** — Command definitions, flag kinds, and auto-generation from oclif manifest
- **[Testing Guide](testing.md)** — How to write and run tests
- **[Extending the Extension](extending.md)** — Detailed guide to adding new commands, flags, and customizations

## Development Setup

### Prerequisites

- Node.js 18+
- npm 8+
- VS Code 1.88+
- Salesforce CLI and warden plugin installed locally:

  ```bash
  sf plugins install @syntax-syllogism/warden
  ```

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/Syntax-Syllogism/warden-code-ext.git
cd warden-code-ext

# Install dependencies
npm install

# Verify setup
npm test
npm run check-types
npm run lint
```

### Common Commands

```bash
# Development
npm run watch              # Watch TypeScript and rebuild on changes
npm run compile            # Build extension
npm test                   # Run test suite
npm run check-types        # Type checking
npm run lint               # Code linting

# Release
npm run package            # Build for distribution
npm run package:vsix       # Create .vsix file for VS Code Marketplace

# Maintenance
npm run gen:commands       # Regenerate command registry from the warden manifest
```

### Debugging

1. Press **F5** to launch the Extension Development Host
2. In the new VS Code window, open a Salesforce project folder
3. Commands appear in the Command Palette (Ctrl+Shift+P) prefixed with "SF Warden"
4. Use the Warden sidebar (left activity bar) to browse commands
5. Open VS Code's Debug Console (Ctrl+J) to see logs

## Project Structure

```
warden-code-ext/
  src/
    extension.ts                # Extension entry point
    input/                      # Input gathering (pickers, etc.)
      gatherInputs.ts          # Main input orchestrator
      orgPicker.ts             # Org selection picker
      defFilePicker.ts         # Workspace JSON definition-file picker
      filePicker.ts            # Native file/folder picker helpers
      workspaceQuickPick.ts    # Shared workspace-relative Quick Pick helper
      outputDirPicker.ts       # Directory selection picker (unused by current commands)
    registry/                  # Command definitions
      types.ts                 # TypeScript interfaces
      commands.generated.ts    # Auto-generated command list
    runner/                    # Command execution
      commandRunner.ts         # Main execution logic
      sfProcess.ts             # Salesforce CLI spawning
      sfDetect.ts               # Dependency detection
      ansi.ts                  # ANSI color stripping
    tree/                      # Sidebar UI
      wardenCommandsProvider.ts # Tree view implementation
    util/
      memento.ts               # Last-value persistence
    test/
      extension.test.ts        # Unit tests
      sfProcess.test.ts        # Process tests

  scripts/
    gen-commands.ts            # Registry generation script

  docs/                        # This documentation
    README.md                  # Documentation index
    architecture.md            # Design overview
    command-runner.md          # Execution system
    command-registry.md        # Command definitions
    input-system.md            # Input gathering
    extending.md                # Extension guide
    testing.md                  # Testing guide

  vendor/
    warden.oclif.manifest.json # warden CLI command manifest

  .github/
    workflows/
      ci.yml                    # CI/CD pipeline

  media/
    warden.svg                  # Sidebar icon
    warden-logo.png             # Marketplace logo
```

## Key Concepts

### Commands

A **Command** is a wrapper around a warden CLI command. Each command has:

- **id** — VS Code command ID (e.g., `warden.provision`)
- **cliId** — CLI command string (e.g., `warden provision`)
- **title** — Display name in Command Palette
- **flags** — Prompts to collect from the user
- **group** — Sidebar category (always `User Lifecycle` today)
- **destructive** — Whether to use dry-run → confirm → apply workflow (only `warden strip`)

### Flag Kinds

Flags can be of different **kinds**, which determine how they're presented to the user:

- **org** — Salesforce org picker
- **file** - Workspace JSON Quick Pick filtered by Git ignore rules
- **outputDir** - Quick Pick-first directory picker (not currently used by any warden command)
- **string** — Text input box
- **enum** — Dropdown picker
- **boolean** — Multi-select checkbox picker
- **apiVersion** — API version input (hidden from the UI today)

### Workflows

#### Normal Commands

User invokes command → Prompted for inputs → CLI runs → Output displayed

#### Destructive Commands

User invokes `warden strip` → Prompted for inputs → **Dry-run** (show changes) → User confirms → **Apply** (run for real)

## Common Tasks

### Add a new command

1. Add to warden CLI plugin
2. Update `allowList` in `scripts/gen-commands.ts`
3. Run `npm run gen:commands`
4. Test with `npm test`

See [Extending the Extension](extending.md#adding-support-for-a-new-command).

### Add a new flag kind

1. Add to `FlagKind` type in `src/registry/types.ts`
2. Add UI handling in `src/input/gatherInputs.ts`
3. Add tests
4. Update `scripts/gen-commands.ts` if inferencing needed

See [Extending the Extension](extending.md#adding-support-for-a-new-flag-kind).

### Customize flag prompts

Edit the maps in `scripts/gen-commands.ts`:

- `placeholderByCommandFlag` — Example text
- `summaryByCommandFlag` — Description
- `flagOrder()` — Prompt order
- `dependsOnFlagFor()` — Defer a flag until another is selected
- `guiHiddenFlagsByCommand` — Hide certain flags

Run `npm run gen:commands` after changes.

### Run a command manually

1. Launch Extension Development Host (F5)
2. Open a Salesforce project folder
3. Cmd+Shift+P → "SF Warden: " → Pick a command
4. Answer prompts
5. See output in Warden Output Channel

### Debug a test failure

```bash
npm run watch-tests
# Edit src/test/extension.test.ts
# Add test.only('...', ...)
# Watch mode re-runs the test
```

Or debug in VS Code:

1. Set a breakpoint
2. Run → Start Debugging
3. Select "Mocha Tests" configuration

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit: `git commit -m "chore: release v0.x.y"`
4. Tag: `git tag v0.x.y`
5. Build: `npm run package:vsix`
6. Optional: upload to the [VS Code Marketplace](https://marketplace.visualstudio.com/) (not currently part of the release flow — see the work item for scope)

## Troubleshooting

### Tests fail after updating the warden plugin

Regenerate the command registry:

```bash
npm run gen:commands
npm test
```

### Extension doesn't load in Extension Development Host

1. Check `npm run compile` succeeds
2. Check no TypeScript errors: `npm run check-types`
3. Check console for errors (F5 → Debug Console)
4. Try `Ctrl+R` to reload the window

### Command hangs or times out

1. Check warden CLI works: `sf warden --help`
2. Run command manually to see if it hangs there
3. Check for unintended interactive prompts

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

## Resources

- [Warden CLI Plugin](https://github.com/Syntax-Syllogism/warden)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Salesforce CLI Documentation](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/)
- [Oclif Documentation](https://oclif.io/)

## Questions?

Open an issue on [GitHub](https://github.com/Syntax-Syllogism/warden-code-ext/issues).

---

**Last updated:** 2026-07-12
