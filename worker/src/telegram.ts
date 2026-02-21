/**
 * Telegram Blog Publisher handler
 * Receives messages from Telegram bot and publishes to a daily digest post
 */

import type { Env } from './index';

interface TelegramUpdate {
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    username?: string;
  };
  chat: {
    id: number;
  };
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface MediaItem {
  url: string;
  type: 'image' | 'video';
}

interface GitHubFile {
  content: string;
  sha: string;
}

// Bluesky API interfaces
interface BlueskySession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

interface BlueskyBlob {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface BlueskyImageEmbed {
  $type: 'app.bsky.embed.images';
  images: Array<{
    image: BlueskyBlob;
    alt: string;
    aspectRatio?: { width: number; height: number };
  }>;
}

interface BlueskyExternalEmbed {
  $type: 'app.bsky.embed.external';
  external: {
    uri: string;
    title: string;
    description: string;
  };
}

interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: 'app.bsky.richtext.facet#link'; uri: string }>;
}

interface BlueskyPost {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  facets?: BlueskyFacet[];
  embed?: BlueskyImageEmbed | BlueskyExternalEmbed;
}

interface GoToSocialMediaAttachment {
  id: string;
  type: string;
  url: string;
}

// ============================================
// Utility Functions
// ============================================

// Generate a daily post ID (YYMMDD format)
function getDailyPostId(): string {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Generate a unique ID for media files (includes timestamp)
function getMediaId(): string {
  const now = new Date();
  return `${getDailyPostId()}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
}

// Format current time as "10:32 AM"
function getFormattedTime(): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Format date as "December 5"
function getFormattedDate(): string {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[now.getMonth()]} ${now.getDate()}`;
}

// Check if user ID is whitelisted
function isWhitelisted(userId: number, whitelist: string): boolean {
  const whitelistedIds = whitelist.split(',').map(id => id.trim());
  return whitelistedIds.includes(userId.toString());
}

// Get the URL for a stream post on the blog
function getPostUrl(postId: string): string {
  return `https://www.urcad.es/writing/${postId}`;
}

// ============================================
// Media Processing
// ============================================

// Get file from Telegram and upload to R2
async function downloadAndUploadMedia(
  fileId: string,
  mediaId: string,
  index: number,
  mediaType: 'image' | 'video',
  env: Env
): Promise<MediaItem | null> {
  try {
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileInfo = await fileInfoResponse.json() as { ok: boolean; result?: { file_path: string } };

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      console.error('Failed to get file info from Telegram');
      return null;
    }

    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      console.error('Failed to download file from Telegram');
      return null;
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const extension = fileInfo.result.file_path.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg');
    const filename = `${mediaId}-${index}.${extension}`;
    const r2Key = `stream/${getDailyPostId()}/${filename}`;

    const contentType = mediaType === 'video'
      ? `video/${extension}`
      : `image/${extension === 'jpg' ? 'jpeg' : extension}`;

    await env.MEDIA_BUCKET.put(r2Key, fileBuffer, {
      httpMetadata: { contentType }
    });

    return {
      url: `https://media.urcad.es/${r2Key}`,
      type: mediaType,
    };
  } catch (error) {
    console.error('Error processing media:', error);
    return null;
  }
}

// Process all media from a Telegram message
async function processMedia(
  message: TelegramMessage,
  env: Env
): Promise<MediaItem[]> {
  const mediaItems: MediaItem[] = [];
  const mediaId = getMediaId();
  let index = 0;

  if (message.photo && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    const item = await downloadAndUploadMedia(largestPhoto.file_id, mediaId, index, 'image', env);
    if (item) {
      mediaItems.push(item);
      index++;
    }
  }

  if (message.video) {
    const item = await downloadAndUploadMedia(message.video.file_id, mediaId, index, 'video', env);
    if (item) {
      mediaItems.push(item);
      index++;
    }
  }

  if (message.document) {
    const mimeType = message.document.mime_type || '';
    if (mimeType.startsWith('image/')) {
      const item = await downloadAndUploadMedia(message.document.file_id, mediaId, index, 'image', env);
      if (item) mediaItems.push(item);
    } else if (mimeType.startsWith('video/')) {
      const item = await downloadAndUploadMedia(message.document.file_id, mediaId, index, 'video', env);
      if (item) mediaItems.push(item);
    }
  }

  return mediaItems;
}

// ============================================
// Content Assembly
// ============================================

