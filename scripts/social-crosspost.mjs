#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const socialConfigRelativePath = path.join('Library', 'Application Support', 'urcad.es', 'social-crosspost.json');
const BLUESKY_CHAR_LIMIT = 300;
const ARENA_API = 'https://api.are.na/v3';

const SECRET_KEYS = [
  'BLUESKY_HANDLE',
  'BLUESKY_APP_PASSWORD',
  'BLUESKY_PDS_URL',
  'ARENA_ACCESS_TOKEN',
  'ARENA_CHANNEL_SLUG',
  'GOTOSOCIAL_URL',
  'GOTOSOCIAL_ACCESS_TOKEN',
];

function hasUnsafePermissionBits(mode) {
  return (mode & 0o077) !== 0;
}

export function getSocialCrosspostConfigFilePath(homeDir = process.env.HOME) {
  if (!homeDir) {
    throw new Error('Cannot resolve social cross-post config without HOME.');
  }

  return path.join(homeDir, socialConfigRelativePath);
}

export function sanitizeSocialError(value, config = {}) {
  let message = value instanceof Error ? value.message : String(value || '');

  for (const key of SECRET_KEYS) {
    const secret = config[key];
    if (typeof secret === 'string' && secret.length > 0) {
      message = message.split(secret).join('[redacted]');
    }
  }

  return message
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'unknown error';
}

export async function loadSocialCrosspostConfig({ env = process.env, allowMissing = false } = {}) {
  const configPath = getSocialCrosspostConfigFilePath(env.HOME || process.env.HOME);

  let info;
  try {
    info = await stat(configPath);
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) {
      return null;
    }
    if (error.code === 'ENOENT') {
      throw new Error(`Social cross-post config missing at ${configPath}`);
    }
    throw error;
  }

  if (hasUnsafePermissionBits(info.mode)) {
    throw new Error(`Social cross-post config must use owner-only permissions: ${configPath}`);
  }

  const raw = (await readFile(configPath, 'utf8')).trim();
  if (!raw) {
    throw new Error(`Social cross-post config is empty: ${configPath}`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config must be a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Social cross-post config is not valid JSON: ${error.message}`);
  }
}

export function configuredTargets(config = {}) {
  return {
    bluesky: Boolean(config.BLUESKY_HANDLE && config.BLUESKY_APP_PASSWORD),
    arena: Boolean(config.ARENA_ACCESS_TOKEN && config.ARENA_CHANNEL_SLUG),
    gotosocial: Boolean(config.GOTOSOCIAL_URL && config.GOTOSOCIAL_ACCESS_TOKEN),
  };
}

function targetSkipped(reason = 'not configured') {
  return { ok: false, skipped: true, error: reason };
}

function targetOk() {
  return { ok: true, skipped: false, error: null };
}

function targetFailed(error, config) {
  return { ok: false, skipped: false, error: sanitizeSocialError(error, config) };
}

export function createSkippedCrosspostResult(reason) {
  return {
    attempted: false,
    error: reason,
    bluesky: targetSkipped(reason),
    arena: targetSkipped(reason),
    gotosocial: targetSkipped(reason),
  };
}

function detectLinkFacets(text) {
  const encoder = new TextEncoder();
  const facets = [];
  const urlRegex = /https?:\/\/[^\s<>")\]]+/g;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    const byteStart = encoder.encode(text.slice(0, match.index)).byteLength;
    const byteEnd = byteStart + encoder.encode(url).byteLength;

    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }

  return facets;
}

function truncateForBluesky(text, publicUrl) {
  if (!text.trim()) return publicUrl;

  const suffix = `\n\n${publicUrl}`;
  if (text.length + suffix.length <= BLUESKY_CHAR_LIMIT) {
    return text + suffix;
  }

  const maxTextLength = BLUESKY_CHAR_LIMIT - suffix.length - 3;
  return `${text.slice(0, maxTextLength).trim()}...${suffix}`;
}

function getBlueskyApi(config) {
  return config.BLUESKY_PDS_URL || 'https://bsky.social/xrpc';
}

async function createBlueskySession(config, fetchImpl) {
  const response = await fetchImpl(`${getBlueskyApi(config)}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: config.BLUESKY_HANDLE,
      password: config.BLUESKY_APP_PASSWORD,
    }),
  });

  if (!response.ok) {
    return { error: `auth ${response.status}` };
  }

  return { session: await response.json() };
}

