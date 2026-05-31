#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'publish-stream.mjs');

function pad(value) {
  return String(value).padStart(2, '0');
}

function localTimeLabel(isoDate) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoDate));
}

function localCompactTime(isoDate) {
  const date = new Date(isoDate);
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function makeTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'urcades-publish-test-'));
  return root;
}

async function writeEvent(root, name, event) {
  const eventPath = path.join(root, `${name}.json`);
  await writeFile(eventPath, JSON.stringify(event, null, 2));
  return eventPath;
}

function runPublisher(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

async function testPublishCreatesAndAppends() {
  const root = await makeTempRoot();
  const firstEvent = await writeEvent(root, 'publish-first', {
    id: 'msg-create',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡 first entry',
  });

  const first = runPublisher(['--event', firstEvent, '--root', root]);
  assert.equal(first.status, 0, first.stderr);

  const postPath = path.join(root, 'src', 'content', 'writing', '260530.md');
  let content = await readFile(postPath, 'utf8');
  assert.match(content, /title: "May 30"/);
  assert.match(content, /source: "imessage"/);
  assert.match(content, new RegExp(localTimeLabel('2026-05-30T12:34:56.000Z')));
  assert.match(content, /first entry/);
  assert.doesNotMatch(content, /🎡/);

  const secondEvent = await writeEvent(root, 'publish-second', {
    id: 'msg-append',
    source: 'imessage',
    receivedAt: '2026-05-30T13:00:00.000Z',
    text: 'publish: second entry',
  });

  const second = runPublisher(['--event', secondEvent, '--root', root]);
  assert.equal(second.status, 0, second.stderr);

  content = await readFile(postPath, 'utf8');
  assert.match(content, /first entry/);
  assert.match(content, /~\n\n/);
  assert.match(content, /second entry/);
}

async function testDraftCreatesDraft() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'draft', {
    id: 'msg-draft',
    source: 'email',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: 'draft: private note',
  });

  const result = runPublisher(['--event', eventPath, '--root', root]);
  assert.equal(result.status, 0, result.stderr);

  const draftPath = path.join(root, 'src', 'content', 'drafts', '260530.md');
  assert.equal(existsSync(draftPath), true);
  const content = await readFile(draftPath, 'utf8');
  assert.match(content, /source: "email"/);
  assert.match(content, /private note/);
}

async function testMissingPrefixWritesNothing() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'invalid', {
    id: 'msg-invalid',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: 'this should not publish',
  });

  const result = runPublisher(['--event', eventPath, '--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /🎡|publish:|draft:/);
  assert.equal(existsSync(path.join(root, 'src')), false);
}

async function testEmptyPublishWritesNothing() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'empty', {
    id: 'msg-empty',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡',
  });

  const result = runPublisher(['--event', eventPath, '--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /text content or media/);
  assert.equal(existsSync(path.join(root, 'src')), false);
}

async function testMediaDryRunPlansR2Key() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'media-dry-run', {
    id: 'message/media guid',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: 'publish: photo',
    media: [{
      path: '/Users/edouard/Library/Messages/Attachments/example photo.jpg',
      mimeType: 'image/jpeg',
      alt: 'example',
    }],
  });

  const result = runPublisher(['--event', eventPath, '--root', root, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.wrote, false);
  assert.equal(payload.body, 'photo');
  assert.equal(payload.media[0].type, 'image');
  assert.equal(payload.media[0].alt, 'example');
  assert.equal(
    payload.media[0].key,
    `stream/260530/260530-${localCompactTime('2026-05-30T12:34:56.000Z')}-message-media-guid-0-example-photo.jpg`
  );
  assert.equal(existsSync(path.join(root, 'src')), false);
}

async function testDoubleFerrisWheelStripsMediaIntentMarker() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'double-wheel-media-dry-run', {
    id: 'double wheel/media guid',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡🎡 physical memory',
    media: [{
      path: '/Users/edouard/Library/Messages/Attachments/example photo.jpg',
      mimeType: 'image/jpeg',
      alt: '',
    }],
  });

  const result = runPublisher(['--event', eventPath, '--root', root]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Media file does not exist/);
  assert.doesNotMatch(result.stderr, /Nothing to publish/);
}

await testPublishCreatesAndAppends();
await testDraftCreatesDraft();
await testMissingPrefixWritesNothing();
await testEmptyPublishWritesNothing();
await testMediaDryRunPlansR2Key();
await testDoubleFerrisWheelStripsMediaIntentMarker();

console.log('publish-stream tests passed');
