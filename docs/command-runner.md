# Command Runner

`createCommandRunner` validates options with the selected use case's schema before opening a connection. Read cases run once. Write cases call `plan`, render its preview and warnings to the Warden output channel, request modal approval, and pass the same plan object to `apply`. License shortfalls in a plan also appear as warnings. Dismissing the approval returns without applying or writing a result file.

Each core call runs under `withProgress` with an AbortSignal tied to VS Code cancellation. Known Warden errors show their message and record code/data in the output channel. An auth error invalidates the cached connection and retries once.

`render.ts` uses core's English message lookup and command-specific renderers for the output channel and CSV files. Final results can be written to a path inside the first workspace folder. Absolute paths, empty paths, and paths that escape the folder are rejected before core execution. `.csv` uses the command's CSV renderer; every other extension uses formatted JSON of the result. Snapshot JSON preserves the core snapshot file structure for restore. The output file is written only after a final result, then offered through Open File.