async function uploadBlueskyBlob(mediaUrl, session, config, fetchImpl) {
  const imageResponse = await fetchImpl(mediaUrl);
  if (!imageResponse.ok) return null;

  const imageData = await imageResponse.arrayBuffer();
  if (imageData.byteLength > 1000000) return null;

  const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
  const response = await fetchImpl(`${getBlueskyApi(config)}/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Authorization': `Bearer ${session.accessJwt}`,
    },
    body: imageData,
  });

  if (!response.ok) return null;

  const result = await response.json();
  return result.blob || null;
}

async function crossPostToBluesky({ text, publicUrl, media, config, fetchImpl }) {
  if (!configuredTargets(config).bluesky) return targetSkipped();

  try {
    const { session, error } = await createBlueskySession(config, fetchImpl);
    if (!session) return targetFailed(error || 'auth failed', config);

    const postText = truncateForBluesky(text, publicUrl);
    const facets = detectLinkFacets(postText);
    const record = {
      $type: 'app.bsky.feed.post',
      text: postText,
      createdAt: new Date().toISOString(),
      ...(facets.length > 0 && { facets }),
    };

    const image = media.find(item => item.type === 'image');
    if (image) {
      const blob = await uploadBlueskyBlob(image.url, session, config, fetchImpl);
      if (blob) {
        record.embed = {
          $type: 'app.bsky.embed.images',
          images: [{ image: blob, alt: image.alt || '' }],
        };
      }
    }

    const response = await fetchImpl(`${getBlueskyApi(config)}/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });

    if (!response.ok) return targetFailed(`post ${response.status}`, config);
    return targetOk();
  } catch (error) {
    return targetFailed(error, config);
  }
}

async function postArenaBlock(body, config, fetchImpl) {
  const response = await fetchImpl(`${ARENA_API}/blocks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ARENA_ACCESS_TOKEN}`,
      'User-Agent': 'urcades-local-publisher',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { ok: false, error: `${response.status}` };
  }

  return { ok: true };
}

async function crossPostToArena({ text, publicUrl, media, config, fetchImpl }) {
  if (!configuredTargets(config).arena) return targetSkipped();

  try {
    const channelIds = [config.ARENA_CHANNEL_SLUG];
    const errors = [];
    let anySuccess = false;
    const image = media.find(item => item.type === 'image');

    if (image) {
      const result = await postArenaBlock({ value: image.url, channel_ids: channelIds }, config, fetchImpl);
      if (result.ok) {
        anySuccess = true;
      } else {
        errors.push(`image ${result.error}`);
      }
    }

    if (text) {
      const value = `${text}\n\n[${publicUrl}](${publicUrl})`;
      const result = await postArenaBlock({ value, channel_ids: channelIds }, config, fetchImpl);
      if (result.ok) {
        anySuccess = true;
      } else {
        errors.push(`text ${result.error}`);
      }
    }

    if (anySuccess) return targetOk();
    return targetFailed(errors.join(', ') || 'no blocks created', config);
  } catch (error) {
    return targetFailed(error, config);
  }
}

async function uploadGoToSocialMedia(mediaUrl, config, fetchImpl) {
  const mediaResponse = await fetchImpl(mediaUrl);
  if (!mediaResponse.ok) return null;

  const mediaData = await mediaResponse.arrayBuffer();
  const contentType = mediaResponse.headers.get('content-type') || 'image/jpeg';
  const filename = mediaUrl.split('/').pop() || 'media';
  const formData = new FormData();
  formData.append('file', new Blob([mediaData], { type: contentType }), filename);

  const response = await fetchImpl(`${config.GOTOSOCIAL_URL}/api/v1/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.GOTOSOCIAL_ACCESS_TOKEN}`,
      'User-Agent': 'urcades-local-publisher',
    },
    body: formData,
  });

  if (!response.ok) return null;

  const result = await response.json();
  return result.id || null;
}

async function crossPostToGoToSocial({ text, publicUrl, media, config, fetchImpl }) {
  if (!configuredTargets(config).gotosocial) return targetSkipped();

  try {
    const image = media.find(item => item.type === 'image');
    const mediaIds = [];

    if (image) {
      const mediaId = await uploadGoToSocialMedia(image.url, config, fetchImpl);
      if (mediaId) mediaIds.push(mediaId);
    }

    const formData = new FormData();
    formData.append('status', text ? `${text}\n\n${publicUrl}` : publicUrl);
    formData.append('visibility', 'public');
    for (const id of mediaIds) {
      formData.append('media_ids[]', id);
    }

    const response = await fetchImpl(`${config.GOTOSOCIAL_URL}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.GOTOSOCIAL_ACCESS_TOKEN}`,
        'User-Agent': 'urcades-local-publisher',
      },
      body: formData,
    });

    if (!response.ok) return targetFailed(`${response.status}`, config);
    return targetOk();
  } catch (error) {
    return targetFailed(error, config);
  }
}

export async function crossPostStream({
  text,
  postId,
  publicUrl,
  media = [],
  config,
  fetchImpl = globalThis.fetch,
}) {
  if (!config) {
    return createSkippedCrosspostResult('social config missing');
  }

  const normalizedMedia = Array.isArray(media) ? media.slice(0, 1) : [];
  const payload = {
    text: String(text || ''),
    postId,
    publicUrl,
    media: normalizedMedia,
    config,
    fetchImpl,
  };

  const result = {
    attempted: Object.values(configuredTargets(config)).some(Boolean),
    bluesky: await crossPostToBluesky(payload),
    arena: await crossPostToArena(payload),
    gotosocial: await crossPostToGoToSocial(payload),
  };

  if (!result.attempted) {
    result.error = 'no social targets configured';
  }

  return result;
}
