// Writes the TS spider bootstrap sources (rn/src/spider/prelude.ts) as plain
// files for spider_smoke_test.c. Usage: node gen-spider-sources.mjs <outDir>
// Relies on Node's built-in TypeScript type stripping (Node >= 22.18).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const prelude = await import(new URL('../../../../src/spider/prelude.ts', import.meta.url).href);

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node gen-spider-sources.mjs <outDir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const files = {
  'prelude.js': prelude.PRELUDE,
  'crypto.js': prelude.CRYPTO_MODULE,
  'parser.js': prelude.PARSER_MODULE,
  // Spider module names used by the fixtures (see spider_smoke_test.c).
  'entry-fongmi.js': prelude.spiderEntry('https://fixtures.test/spider/fongmi.js'),
  'entry-cat.js': prelude.spiderEntry('https://fixtures.test/spider/cat.js'),
  'filenames.txt': [prelude.PRELUDE_FILENAME, prelude.CRYPTO_FILENAME, prelude.PARSER_FILENAME, prelude.ENTRY_FILENAME].join('\n') + '\n',
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(outDir, name), content);
