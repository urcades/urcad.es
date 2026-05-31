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

async function testCrosspostSkipReasons() {
  const publishResult = {
    collection: 'writing',
    postId: '260531',
    body: 'hello',
    media: [],
  };

  assert.equal(
    runner.getCrosspostSkipReason({
      args: { dryRun: true, deploy: true, verify: true },
      publishResult,
      publicUrl: 'https://www.urcad.es/writing/260531/',
    }),
    'dry run'
  );

  assert.equal(
    runner.getCrosspostSkipReason({
      args: { dryRun: false, deploy: true, verify: true },
      publishResult: { ...publishResult, collection: 'drafts' },
      publicUrl: 'https://www.urcad.es/writing/260531/',
    }),
    'not a published writing post'
  );

  assert.equal(
    runner.getCrosspostSkipReason({
      args: { dryRun: false, deploy: false, verify: false },
      publishResult,
      publicUrl: null,
    }),
    'deploy disabled'
  );
}

async function testRunCrosspostPhaseAddsStructuredResult() {
  const crossposts = await runner.runCrosspostPhase({
    args: { dryRun: false, deploy: true, verify: true },
    publishResult: {
      collection: 'writing',
      postId: '260531',
      body: 'hello',
      media: [{ url: 'https://media.urcad.es/stream/260531/photo.jpg', type: 'image' }],
    },
    publicUrl: 'https://www.urcad.es/writing/260531/',
    loadConfig: async () => ({ ARENA_ACCESS_TOKEN: 'token', ARENA_CHANNEL_SLUG: 'channel' }),
    crossPost: async payload => {
      assert.equal(payload.text, 'hello');
      assert.equal(payload.postId, '260531');
      assert.equal(payload.publicUrl, 'https://www.urcad.es/writing/260531/');
      assert.equal(payload.media.length, 1);
      return {
        attempted: true,
        bluesky: { ok: false, skipped: true, error: 'not configured' },
        arena: { ok: true, skipped: false, error: null },
        gotosocial: { ok: false, skipped: true, error: 'not configured' },
      };
    },
  });

  assert.equal(crossposts.attempted, true);
  assert.equal(crossposts.arena.ok, true);
}

async function testRunCrosspostPhaseIsNonFatal() {
  const crossposts = await runner.runCrosspostPhase({
    args: { dryRun: false, deploy: true, verify: true },
    publishResult: {
      collection: 'writing',
      postId: '260531',
      body: 'hello',
      media: [],
    },
    publicUrl: 'https://www.urcad.es/writing/260531/',
    loadConfig: async () => ({ ARENA_ACCESS_TOKEN: 'token', ARENA_CHANNEL_SLUG: 'channel' }),
    crossPost: async () => {
      throw new Error('secret-ish failure');
    },
  });

  assert.equal(crossposts.attempted, false);
  assert.match(crossposts.error, /failure/);
}

await testInjectsTokenOnlyIntoCloudflareChildren();
await testRejectsReadableTokenFile();
await testCrosspostSkipReasons();
await testRunCrosspostPhaseAddsStructuredResult();
await testRunCrosspostPhaseIsNonFatal();

console.log('run-stream-publish tests passed');
