# Warden Extension Documentation

- [Architecture](architecture.md) — module boundaries and activation
- [Command registry](command-registry.md) — descriptors, option schemas, static VS Code commands
- [Input system](input-system.md) — pickers, dependency prompts, and persistence
- [Command runner](command-runner.md) — plan, apply, progress, rendering, and files
- [Testing](testing.md) — focused verification and gates
- [Extending](extending.md) — adding command and input support

The extension needs Node 22 or later and VS Code 1.125 or later. Run `npm ci --ignore-scripts`, `npm run compile`, and `xvfb-run -a npm run test` in development.
