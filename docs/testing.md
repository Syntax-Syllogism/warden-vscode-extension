# Testing

`src/test/extension.test.ts` covers descriptor mapping and package synchronization, org labels, write-plan identity and cancellation by approval, output paths, and the no-spawn rule. Use injected core and org service fakes for runner cases.

Run the targeted file through `xvfb-run -a npm run test -- --grep 'In-process Warden extension'`. Then run:

```sh
npm ci --ignore-scripts
./node_modules/.bin/tsc -p . --noEmit
xvfb-run -a npm run test
```

Manual smoke checks require an authenticated scratch org and a packaged VSIX. Exercise all eight commands, preview cancellation and apply for writes, snapshot JSON followed by restore, CSV output, CSV users with a custom delimiter, related records, record-type access, and schema validation.
