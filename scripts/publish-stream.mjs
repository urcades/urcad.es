#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import YAML from 'yaml';
import { fetchLocaleContext, withPreviousPostDistance } from './locale-context.mjs';

const ALLOWED_SOURCES = new Set(['imessage', 'email', 'sms', 'cli', 'web', 'telegram']);
const COMMANDS = [
  { prefix: '🎡🎡', collection: 'writing' },
  { prefix: '🎡', collection: 'writing' },
  { prefix: 'publish:', collection: 'writing' },
  { prefix: 'draft:', collection: 'drafts' },
];
const SIPS_PATH = '/usr/bin/sips';
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);

function usage() {
  return `Usage: npm run publish:stream -- --event /path/to/event.json [--dry-run] [--root /repo/root]

Required event shape:
{
  "id": "stable-message-or-bridge-id",
  "source": "imessage",
  "receivedAt": "2026-05-30T12:34:56.000Z",
  "text": "🎡 body text",
  "media": [{ "path": "/absolute/path.jpg", "mimeType": "image/jpeg", "alt": "" }]
}`;
}

function parseArgs(argv) {
  const args = {
    eventPath: null,
    dryRun: false,
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--event') {
      args.eventPath = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--root') {
      args.root = path.resolve(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.eventPath) {
    throw new Error('Missing required --event argument.');
  }

  return args;
}

function parseDate(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Event must include receivedAt as an ISO date string.');
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid receivedAt value: ${value}`);
  }

  return date;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function getPostId(date) {
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function getDateTitle(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(date);
}

function getTimeLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function parseCommand(text) {
  if (typeof text !== 'string') {
    throw new Error('Event must include text as a string.');
  }

  const trimmed = text.trimStart();
  const command = COMMANDS.find(({ prefix }) => trimmed.toLowerCase().startsWith(prefix));
  if (!command) {
    throw new Error('Message text must start with "🎡", "publish:", or "draft:".');
  }

  const body = trimmed.slice(command.prefix.length).trim();
  return { ...command, body };
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('Event JSON must be an object.');
  }

  if (typeof event.id !== 'string' || event.id.trim() === '') {
    throw new Error('Event must include a stable non-empty id.');
  }

  if (!ALLOWED_SOURCES.has(event.source)) {
    throw new Error(`Event source must be one of: ${Array.from(ALLOWED_SOURCES).join(', ')}.`);
  }

  if (event.media !== undefined && !Array.isArray(event.media)) {
    throw new Error('Event media must be an array when provided.');
  }
}

function sanitizePathPart(value, fallback) {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return clean || fallback;
}

function mediaTypeFromMime(mimeType) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  throw new Error(`Unsupported media MIME type: ${mimeType || '(missing)'}`);
}

function mediaTypeFromItem(item) {
  if (shouldConvertHeicToJpeg(item)) return 'image';
  return mediaTypeFromMime(item.mimeType);
}

function buildR2Key({ postId, eventId, receivedAt, mediaPath, index }) {
  const basename = sanitizePathPart(path.basename(mediaPath), `media-${index}`);
  const eventPart = sanitizePathPart(eventId, 'event');
  const timePart = `${pad(receivedAt.getHours())}${pad(receivedAt.getMinutes())}${pad(receivedAt.getSeconds())}`;
  return `stream/${postId}/${postId}-${timePart}-${eventPart}-${index}-${basename}`;
}

function getPathExtension(mediaPath) {
  return path.extname(mediaPath || '').toLowerCase();
}

function replacePathExtension(mediaPath, extension) {
  const parsed = path.parse(mediaPath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function shouldConvertHeicToJpeg(item) {
  const mimeType = typeof item.mimeType === 'string' ? item.mimeType.toLowerCase() : '';
  return HEIC_MIME_TYPES.has(mimeType) || HEIC_EXTENSIONS.has(getPathExtension(item.path));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    child.stdout.on('data', chunk => {
      process.stderr.write(chunk);
    });
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function uploadMedia(event, date, dryRun) {
  const postId = getPostId(date);
  const media = event.media || [];
  const uploaded = [];

  for (let index = 0; index < media.length; index++) {
    const item = media[index];

    if (!item || typeof item !== 'object') {
      throw new Error(`Media item ${index} must be an object.`);
    }

    if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
      throw new Error(`Media item ${index} must include an absolute path.`);
    }

    if (!dryRun && !existsSync(item.path)) {
      throw new Error(`Media file does not exist: ${item.path}`);
    }

    const shouldConvertToJpeg = shouldConvertHeicToJpeg(item);
    const type = mediaTypeFromItem(item);
    const keyMediaPath = shouldConvertToJpeg
      ? replacePathExtension(item.path, '.jpg')
      : item.path;
    const contentType = shouldConvertToJpeg ? 'image/jpeg' : item.mimeType;
    const key = buildR2Key({
      postId,
      eventId: event.id,
      receivedAt: date,
      mediaPath: keyMediaPath,
      index,
    });

    let uploadPath = item.path;
    let tempDir = null;

    if (!dryRun) {
      try {
        if (shouldConvertToJpeg) {
          tempDir = await mkdtemp(path.join(os.tmpdir(), 'urcades-stream-media-'));
          uploadPath = path.join(tempDir, path.basename(keyMediaPath));
          await run(SIPS_PATH, [
            '-s',
            'format',
            'jpeg',
            '-s',
            'formatOptions',
            '90',
            item.path,
            '--out',
            uploadPath,
          ]);
        }

        await run('npx', [
          'wrangler',
          'r2',
          'object',
          'put',
          `urcades/${key}`,
          '--file',
          uploadPath,
          '--content-type',
          contentType,
          '--remote',
        ]);
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true });
        }
      }
    }

    uploaded.push({
      url: `https://media.urcad.es/${key}`,
      type,
      alt: typeof item.alt === 'string' ? item.alt : '',
      key,
      contentType,
      convertedFrom: shouldConvertToJpeg ? item.mimeType : null,
    });
  }

  return uploaded;
}

