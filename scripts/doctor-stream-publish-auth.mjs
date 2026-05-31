#!/usr/bin/env node

import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  createChildEnv,
  getCloudflareApiTokenFilePath,
  resolveCloudflareApiToken,
} from './run-stream-publish.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tailLines(value, count = 20) {
  return String(value || '')
    .split('\n')
    .filter(Boolean)
    .slice(-count)
    .join('\n');
}

async function tokenSourceLabel() {
  const tokenPath = getCloudflareApiTokenFilePath();

  try {
    await access(tokenPath);
    const info = await stat(tokenPath);
    if ((info.mode & 0o077) === 0) {
      return tokenPath;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return process.env.CLOUDFLARE_API_TOKEN ? 'CLOUDFLARE_API_TOKEN environment variable' : null;
}

function runWranglerWhoami(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'whoami'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`wrangler whoami exited with code ${code}${stderr ? `\n${tailLines(stderr)}` : ''}`));
      }
    });
  });
}

async function main() {
  const token = await resolveCloudflareApiToken();
  if (!token) {
    throw new Error(`No Cloudflare API token found. Store it at ${getCloudflareApiTokenFilePath()} with chmod 600.`);
  }

  const source = await tokenSourceLabel();
  const env = await createChildEnv({ needsCloudflareApiToken: true });
  await runWranglerWhoami(env);

  console.log('stream publish auth doctor passed');
  console.log(`token source: ${source}`);
}

main().catch(error => {
  console.error(`stream publish auth doctor failed: ${error.message}`);
  process.exit(1);
});
