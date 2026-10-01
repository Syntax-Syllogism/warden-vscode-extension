# Extending the Extension

Add use cases and option hints in warden-core first. Pin its released version in `package.json` and run `npm run sync:contributes`. Add a new static command handler ID in `src/extension.ts` and a human/CSV renderer mapping in `src/runner/render.ts`.

New hint kinds need an `InputKind` definition in `src/registry/types.ts`, UI handling in `src/input/gatherInputs.ts`, and focused tests. Keep options as core keys. Avoid adding CLI flags or generated manifest code.

If core's descriptors or hints cannot express a prompt, fix the core API and release it before changing the extension.