// Create a new snippet entry with timestamp
function createSnippet(text: string, media: MediaItem[]): string {
  const time = getFormattedTime();
  let snippet = `${time}\n\n${text}`;

  if (media.length > 0) {
    snippet += '\n\n';
    media.forEach(m => {
      if (m.type === 'video') {
        snippet += `<video src="${m.url}" controls style="max-width: 100%;"></video>\n`;
      } else {
        snippet += `![](${m.url})\n`;
      }
    });
  }

  return snippet.trim();
}

// Create initial markdown content for a new daily post
function createNewDailyPost(snippet: string): string {
  const now = new Date().toISOString();
  const title = getFormattedDate();

  const frontmatter = `---
title: "${title}"
pubDate: ${now}
description: "Daily stream - ${title}"
tags: ["stream"]
source: "telegram"
---`;

  return `${frontmatter}\n\n${snippet}`;
}

// Append to existing post content
function appendToPost(existingContent: string, snippet: string): string {
  return `${existingContent.trim()}\n\n~\n\n${snippet}`;
}

// ============================================
// GitHub Integration
// ============================================

// Try to get existing file from GitHub
async function getExistingFile(
  postId: string,
  isDraft: boolean,
  env: Env
): Promise<GitHubFile | null> {
  const [owner, repo] = env.GITHUB_REPO.split('/');
  const collection = isDraft ? 'drafts' : 'writing';
  const path = `src/content/${collection}/${postId}.md`;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'User-Agent': 'urcades-worker',
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (response.status === 404) return null;

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as { content: string; sha: string };
    const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { content, sha: data.sha };
  } catch (error) {
    console.error('Error fetching file from GitHub:', error);
    return null;
  }
}

// Commit file to GitHub (create or update)
async function commitToGitHub(
  content: string,
  postId: string,
  isDraft: boolean,
  sha: string | null,
  env: Env
): Promise<boolean> {
  const [owner, repo] = env.GITHUB_REPO.split('/');
  const collection = isDraft ? 'drafts' : 'writing';
  const path = `src/content/${collection}/${postId}.md`;
  const action = sha ? 'Update' : 'Create';

  try {
    const body: Record<string, string> = {
      message: `${isDraft ? '[Draft] ' : ''}${action} daily stream: ${getFormattedDate()}`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: 'main',
    };

    if (sha) body.sha = sha;

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'urcades-worker',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`GitHub API error: ${response.status} - ${error}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error committing to GitHub:', error);
    return false;
  }
}

// Send a message back to the user via Telegram
async function sendTelegramMessage(chatId: number, text: string, env: Env): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ============================================
// Bluesky Cross-posting
// ============================================

const BLUESKY_CHAR_LIMIT = 300;

// Bluesky requires explicit "facets" to make URLs clickable.
// Facets use UTF-8 byte offsets, not JS string indices.
function detectLinkFacets(text: string): BlueskyFacet[] {
  const encoder = new TextEncoder();
  const facets: BlueskyFacet[] = [];
  const urlRegex = /https?:\/\/[^\s<>")\]]+/g;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    let url = match[0];
    // Strip trailing punctuation that's unlikely part of the URL
    url = url.replace(/[.,;:!?]+$/, '');

    const byteStart = encoder.encode(text.slice(0, match.index)).byteLength;
    const byteEnd = byteStart + encoder.encode(url).byteLength;

    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }

  return facets;
}

function getBlueskyApi(env: Env): string {
  return env.BLUESKY_PDS_URL || 'https://bsky.social/xrpc';
}

function isBlueskyConfigured(env: Env): boolean {
  return !!(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
}

async function createBlueskySession(env: Env): Promise<BlueskySession | null> {
  if (!isBlueskyConfigured(env)) return null;

  const apiUrl = getBlueskyApi(env);
  try {
    const response = await fetch(`${apiUrl}/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: env.BLUESKY_HANDLE,
        password: env.BLUESKY_APP_PASSWORD,
      }),
    });

    if (!response.ok) {
      console.error(`Bluesky auth failed: ${response.status}`);
      return null;
    }

    return await response.json() as BlueskySession;
  } catch (error) {
    console.error('Bluesky auth error:', error);
    return null;
  }
}

