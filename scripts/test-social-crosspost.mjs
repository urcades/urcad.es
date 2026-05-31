#!/usr/bin/env node

import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import {
  crossPostStream,
  getSocialCrosspostConfigFilePath,
  loadSocialCrosspostConfig,
} from './social-crosspost.mjs';

const fullConfig = {
  BLUESKY_HANDLE: 'example.test',
  BLUESKY_APP_PASSWORD: 'bsky-secret',
  BLUESKY_PDS_URL: 'https://bsky.example/xrpc',
  ARENA_ACCESS_TOKEN: 'arena-secret',
  ARENA_CHANNEL_SLUG: 'stream-channel',
  GOTOSOCIAL_URL: 'https://social.example',
  GOTOSOCIAL_ACCESS_TOKEN: 'gts-secret',
};

async function makeHomeWithConfig(content, mode = 0o600) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'urcades-social-home-'));
  const configPath = getSocialCrosspostConfigFilePath(homeDir);
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, content, { mode });
  chmodSync(configPath, mode);
  return { homeDir, configPath };
}

function responseJson(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

async function testConfigLoaderRejectsBadFiles() {
  const missingHome = await mkdtemp(path.join(os.tmpdir(), 'urcades-social-missing-'));
  await assert.rejects(
    loadSocialCrosspostConfig({ env: { HOME: missingHome } }),
    /missing/
  );

  const empty = await makeHomeWithConfig('');
  await assert.rejects(
    loadSocialCrosspostConfig({ env: { HOME: empty.homeDir } }),
    /empty/
  );

  const malformed = await makeHomeWithConfig('{nope');
  await assert.rejects(
    loadSocialCrosspostConfig({ env: { HOME: malformed.homeDir } }),
    /not valid JSON/
  );

  const tooReadable = await makeHomeWithConfig(JSON.stringify(fullConfig), 0o644);
  await assert.rejects(
    loadSocialCrosspostConfig({ env: { HOME: tooReadable.homeDir } }),
    /owner-only/
  );
}

async function testConfigLoaderAcceptsOwnerOnlyJson() {
  const { homeDir } = await makeHomeWithConfig(JSON.stringify(fullConfig, null, 2));
  const config = await loadSocialCrosspostConfig({ env: { HOME: homeDir } });
  assert.equal(config.BLUESKY_HANDLE, fullConfig.BLUESKY_HANDLE);
  assert.equal(config.ARENA_CHANNEL_SLUG, fullConfig.ARENA_CHANNEL_SLUG);
  assert.equal(config.GOTOSOCIAL_URL, fullConfig.GOTOSOCIAL_URL);
}

async function testBlueskyTextOnlyPayload() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/com.atproto.server.createSession')) {
      return responseJson({ did: 'did:plc:test', handle: 'example.test', accessJwt: 'jwt' });
    }
    if (url.endsWith('/com.atproto.repo.createRecord')) {
      return responseJson({ uri: 'at://post' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await crossPostStream({
    text: 'hello from https://example.com',
    postId: '260531',
    publicUrl: 'https://www.urcad.es/writing/260531/',
    config: {
      BLUESKY_HANDLE: fullConfig.BLUESKY_HANDLE,
      BLUESKY_APP_PASSWORD: fullConfig.BLUESKY_APP_PASSWORD,
      BLUESKY_PDS_URL: fullConfig.BLUESKY_PDS_URL,
    },
    fetchImpl,
  });

  assert.equal(result.bluesky.ok, true);
  assert.equal(result.arena.skipped, true);
  assert.equal(result.gotosocial.skipped, true);

  const createRecord = calls.find(call => call.url.endsWith('/com.atproto.repo.createRecord'));
  const body = JSON.parse(createRecord.options.body);
  assert.equal(body.collection, 'app.bsky.feed.post');
  assert.match(body.record.text, /hello from/);
  assert.match(body.record.text, /https:\/\/www\.urcad\.es\/writing\/260531\//);
  assert.equal(body.record.facets.length, 2);
}

async function testBlueskyOneImageEmbed() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/com.atproto.server.createSession')) {
      return responseJson({ did: 'did:plc:test', handle: 'example.test', accessJwt: 'jwt' });
    }
    if (url === 'https://media.urcad.es/stream/260531/photo.jpg') {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    if (url.endsWith('/com.atproto.repo.uploadBlob')) {
      return responseJson({
        blob: {
          $type: 'blob',
          ref: { $link: 'blob-ref' },
          mimeType: 'image/jpeg',
          size: 3,
        },
      });
    }
    if (url.endsWith('/com.atproto.repo.createRecord')) {
      return responseJson({ uri: 'at://post' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await crossPostStream({
    text: 'photo',
    postId: '260531',
    publicUrl: 'https://www.urcad.es/writing/260531/',
    media: [{ url: 'https://media.urcad.es/stream/260531/photo.jpg', type: 'image', alt: 'photo alt' }],
    config: {
      BLUESKY_HANDLE: fullConfig.BLUESKY_HANDLE,
      BLUESKY_APP_PASSWORD: fullConfig.BLUESKY_APP_PASSWORD,
      BLUESKY_PDS_URL: fullConfig.BLUESKY_PDS_URL,
    },
    fetchImpl,
  });

  assert.equal(result.bluesky.ok, true);
  const createRecord = calls.find(call => call.url.endsWith('/com.atproto.repo.createRecord'));
  const body = JSON.parse(createRecord.options.body);
  assert.equal(body.record.embed.$type, 'app.bsky.embed.images');
  assert.equal(body.record.embed.images[0].alt, 'photo alt');
}

async function testArenaImageAndTextBlocks() {
  const blocks = [];
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url, 'https://api.are.na/v3/blocks');
    blocks.push(JSON.parse(options.body));
    return responseJson({ id: blocks.length });
  };

  const result = await crossPostStream({
    text: 'arena note',
    postId: '260531',
    publicUrl: 'https://www.urcad.es/writing/260531/',
    media: [{ url: 'https://media.urcad.es/stream/260531/photo.jpg', type: 'image' }],
    config: {
      ARENA_ACCESS_TOKEN: fullConfig.ARENA_ACCESS_TOKEN,
      ARENA_CHANNEL_SLUG: fullConfig.ARENA_CHANNEL_SLUG,
    },
    fetchImpl,
  });

  assert.equal(result.arena.ok, true);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], {
    value: 'https://media.urcad.es/stream/260531/photo.jpg',
    channel_ids: ['stream-channel'],
  });
  assert.match(blocks[1].value, /arena note/);
  assert.match(blocks[1].value, /https:\/\/www\.urcad\.es\/writing\/260531\//);
}

async function testGoToSocialImageStatus() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://media.urcad.es/stream/260531/photo.jpg') {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    if (url === 'https://social.example/api/v1/media') {
      return responseJson({ id: 'media-id' });
    }
    if (url === 'https://social.example/api/v1/statuses') {
      return responseJson({ id: 'status-id' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await crossPostStream({
    text: 'gts note',
    postId: '260531',
    publicUrl: 'https://www.urcad.es/writing/260531/',
    media: [{ url: 'https://media.urcad.es/stream/260531/photo.jpg', type: 'image' }],
    config: {
      GOTOSOCIAL_URL: fullConfig.GOTOSOCIAL_URL,
      GOTOSOCIAL_ACCESS_TOKEN: fullConfig.GOTOSOCIAL_ACCESS_TOKEN,
    },
    fetchImpl,
  });

  assert.equal(result.gotosocial.ok, true);
  assert.equal(calls.some(call => call.url === 'https://social.example/api/v1/media'), true);
  assert.equal(calls.some(call => call.url === 'https://social.example/api/v1/statuses'), true);
}

async function testTargetFailureIsStructuredAndNonThrowing() {
  const fetchImpl = async () => new Response('nope', { status: 401 });
  const result = await crossPostStream({
    text: 'arena fails',
    postId: '260531',
    publicUrl: 'https://www.urcad.es/writing/260531/',
    config: {
      ARENA_ACCESS_TOKEN: fullConfig.ARENA_ACCESS_TOKEN,
      ARENA_CHANNEL_SLUG: fullConfig.ARENA_CHANNEL_SLUG,
    },
    fetchImpl,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.arena.ok, false);
  assert.equal(result.arena.skipped, false);
  assert.match(result.arena.error, /text 401|no blocks created/);
}

await testConfigLoaderRejectsBadFiles();
await testConfigLoaderAcceptsOwnerOnlyJson();
await testBlueskyTextOnlyPayload();
await testBlueskyOneImageEmbed();
await testArenaImageAndTextBlocks();
await testGoToSocialImageStatus();
await testTargetFailureIsStructuredAndNonThrowing();

console.log('social-crosspost tests passed');
