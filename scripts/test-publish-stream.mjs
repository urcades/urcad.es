#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

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

function runPublisher(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOCALE_CONTEXT_RECEIVER_URL: 'http://127.0.0.1:9',
      ...options.env,
    },
  });
}

function runPublisherAsync(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LOCALE_CONTEXT_RECEIVER_URL: 'http://127.0.0.1:9',
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      resolve({ status: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', status => {
      resolve({ status, stdout, stderr });
    });
  });
}

function sampleLocaleContext(overrides = {}) {
  return {
    schemaVersion: 'locale.agent.v1',
    ok: true,
    freshness: {
      status: 'fresh',
      sampleAgeSeconds: 38,
    },
    where: {
      latitude: 40.672,
      longitude: -73.957,
      timestamp: '2026-05-30T12:34:56.000Z',
      ageSeconds: 38,
      quality: 'good',
      altitudeMeters: 9.75,
    },
    adminContext: {
      status: 'matched',
      neighborhood: 'Brooklyn',
      borough: 'Brooklyn',
    },
    place: {
      label: 'Home',
      category: 'residential',
      match: 'inside',
    },
    movement: {
      state: 'stationary',
    },
    posture: {
      posture: 'faceUp',
      unavailableReason: null,
    },
    latestSample: {
      visitArrivalDate: '2026-05-30T11:48:00.000Z',
      visitDepartureDate: null,
    },
    ...overrides,
  };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, 'expected YAML frontmatter');
  return YAML.parse(match[1]);
}

async function withLocaleServer(payloads, fn) {
  const queue = [...payloads];
  const server = createServer((request, response) => {
    if (!request.url?.startsWith('/agent-context')) {
      response.writeHead(404).end();
      return;
    }

    const payload = queue.length > 1 ? queue.shift() : queue[0];
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(url);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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

async function testLocaleCreatesAndAppendUpdatesLatestSnapshot() {
  const root = await makeTempRoot();
  const writingDir = path.join(root, 'src', 'content', 'writing');
  await mkdir(writingDir, { recursive: true });
  await writeFile(path.join(writingDir, '260529.md'), `---
title: "May 29"
pubDate: 2026-05-29T12:00:00.000Z
description: "Daily stream - May 29"
tags: ["stream"]
source: "imessage"
locale:
  position:
    latitude: 40.6721
    longitude: -73.9571
---

previous
`);

  const firstEvent = await writeEvent(root, 'locale-first', {
    id: 'msg-locale-create',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡 first with place',
  });
  const secondEvent = await writeEvent(root, 'locale-second', {
    id: 'msg-locale-append',
    source: 'imessage',
    receivedAt: '2026-05-30T13:00:00.000Z',
    text: 'publish: second with place',
  });

  await withLocaleServer([
    sampleLocaleContext(),
    sampleLocaleContext({
      where: {
        ...sampleLocaleContext().where,
        latitude: 40.6604,
        longitude: -73.957,
        timestamp: '2026-05-30T13:00:00.000Z',
      },
      place: {
        label: 'Studio',
        category: 'work',
        match: 'inside',
      },
      movement: {
        state: 'walking',
      },
    }),
  ], async (receiverUrl) => {
    const first = await runPublisherAsync(['--event', firstEvent, '--root', root], {
      env: { LOCALE_CONTEXT_RECEIVER_URL: receiverUrl, TZ: 'America/New_York' },
    });
    assert.equal(first.status, 0, first.stderr);

    const postPath = path.join(root, 'src', 'content', 'writing', '260530.md');
    let content = await readFile(postPath, 'utf8');
    assert.match(content, /capturedAt: "2026-05-30T12:34:56\.000Z"/);
    let frontmatter = parseFrontmatter(content);
    assert.equal(frontmatter.locale.place.neighborhood, 'Brooklyn');
    assert.equal(frontmatter.locale.place.namedPlace, 'Home');
    assert.equal(frontmatter.locale.place.category, 'residential');
    assert.equal(frontmatter.locale.place.altitude, '32 ft');
    assert.equal(frontmatter.locale.context.motion, 'stationary');
    assert.equal(frontmatter.locale.context.posture, 'face up');
    assert.equal(frontmatter.locale.context.freshness, '38s');
    assert.equal(frontmatter.locale.dwell, 'about 47m');
    assert.equal(frontmatter.locale.localTime, '8:34 AM EDT');
    assert.equal(frontmatter.locale.previousPost.label, 'same place');
    assert.equal(frontmatter.locale.position.latitude, 40.672);

    const second = await runPublisherAsync(['--event', secondEvent, '--root', root], {
      env: { LOCALE_CONTEXT_RECEIVER_URL: receiverUrl, TZ: 'America/New_York' },
    });
    assert.equal(second.status, 0, second.stderr);

    content = await readFile(postPath, 'utf8');
    assert.match(content, /capturedAt: "2026-05-30T13:00:00\.000Z"/);
    frontmatter = parseFrontmatter(content);
    assert.match(content, /first with place/);
    assert.match(content, /second with place/);
    assert.equal(frontmatter.locale.place.namedPlace, 'Studio');
    assert.equal(frontmatter.locale.place.category, 'work');
    assert.equal(frontmatter.locale.context.motion, 'walking');
    assert.equal(frontmatter.locale.previousPost.label, '0.8 mi away');
    assert.equal(frontmatter.locale.previousPost.distance, '0.8 mi');
    assert.equal(frontmatter.locale.position.latitude, 40.6604);
  });
}

async function testLocaleReceiverUnavailablePublishesWithoutLocale() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'locale-unavailable', {
    id: 'msg-locale-unavailable',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡 no receiver today',
  });

  const result = runPublisher(['--event', eventPath, '--root', root]);
  assert.equal(result.status, 0, result.stderr);

  const content = await readFile(path.join(root, 'src', 'content', 'writing', '260530.md'), 'utf8');
  assert.doesNotMatch(content, /\nlocale:/);
  assert.match(content, /no receiver today/);
}

async function testStaleLocalePublishesWithoutLocale() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'locale-stale', {
    id: 'msg-locale-stale',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡 stale receiver today',
  });

  await withLocaleServer([
    sampleLocaleContext({
      freshness: {
        status: 'old',
        sampleAgeSeconds: 2000,
      },
    }),
  ], async (receiverUrl) => {
    const result = await runPublisherAsync(['--event', eventPath, '--root', root], {
      env: { LOCALE_CONTEXT_RECEIVER_URL: receiverUrl },
    });
    assert.equal(result.status, 0, result.stderr);

    const content = await readFile(path.join(root, 'src', 'content', 'writing', '260530.md'), 'utf8');
    assert.doesNotMatch(content, /\nlocale:/);
    assert.match(content, /stale receiver today/);
  });
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
  assert.equal(payload.media[0].contentType, 'image/jpeg');
  assert.equal(payload.media[0].convertedFrom, null);
  assert.equal(
    payload.media[0].key,
    `stream/260530/260530-${localCompactTime('2026-05-30T12:34:56.000Z')}-message-media-guid-0-example-photo.jpg`
  );
  assert.equal(existsSync(path.join(root, 'src')), false);
}

