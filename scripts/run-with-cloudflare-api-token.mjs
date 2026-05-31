#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChildEnv,
  getCloudflareApiTokenFilePath,
  resolveCloudflareApiToken,
} from './run-stream-publish.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return 'Usage: node scripts/run-with-cloudflare-api-token.mjs -- <command> [...args]';
}

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  const commandArgs = separator === -1 ? argv : argv.slice(separator + 1);

  if (commandArgs.length === 0 || commandArgs[0] === '--help' || commandArgs[0] === '-h') {
    throw new Error(usage());
  }

  return {
    command: commandArgs[0],
    args: commandArgs.slice(1),
  };
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const token = await resolveCloudflareApiToken();
  if (!token) {
    throw new Error(`No Cloudflare API token found. Store it at ${getCloudflareApiTokenFilePath()} with chmod 600.`);
  }

  const env = await createChildEnv({ needsCloudflareApiToken: true });
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  child.on('error', error => {
    console.error(error.message);
    process.exit(1);
  });
  child.on('close', code => {
    process.exitCode = code;
  });
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
