# Command Registry

`buildCommands(core)` in `src/registry/commands.ts` visits `commandDescriptors` in core order. Each descriptor supplies the ID, title, group, destructive marker, and options schema. `uiHints(schema)` supplies labels, prompt kinds, file filters, exclusive groups, and dependencies. Zod wrappers supply required status, defaults, and enum values.

The registry skips in-memory `*Doc` alternatives, snapshot provenance `org`, and diff `mode`, which the UI derives. It adds the extension-owned org and output-file inputs. Input keys match core option names.

VS Code reads contributed commands from static `package.json`. After changing the exact warden-core pin, run `npm run sync:contributes`. The registry test checks that JSON against descriptors. There is no vendored CLI manifest.
