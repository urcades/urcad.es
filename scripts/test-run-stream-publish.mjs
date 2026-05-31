#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = await import(path.join(repoRoot, 'scripts', 'run-stream-publish.mjs'));

async function makeHomeWithToken(token, mode = 0o600) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'urcades-runner-home-'));
  const tokenPath = runner.getCloudflareApiTokenFilePath(homeDir);

  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, `${token}\n`, { mode });
  chmodSync(tokenPath, mode);

  return { homeDir, tokenPath };
}

async function testInjectsTokenOnlyIntoCloudflareChildren() {
  const secret = 'test-cloudflare-token';
  const { homeDir } = await makeHomeWithToken(secret);
  const baseEnv = {
    HOME: homeDir,
    PATH: process.env.PATH,
    CLOUDFLARE_API_TOKEN: 'parent-token-should-not-leak',
  };

  const publisherEnv = await runner.createChildEnv({
    command: process.execPath,
    args: ['scripts/publish-stream.mjs', '--event', '/tmp/event.json'],
    baseEnv,
    needsCloudflareApiToken: true,
  });
  assert.equal(publisherEnv.CLOUDFLARE_API_TOKEN, secret);

  const deployEnv = await runner.createChildEnv({
    command: 'npm',
    args: ['run', 'worker:deploy'],
    baseEnv,
    needsCloudflareApiToken: true,
  });
  assert.equal(deployEnv.CLOUDFLARE_API_TOKEN, secret);

  const gitEnv = await runner.createChildEnv({
    command: 'git',
    args: ['status'],
    baseEnv,
  });
  assert.equal(gitEnv.CLOUDFLARE_API_TOKEN, undefined);

  const buildEnv = await runner.createChildEnv({
    command: 'npm',
    args: ['run', 'build'],
    baseEnv,
  });
  assert.equal(buildEnv.CLOUDFLARE_API_TOKEN, undefined);
}

async function testRejectsReadableTokenFile() {
  const { homeDir } = await makeHomeWithToken('too-readable-token', 0o644);

  await assert.rejects(
    runner.resolveCloudflareApiToken({ env: { HOME: homeDir } }),
    /owner-only permissions/
  );
}

await testInjectsTokenOnlyIntoCloudflareChildren();
await testRejectsReadableTokenFile();

console.log('run-stream-publish tests passed');