async function testHeicMediaDryRunPlansJpegUploadByMimeType() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'heic-media-dry-run', {
    id: 'heic/media guid',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: '🎡🎡 photo',
    media: [{
      path: '/Users/edouard/Library/Messages/Attachments/IMG_5910.HEIC',
      mimeType: 'image/heic',
      alt: 'example heic',
    }],
  });

  const result = runPublisher(['--event', eventPath, '--root', root, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.media[0].type, 'image');
  assert.equal(payload.media[0].contentType, 'image/jpeg');
  assert.equal(payload.media[0].convertedFrom, 'image/heic');
  assert.equal(payload.media[0].url.endsWith('.jpg'), true);
  assert.equal(
    payload.media[0].key,
    `stream/260530/260530-${localCompactTime('2026-05-30T12:34:56.000Z')}-heic-media-guid-0-IMG_5910.jpg`
  );
  assert.equal(existsSync(path.join(root, 'src')), false);
}

async function testHeifMediaDryRunPlansJpegUploadByExtension() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'heif-media-dry-run', {
    id: 'heif/media guid',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: 'publish: photo',
    media: [{
      path: '/Users/edouard/Library/Messages/Attachments/example.HEIF',
      mimeType: 'application/octet-stream',
      alt: '',
    }],
  });

  const result = runPublisher(['--event', eventPath, '--root', root, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.media[0].type, 'image');
  assert.equal(payload.media[0].contentType, 'image/jpeg');
  assert.equal(payload.media[0].convertedFrom, 'application/octet-stream');
  assert.equal(payload.media[0].key.endsWith('-example.jpg'), true);
  assert.equal(existsSync(path.join(root, 'src')), false);
}

async function testHeicExtensionWithImageMimeDryRunPlansJpegUpload() {
  const root = await makeTempRoot();
  const eventPath = await writeEvent(root, 'heic-extension-media-dry-run', {
    id: 'heic extension/media guid',
    source: 'imessage',
    receivedAt: '2026-05-30T12:34:56.000Z',
    text: 'publish: photo',
    media: [{
      path: '/Users/edouard/Library/Messages/Attachments/example.heif',
      mimeType: 'image/heif-sequence',
      alt: '',
    }],
  });

  const result = runPublisher(['--event', eventPath, '--root', root, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.media[0].contentType, 'image/jpeg');
  assert.equal(payload.media[0].convertedFrom, 'image/heif-sequence');
  assert.equal(payload.media[0].key.endsWith('-example.jpg'), true);
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
await testLocaleCreatesAndAppendUpdatesLatestSnapshot();
await testLocaleReceiverUnavailablePublishesWithoutLocale();
await testStaleLocalePublishesWithoutLocale();
await testDraftCreatesDraft();
await testMissingPrefixWritesNothing();
await testEmptyPublishWritesNothing();
await testMediaDryRunPlansR2Key();
await testHeicMediaDryRunPlansJpegUploadByMimeType();
await testHeifMediaDryRunPlansJpegUploadByExtension();
await testHeicExtensionWithImageMimeDryRunPlansJpegUpload();
await testDoubleFerrisWheelStripsMediaIntentMarker();

console.log('publish-stream tests passed');
