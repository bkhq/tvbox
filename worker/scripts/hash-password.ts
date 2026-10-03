#!/usr/bin/env bun
/**
 * Hash a password for SINGLE_USER_PASSWORD_HASH.
 *
 * Format is PBKDF2-SHA256 at 100,000 iterations (16-byte salt, 32-byte
 * derived key): the most Cloudflare Workers will verify. The hash format is portable: any
 * standard toolchain (openssl, Python hashlib, Node crypto, ...) can
 * produce equivalent values (openssl / Python hashlib / Node crypto).
 *
 * Usage:
 *   bun run hash-password                  # prompts interactively (TTY)
 *   bun run hash-password <password>       # one-shot, password as arg
 *   echo $PW | bun run hash-password -     # read from stdin
 *
 * Output goes to stdout — feed it to
 *   bunx wrangler secret put SINGLE_USER_PASSWORD_HASH
 */
/* eslint-disable no-console */
import { Buffer } from "node:buffer";
import process from "node:process";
import * as readline from "node:readline/promises";
import { hashPassword } from "../apps/api/src/modules/account/auth/password";

async function readPasswordTty(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean; setRawMode?: (v: boolean) => void };
  const muted = stdin.isTTY && typeof stdin.setRawMode === "function";
  if (muted) {
    process.stderr.write("Password: ");
    stdin.setRawMode!(true);
    let buf = "";
    return await new Promise<string>((resolve) => {
      const onData = (chunk: Buffer) => {
        const s = chunk.toString("utf-8");
        for (const ch of s) {
          if (ch === "\r" || ch === "\n") {
            stdin.setRawMode!(false);
            stdin.off("data", onData);
            process.stderr.write("\n");
            rl.close();
            resolve(buf);
            return;
          }
          if (ch === "") {
            process.exit(130);
          }
          if (ch === "") {
            buf = buf.slice(0, -1);
            continue;
          }
          buf += ch;
        }
      };
      stdin.on("data", onData);
    });
  }
  const answer = await rl.question("Password: ");
  rl.close();
  return answer;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").replace(/\r?\n$/, "");
}

const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith("--"));

let password: string;
if (positional[0] === "-") {
  password = await readStdin();
}
else if (positional[0]) {
  password = positional[0];
}
else {
  password = await readPasswordTty();
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

// Cloudflare refuses PBKDF2 above 100,000 iterations.
const hash = await hashPassword(password, 100_000);
console.log(hash);