async function uploadBlueskyBlob(
  imageUrl: string,
  session: BlueskySession,
  env: Env
): Promise<BlueskyBlob | null> {
  const apiUrl = getBlueskyApi(env);
  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`Failed to fetch image: ${imageUrl}`);
      return null;
    }

    const imageData = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    if (imageData.byteLength > 1000000) {
      console.error('Image too large for Bluesky (>1MB)');
      return null;
    }

    const response = await fetch(`${apiUrl}/com.atproto.repo.uploadBlob`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${session.accessJwt}`,
      },
      body: imageData,
    });

    if (!response.ok) {
      console.error(`Bluesky blob upload failed: ${response.status}`);
      return null;
    }

    const result = await response.json() as { blob: BlueskyBlob };
    return result.blob;
  } catch (error) {
    console.error('Bluesky blob upload error:', error);
    return null;
  }
}

function truncateForBluesky(text: string, postUrl: string): string {
  if (!text.trim()) return postUrl;

  const suffix = `\n\n${postUrl}`;

  if (text.length + suffix.length <= BLUESKY_CHAR_LIMIT) {
    return text + suffix;
  }

  const maxTextLength = BLUESKY_CHAR_LIMIT - suffix.length - 3;
  const truncated = text.slice(0, maxTextLength).trim();
  return truncated + '...' + suffix;
}

async function postToBluesky(
  text: string,
  media: MediaItem[],
  postId: string,
  session: BlueskySession,
  env: Env
): Promise<boolean> {
  const apiUrl = getBlueskyApi(env);
  try {
    const postUrl = getPostUrl(postId);
    const truncatedText = truncateForBluesky(text, postUrl);

    const facets = detectLinkFacets(truncatedText);
    const record: BlueskyPost = {
      $type: 'app.bsky.feed.post',
      text: truncatedText,
      createdAt: new Date().toISOString(),
      ...(facets.length > 0 && { facets }),
    };

    const images = media.filter(m => m.type === 'image').slice(0, 4);
    if (images.length > 0) {
      const uploadedImages: Array<{ image: BlueskyBlob; alt: string }> = [];

      for (const img of images) {
        const blob = await uploadBlueskyBlob(img.url, session, env);
        if (blob) {
          uploadedImages.push({ image: blob, alt: '' });
        }
      }

      if (uploadedImages.length > 0) {
        record.embed = {
          $type: 'app.bsky.embed.images',
          images: uploadedImages,
        };
      }
    }

    const response = await fetch(`${apiUrl}/com.atproto.repo.createRecord`, {
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

    if (!response.ok) {
      const error = await response.text();
      console.error(`Bluesky post failed: ${response.status} - ${error}`);
      return false;
    }

    console.log('Successfully posted to Bluesky');
    return true;
  } catch (error) {
    console.error('Bluesky post error:', error);
    return false;
  }
}

async function crossPostToBluesky(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isBlueskyConfigured(env)) return false;

  const session = await createBlueskySession(env);
  if (!session) {
    console.error('Failed to create Bluesky session');
    return false;
  }

  return await postToBluesky(text, media, postId, session, env);
}

// ============================================
// Are.na Cross-posting
// ============================================

const ARENA_API = 'https://api.are.na/v2';

function isArenaConfigured(env: Env): boolean {
  return !!(env.ARENA_ACCESS_TOKEN && env.ARENA_CHANNEL_SLUG);
}

async function createArenaBlock(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isArenaConfigured(env)) return false;

  try {
    const postUrl = getPostUrl(postId);
    const results: boolean[] = [];

    for (const item of media) {
      if (item.type === 'image') {
        const response = await fetch(
          `${ARENA_API}/channels/${env.ARENA_CHANNEL_SLUG}/blocks`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${env.ARENA_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ source: item.url }),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          console.error(`Are.na image block failed: ${response.status} - ${error}`);
          results.push(false);
        } else {
          console.log('Successfully created Are.na image block');
          results.push(true);
        }
      }
    }

    if (text) {
      const content = `${text}\n\n[${postUrl}](${postUrl})`;
      const response = await fetch(
        `${ARENA_API}/channels/${env.ARENA_CHANNEL_SLUG}/blocks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.ARENA_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({ content }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(`Are.na text block failed: ${response.status} - ${error}`);
        results.push(false);
      } else {
        console.log('Successfully created Are.na text block');
        results.push(true);
      }
    }

    return results.some(r => r === true);
  } catch (error) {
    console.error('Are.na post error:', error);
    return false;
  }
}

async function crossPostToArena(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isArenaConfigured(env)) return false;
  return await createArenaBlock(text, media, postId, env);
}

// ============================================
// GoToSocial Cross-posting
// ============================================

