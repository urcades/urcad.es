#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = await import(path.join(repoRoot, 'scripts', 'run-stream-publish.mjs'));
const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  return await execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function configureGitIdentity(cwd) {
  await runGit(cwd, ['config', 'user.name', 'Stream Publisher Test']);
  await runGit(cwd, ['config', 'user.email', 'stream-publisher-test@example.com']);
}

async function commitFile(cwd, file, contents, message) {
  await writeFile(path.join(cwd, file), contents);
  await runGit(cwd, ['add', '--', file]);
  await runGit(cwd, ['commit', '-m', message]);
}

async function makeGitFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'urcades-runner-git-'));
  const origin = path.join(root, 'origin.git');
  const local = path.join(root, 'local');
  const peer = path.join(root, 'peer');

  await runGit(root, ['init', '--bare', '--initial-branch=main', origin]);
  await runGit(root, ['clone', origin, local]);
  await configureGitIdentity(local);
  await commitFile(local, 'initial.txt', 'initial\n', 'Initial commit');
  await runGit(local, ['push', '--set-upstream', 'origin', 'main']);

  await runGit(root, ['clone', origin, peer]);
  await configureGitIdentity(peer);

  return { root, origin, local, peer };
}

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

async function testSyncCurrentBranchRebasesLocalUnpublishedCommitOntoOrigin() {
  const fixture = await makeGitFixture();

  try {
    await commitFile(fixture.local, 'local-post.md', 'local unpublished post\n', 'Local unpublished post');
    const oldLocalHead = (await runGit(fixture.local, ['rev-parse', 'HEAD'])).stdout.trim();

    await commitFile(fixture.peer, 'remote-reading.md', 'incoming reading\n', 'Remote reading sync');
    await runGit(fixture.peer, ['push', 'origin', 'main']);

    const syncResult = await runner.syncCurrentBranch('main', { cwd: fixture.local });
    const newLocalHead = (await runGit(fixture.local, ['rev-parse', 'HEAD'])).stdout.trim();
    const subjects = (await runGit(fixture.local, ['log', '--format=%s', '-2'])).stdout.trim().split('\n');

    assert.notEqual(newLocalHead, oldLocalHead);
    assert.deepEqual(subjects, ['Local unpublished post', 'Remote reading sync']);
    await runGit(fixture.local, ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
    assert.equal(syncResult.oldHead, oldLocalHead);
    assert.equal(syncResult.newHead, newLocalHead);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPushPreflightAuthenticatesWithoutUpdatingOrigin() {
  const fixture = await makeGitFixture();

  try {
    await commitFile(fixture.local, 'local-post.md', 'local unpublished post\n', 'Local unpublished post');
    const remoteBefore = (await runGit(fixture.origin, ['rev-parse', 'main'])).stdout.trim();

    await runner.preflightPushBranch('main', { cwd: fixture.local });

    const remoteAfter = (await runGit(fixture.origin, ['rev-parse', 'main'])).stdout.trim();
    assert.equal(remoteAfter, remoteBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testSyncCurrentBranchAbortsConflictingRebase() {
  const fixture = await makeGitFixture();

  try {
    await commitFile(fixture.local, 'initial.txt', 'local version\n', 'Local unpublished edit');
    const oldLocalHead = (await runGit(fixture.local, ['rev-parse', 'HEAD'])).stdout.trim();

    await commitFile(fixture.peer, 'initial.txt', 'remote version\n', 'Remote edit');
    await runGit(fixture.peer, ['push', 'origin', 'main']);

    await assert.rejects(
      runner.syncCurrentBranch('main', { cwd: fixture.local }),
      error => {
        assert.match(error.stderr, /could not apply/);
        return true;
      }
    );

    const currentHead = (await runGit(fixture.local, ['rev-parse', 'HEAD'])).stdout.trim();
    const status = (await runGit(fixture.local, ['status', '--porcelain'])).stdout;
    assert.equal(currentHead, oldLocalHead);
    assert.equal(status, '');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function testPushBranchPreservesGitRejectionStderr() {
  const fixture = await makeGitFixture();

  try {
    await commitFile(fixture.local, 'local-post.md', 'local unpublished post\n', 'Local unpublished post');
    await commitFile(fixture.peer, 'remote-reading.md', 'incoming reading\n', 'Remote reading sync');
    await runGit(fixture.peer, ['push', 'origin', 'main']);

    await assert.rejects(
      runner.pushBranch('main', { cwd: fixture.local }),
      error => {
        const details = runner.createErrorDetails(error);
        assert.match(details.message, /rejected|fetch first|non-fast-forward/i);
        assert.match(details.stderrTail, /rejected|fetch first|non-fast-forward/i);
        return true;
      }
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

await testInjectsTokenOnlyIntoCloudflareChildren();
await testRejectsReadableTokenFile();
testDependencyManifestChangeDetection();
await testCrosspostSkipReasons();
await testRunCrosspostPhaseAddsStructuredResult();
await testRunCrosspostPhaseIsNonFatal();
await testVerifyPublicPostRetriesTransientFailures();
await testVerifyPublicPostReportsRecentFailures();

const gitBehaviorFailures = [];
for (const test of [
  testSyncCurrentBranchRebasesLocalUnpublishedCommitOntoOrigin,
  testSyncCurrentBranchAbortsConflictingRebase,
  testPushPreflightAuthenticatesWithoutUpdatingOrigin,
  testPushBranchPreservesGitRejectionStderr,
]) {
  try {
    await test();
  } catch (error) {
    gitBehaviorFailures.push(error);
    console.error(`${test.name}: ${error.message}`);
  }
}

if (gitBehaviorFailures.length > 0) {
  throw new AggregateError(gitBehaviorFailures, 'Git publishing behavior tests failed');
}

console.log('run-stream-publish tests passed');
