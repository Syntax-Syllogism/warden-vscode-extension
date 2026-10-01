import { cp, mkdir } from 'node:fs/promises';

const source = 'node_modules/@syntax-syllogism/warden-core/schemas';
await mkdir('schemas', { recursive: true });
for (const name of ['persona-definitions', 'users-definition', 'related-catalog']) {
  await cp(`${source}/${name}.schema.json`, `schemas/${name}.schema.json`);
}
