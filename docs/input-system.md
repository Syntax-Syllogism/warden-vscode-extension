# Input System

`gatherInputs` returns `{ org, options, outputFile, display }`. The `options` object uses core option keys; the output path and selected org remain extension concerns. Snapshot is the exception: the selected org is also passed as the core `org` option, and the runner resolves its alias to a username before validation. `InputApi` wraps pickers and input boxes for testing.

Exclusive `userTarget` hints ask for one user or a users file. Dependent prompts follow the selected value. Diff derives `mode` from that choice and offers `verify` only for persona mode. Access has a dedicated target versus user-audit flow; SObject scope is available for field and object audits.

`inputFormat` is prompted whenever the command descriptor includes it, including the single-user path. When a users file was selected, core's `detectInputFormat` supplies the preferred choice unless a last-used value exists. Choosing CSV prompts for `csvListDelimiter`. Boolean options appear in one multi-select; unselected booleans are omitted so Zod defaults apply.

Definition file pickers use core's JSON/CSV file hints and return workspace-relative paths. They search up to 200 files while excluding common generated and Salesforce directories. Restore walks the workspace for JSON snapshots so it can include files ignored by Git. The last-used file appears first in the picker. `LastValueStore` keys include command ID and option key, so old flag-keyed saved values reset once. The org picker prefers the last-used org, then `warden.defaultTargetOrg`; its labels show the alias, username, default status, and expiration status when available.
