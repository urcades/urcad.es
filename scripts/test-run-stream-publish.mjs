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

function testDependencyManifestChangeDetection() {
  assert.equal(runner.hasDependencyManifestChanges(''), false);
  assert.equal(runner.hasDependencyManifestChanges('src/content/writing/260603.md\n'), false);
  assert.equal(runner.hasDependencyManifestChanges('package.json\n'), true);
  assert.equal(runner.hasDependencyManifestChanges('package-lock.json\n'), true);
  assert.equal(
    runner.hasDependencyManifestChanges('src/layouts/Base.astro\npackage-lock.json\n'),
    true
  );
  assert.deepEqual(
    runner.dependencyManifestFilesFromDiff('package.json\nsrc/pages/index.astro\npackage-lock.json\n'),
    ['package.json', 'package-lock.json']
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

async function testVerifyPublicPostRetriesTransientFailures() {
  const requests = [];
  const delays = [];
  const responses = [
    new Error('temporary network failure'),
    { ok: false, status: 404 },
    { ok: true, status: 200 },
  ];

  const url = await runner.verifyPublicPost('260725', {
    fetchImpl: async (requestUrl, options) => {
      requests.push({ requestUrl, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    sleep: async delay => {
      delays.push(delay);
    },
    attempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 150,
  });

  assert.equal(url, 'https://www.urcad.es/writing/260725/');
  assert.deepEqual(delays, [100, 150]);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.redirect, 'follow');
  assert.notEqual(requests[0].requestUrl.href, requests[1].requestUrl.href);
  assert.equal(requests[0].requestUrl.pathname, '/writing/260725/');
}

async function testVerifyPublicPostReportsRecentFailures() {
  await assert.rejects(
    runner.verifyPublicPost('260725', {
      fetchImpl: async () => ({ ok: false, status: 503 }),
      sleep: async () => {},
      attempts: 2,
    }),
    /after 2 attempts:[\s\S]*attempt 2: HTTP 503/
  );
}

await testInjectsTokenOnlyIntoCloudflareChildren();
await testRejectsReadableTokenFile();
testDependencyManifestChangeDetection();
await testCrosspostSkipReasons();
await testRunCrosspostPhaseAddsStructuredResult();
await testRunCrosspostPhaseIsNonFatal();
await testVerifyPublicPostRetriesTransientFailures();
await testVerifyPublicPostReportsRecentFailures();

console.log('run-stream-publish tests passed');