function createSnippet({ timeLabel, body, media }) {
  const parts = [timeLabel];

  if (body) {
    parts.push(body);
  }

  for (const item of media) {
    if (item.type === 'video') {
      parts.push(`<video src="${item.url}" controls style="max-width: 100%;"></video>`);
    } else {
      parts.push(`![${item.alt || ''}](${item.url})`);
    }
  }

  return parts.join('\n\n').trim();
}

function createBaseFrontmatter({ date, source }) {
  const title = getDateTitle(date);

  return {
    title,
    pubDate: date.toISOString(),
    description: `Daily stream - ${title}`,
    tags: ['stream'],
    source,
  };
}

function createNewPost({ snippet, date, source }) {
  const title = getDateTitle(date);
  const frontmatter = `---\ntitle: "${title}"\npubDate: ${date.toISOString()}\ndescription: "Daily stream - ${title}"\ntags: ["stream"]\nsource: "${source}"\n---`;
  return `${frontmatter}\n\n${snippet}`;
}

function appendToPost(existingContent, snippet) {
  return `${existingContent.trim()}\n\n~\n\n${snippet}`;
}

function parseMarkdownDocument(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!match) {
    throw new Error('Existing post is missing YAML frontmatter.');
  }

  const frontmatter = YAML.parse(match[1]) || {};
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('Existing post frontmatter must be a YAML object.');
  }

  return {
    frontmatter,
    body: match[2] || '',
  };
}

function normalizeFrontmatterForYaml(frontmatter) {
  const normalized = { ...frontmatter };
  if (normalized.pubDate instanceof Date) {
    normalized.pubDate = normalized.pubDate.toISOString();
  }
  if (normalized.locale) {
    normalized.locale = quoteYamlStrings(normalized.locale);
  }
  return normalized;
}

function quoteYamlStrings(value) {
  if (typeof value === 'string') {
    const scalar = new YAML.Scalar(value);
    scalar.type = 'QUOTE_DOUBLE';
    return scalar;
  }

  if (Array.isArray(value)) {
    return value.map(quoteYamlStrings);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, quoteYamlStrings(item)]),
    );
  }

  return value;
}

function serializeMarkdownDocument(frontmatter, body) {
  const yaml = YAML.stringify(normalizeFrontmatterForYaml(frontmatter), {
    lineWidth: 0,
  }).trimEnd();

  return `---\n${yaml}\n---\n\n${String(body).trim()}`;
}

function createNewPostWithLocale({ snippet, date, source, locale }) {
  const frontmatter = createBaseFrontmatter({ date, source });
  if (locale) frontmatter.locale = locale;
  return serializeMarkdownDocument(frontmatter, snippet);
}

