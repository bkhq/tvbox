/** Fixture reader for Jest; the app tsconfig has no Node types, so the fs API is typed locally. */

declare const __dirname: string;

interface Fs {
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: 'utf8'): string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as Fs;

export function fixture(name: string): string {
  return fs.readFileSync(`${__dirname}/${name}`, 'utf8');
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(`${__dirname}/${name}`));
}