function isGoToSocialConfigured(env: Env): boolean {
  return !!(env.GOTOSOCIAL_URL && env.GOTOSOCIAL_ACCESS_TOKEN);
}

async function uploadGoToSocialMedia(
  mediaUrl: string,
  env: Env
): Promise<string | null> {
  try {
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      console.error(`Failed to fetch media: ${mediaUrl}`);
      return null;
    }

    const mediaData = await mediaResponse.arrayBuffer();
    const contentType = mediaResponse.headers.get('content-type') || 'image/jpeg';
    const filename = mediaUrl.split('/').pop() || 'media';

    const formData = new FormData();
    formData.append('file', new Blob([mediaData], { type: contentType }), filename);

    const response = await fetch(`${env.GOTOSOCIAL_URL}/api/v1/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GOTOSOCIAL_ACCESS_TOKEN}`,
        'User-Agent': 'urcades-worker',
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`GoToSocial media upload failed: ${response.status} - ${error}`);
      return null;
    }

    const result = await response.json() as GoToSocialMediaAttachment;
    return result.id;
  } catch (error) {
    console.error('GoToSocial media upload error:', error);
    return null;
  }
}

async function postToGoToSocial(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  try {
    const postUrl = getPostUrl(postId);
    const statusText = text ? `${text}\n\n${postUrl}` : postUrl;

    const mediaIds: string[] = [];
    const images = media.filter(m => m.type === 'image').slice(0, 6);

    for (const img of images) {
      const mediaId = await uploadGoToSocialMedia(img.url, env);
      if (mediaId) mediaIds.push(mediaId);
    }

    const formData = new FormData();
    formData.append('status', statusText);
    formData.append('visibility', 'public');
    for (const id of mediaIds) {
      formData.append('media_ids[]', id);
    }

    const response = await fetch(`${env.GOTOSOCIAL_URL}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GOTOSOCIAL_ACCESS_TOKEN}`,
        'User-Agent': 'urcades-worker',
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`GoToSocial post failed: ${response.status} - ${error}`);
      return false;
    }

    console.log('Successfully posted to GoToSocial');
    return true;
  } catch (error) {
    console.error('GoToSocial post error:', error);
    return false;
  }
}

async function crossPostToGoToSocial(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isGoToSocialConfigured(env)) return false;
  return await postToGoToSocial(text, media, postId, env);
}

// ============================================
// Main Handler
// ============================================

export async function handleTelegram(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();

    if (!update.message) {
      return new Response('OK', { status: 200 });
    }

    const message = update.message;
    const userId = message.from.id;
    const chatId = message.chat.id;
    const messageText = message.text || message.caption || '';

    if (!messageText && !message.photo && !message.video && !message.document) {
      return new Response('OK', { status: 200 });
    }

    const whitelisted = isWhitelisted(userId, env.WHITELISTED_USERS);
    const isDraft = !whitelisted;
    const postId = getDailyPostId();

    const media = await processMedia(message, env);
    const snippet = createSnippet(messageText, media);
    const existingFile = await getExistingFile(postId, isDraft, env);

    let finalContent: string;
    let sha: string | null = null;

    if (existingFile) {
      finalContent = appendToPost(existingFile.content, snippet);
      sha = existingFile.sha;
    } else {
      finalContent = createNewDailyPost(snippet);
    }

    const success = await commitToGitHub(finalContent, postId, isDraft, sha, env);

    if (success) {
      const action = existingFile ? 'Added to' : 'Started';
      let status = isDraft
        ? `Saved as draft (user ${userId} not whitelisted)`
        : `${action} ${getFormattedDate()}`;

      if (!isDraft) {
        if (isBlueskyConfigured(env)) {
          const ok = await crossPostToBluesky(messageText, media, postId, env);
          status += ok ? ' + Bluesky' : ' (Bluesky failed)';
        }

        if (isArenaConfigured(env)) {
          const ok = await crossPostToArena(messageText, media, postId, env);
          status += ok ? ' + Are.na' : ' (Are.na failed)';
        }

        if (isGoToSocialConfigured(env)) {
          const ok = await crossPostToGoToSocial(messageText, media, postId, env);
          status += ok ? ' + GoToSocial' : ' (GoToSocial failed)';
        }
      }

      await sendTelegramMessage(chatId, status, env);
    } else {
      await sendTelegramMessage(chatId, 'Error publishing. Please try again.', env);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Telegram handler error:', error);
    return new Response('Internal error', { status: 500 });
  }
}