function appendToPostWithLocale(existingContent, snippet, locale) {
  const document = parseMarkdownDocument(existingContent);
  const frontmatter = { ...document.frontmatter };
  if (locale) frontmatter.locale = locale;

  return serializeMarkdownDocument(
    frontmatter,
    `${document.body.trim()}\n\n~\n\n${snippet}`,
  );
}

function getPostPosition(frontmatter) {
  const position = frontmatter?.locale?.position;
  const latitude = position?.latitude;
  const longitude = position?.longitude;

  if (
    typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
  ) {
    return null;
  }

  return { latitude, longitude };
}

async function findPreviousPostPosition({ root, beforeDate, currentOutputPath }) {
  const writingDir = path.join(root, 'src', 'content', 'writing');
  if (!existsSync(writingDir)) return null;

  const entries = await readdir(writingDir, { withFileTypes: true });
  let previous = null;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const postPath = path.join(writingDir, entry.name);
    if (path.resolve(postPath) === path.resolve(currentOutputPath)) continue;

    let document;
    try {
      document = parseMarkdownDocument(await readFile(postPath, 'utf8'));
    } catch {
      continue;
    }

    const position = getPostPosition(document.frontmatter);
    if (!position) continue;

    const pubDate = document.frontmatter.pubDate instanceof Date
      ? document.frontmatter.pubDate
      : new Date(document.frontmatter.pubDate);
    if (Number.isNaN(pubDate.getTime()) || pubDate >= beforeDate) continue;

    if (!previous || pubDate > previous.pubDate) {
      previous = { pubDate, position };
    }
  }

  return previous?.position || null;
}

async function buildLocaleForPost({ root, collection, date, outputPath }) {
  const locale = await fetchLocaleContext();
  if (!locale) return null;
  if (collection !== 'writing') return locale;

  const previousPosition = await findPreviousPostPosition({
    root,
    beforeDate: date,
    currentOutputPath: outputPath,
  });

  return withPreviousPostDistance(locale, previousPosition);
}

async function writePost({ root, collection, postId, content, dryRun }) {
  const outputDir = path.join(root, 'src', 'content', collection);
  const outputPath = path.join(outputDir, `${postId}.md`);

  if (dryRun) {
    return { outputPath, wrote: false };
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content);
  return { outputPath, wrote: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readFile(path.resolve(args.eventPath), 'utf8');
  const event = JSON.parse(raw);

  validateEvent(event);

  const date = parseDate(event.receivedAt);
  const postId = getPostId(date);
  const command = parseCommand(event.text);
  const uploadedMedia = await uploadMedia(event, date, args.dryRun);

  if (!command.body && uploadedMedia.length === 0) {
    throw new Error('Message must include text content or media after the command prefix.');
  }

  const snippet = createSnippet({
    timeLabel: getTimeLabel(date),
    body: command.body,
    media: uploadedMedia,
  });

  if (!snippet) {
    throw new Error('Nothing to publish after parsing text and media.');
  }

  const outputPath = path.join(args.root, 'src', 'content', command.collection, `${postId}.md`);
  const existingContent = existsSync(outputPath)
    ? await readFile(outputPath, 'utf8')
    : null;
  const locale = await buildLocaleForPost({
    root: args.root,
    collection: command.collection,
    date,
    outputPath,
  });
  const content = locale
    ? (existingContent
        ? appendToPostWithLocale(existingContent, snippet, locale)
        : createNewPostWithLocale({ snippet, date, source: event.source, locale }))
    : (existingContent
        ? appendToPost(existingContent, snippet)
        : createNewPost({ snippet, date, source: event.source }));

  const result = await writePost({
    root: args.root,
    collection: command.collection,
    postId,
    content,
    dryRun: args.dryRun,
  });

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    collection: command.collection,
    postId,
    body: command.body,
    outputPath: result.outputPath,
    wrote: result.wrote,
    media: uploadedMedia.map(({ key, url, type, alt, contentType, convertedFrom }) => ({
      key,
      url,
      type,
      alt,
      contentType,
      convertedFrom,
    })),
    locale: locale
      ? {
          capturedAt: locale.capturedAt,
          previousPost: locale.previousPost || null,
        }
      : null,
  }, null, 2));
}

main().catch(error => {
  console.error(`publish-stream: ${error.message}`);
  process.exit(1);
});
