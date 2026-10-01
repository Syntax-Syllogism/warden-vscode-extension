import { readFile, writeFile } from 'node:fs/promises';
import { commandDescriptors } from '@syntax-syllogism/warden-core';

const path = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(await readFile(path, 'utf8'));
pkg.contributes.commands = commandDescriptors.map((descriptor) => ({
  command: `warden.${descriptor.id}`,
  title: `SF Warden: ${descriptor.title}`,
}));
await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
