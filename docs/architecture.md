# Architecture

`src/extension.ts` registers eight static VS Code command IDs synchronously. It begins loading warden-core in a memoized promise, then builds the descriptor registry and refreshes the sidebar. Each handler awaits that promise, checks the authenticated org list, gathers options, and calls the runner.

`src/core/load.ts` sets Salesforce log disabling environment variables before dynamic imports. `src/core/orgService.ts` lists existing authorizations through `@salesforce/core`, filters authorizations with errors, resolves aliases, and caches connections by username. The CLI is used only as a terminal login shortcut when no authenticated org is available.

`src/registry/commands.ts` translates core descriptors and `uiHints()` into UI input definitions. `src/input/gatherInputs.ts` translates those definitions into option keys. `src/runner/commandRunner.ts` validates options and orchestrates core use cases; `src/runner/render.ts` translates results to human and CSV output.

The boundaries are deliberate: core owns command behavior and validation; the extension owns VS Code prompts, file output, progress, and notifications. `OrgService` and `InputApi` are seams for tests.
