/**
 * Telegram Blog Publisher Cloudflare Worker
 * Receives messages from Telegram bot and publishes to a daily digest post
 */

export interface Env {
  // R2 bucket for media storage
  MEDIA_BUCKET: R2Bucket;
  // GitHub Personal Access Token
  GITHUB_TOKEN: string;
  // GitHub repo in format "owner/repo"
  GITHUB_REPO: string;
  // Telegram Bot Token
  TELEGRAM_BOT_TOKEN: string;
  // Comma-separated list of whitelisted Telegram user IDs
  WHITELISTED_USERS: string;
  // Bluesky credentials (optional - for cross-posting)
  BLUESKY_HANDLE?: string;
  BLUESKY_APP_PASSWORD?: string;
  // Custom PDS URL (optional - defaults to bsky.social)
  BLUESKY_PDS_URL?: string;
  // Are.na credentials (optional - for cross-posting)
  ARENA_ACCESS_TOKEN?: string;
  ARENA_CHANNEL_SLUG?: string;
  // GoToSocial credentials (optional - for cross-posting)
  GOTOSOCIAL_URL?: string;          // e.g., "https://social.example.com"
  GOTOSOCIAL_ACCESS_TOKEN?: string; // OAuth Bearer token
}

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

interface BlueskyPost {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  embed?: BlueskyImageEmbed | BlueskyExternalEmbed;
}

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

// Get file from Telegram and upload to R2
async function downloadAndUploadMedia(
  fileId: string,
  mediaId: string,
  index: number,
  mediaType: 'image' | 'video',
  env: Env
): Promise<MediaItem | null> {
  try {
    // Get file path from Telegram
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileInfo = await fileInfoResponse.json() as { ok: boolean; result?: { file_path: string } };

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      console.error('Failed to get file info from Telegram');
      return null;
    }

    // Download file from Telegram
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

    // Determine content type
    const contentType = mediaType === 'video'
      ? `video/${extension}`
      : `image/${extension === 'jpg' ? 'jpeg' : extension}`;

    // Upload to R2
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

  // Handle photos (Telegram sends multiple sizes, we want the largest)
  if (message.photo && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    const item = await downloadAndUploadMedia(largestPhoto.file_id, mediaId, index, 'image', env);
    if (item) {
      mediaItems.push(item);
      index++;
    }
  }

  // Handle video
  if (message.video) {
    const item = await downloadAndUploadMedia(message.video.file_id, mediaId, index, 'video', env);
    if (item) {
      mediaItems.push(item);
      index++;
    }
  }

  // Handle documents (images/videos sent as files)
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

// Result type for GitHub operations with detailed errors
interface GitHubResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Try to get existing file from GitHub
async function getExistingFile(
  postId: string,
  isDraft: boolean,
  env: Env
): Promise<GitHubResult<GitHubFile>> {
  const [owner, repo] = env.GITHUB_REPO.split('/');
  const collection = isDraft ? 'drafts' : 'writing';
  const path = `src/content/${collection}/${postId}.md`;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'User-Agent': 'Telegram-Publisher-Worker',
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (response.status === 404) {
      return { success: true, data: undefined }; // File doesn't exist yet, that's fine
    }

    if (response.status === 401) {
      console.error('GitHub API: Authentication failed - token may be expired or invalid');
      return { success: false, error: 'GitHub token expired or invalid. Please update GITHUB_TOKEN secret.' };
    }

    if (response.status === 403) {
      const errorBody = await response.text();
      console.error(`GitHub API: Forbidden - ${errorBody}`);
      if (errorBody.includes('rate limit')) {
        return { success: false, error: 'GitHub API rate limit exceeded. Try again later.' };
      }
      return { success: false, error: 'GitHub access forbidden. Check token permissions.' };
    }

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`GitHub API error: ${response.status} - ${errorBody}`);
      return { success: false, error: `GitHub API error: ${response.status}` };
    }

    const data = await response.json() as { content: string; sha: string };
    // Decode base64 content
    const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { success: true, data: { content, sha: data.sha } };
  } catch (error) {
    console.error('Error fetching file from GitHub:', error);
    return { success: false, error: `Network error: ${error}` };
  }
}

// Commit file to GitHub (create or update)
async function commitToGitHub(
  content: string,
  postId: string,
  isDraft: boolean,
  sha: string | null,
  env: Env
): Promise<GitHubResult<void>> {
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

    if (sha) {
      body.sha = sha;
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Telegram-Publisher-Worker',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify(body),
      }
    );

    if (response.status === 401) {
      console.error('GitHub API: Authentication failed during commit');
      return { success: false, error: 'GitHub token expired or invalid. Please update GITHUB_TOKEN secret.' };
    }

    if (response.status === 403) {
      const errorBody = await response.text();
      console.error(`GitHub API: Forbidden during commit - ${errorBody}`);
      if (errorBody.includes('rate limit')) {
        return { success: false, error: 'GitHub API rate limit exceeded. Try again later.' };
      }
      return { success: false, error: 'GitHub access forbidden. Check token permissions (needs repo or contents:write scope).' };
    }

    if (response.status === 409) {
      console.error('GitHub API: Conflict - file was modified externally');
      return { success: false, error: 'File conflict - file was modified externally. Try again.' };
    }

    if (response.status === 422) {
      const errorBody = await response.text();
      console.error(`GitHub API: Unprocessable entity - ${errorBody}`);
      return { success: false, error: 'GitHub rejected the commit. Check file path and content.' };
    }

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`GitHub API error: ${response.status} - ${errorBody}`);
      return { success: false, error: `GitHub API error: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Error committing to GitHub:', error);
    return { success: false, error: `Network error: ${error}` };
  }
}

// Send a message back to the user via Telegram
async function sendTelegramMessage(chatId: number, text: string, env: Env): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

// ============================================
// Bluesky Cross-posting Functions
// ============================================

const BLUESKY_CHAR_LIMIT = 300;

// Get Bluesky API URL (supports custom PDS)
function getBlueskyApi(env: Env): string {
  return env.BLUESKY_PDS_URL || 'https://bsky.social/xrpc';
}

// Check if Bluesky is configured
function isBlueskyConfigured(env: Env): boolean {
  return !!(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
}

// Authenticate with Bluesky and get session tokens
async function createBlueskySession(env: Env): Promise<BlueskySession | null> {
  if (!isBlueskyConfigured(env)) {
    return null;
  }

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

// Upload an image blob to Bluesky
async function uploadBlueskyBlob(
  imageUrl: string,
  session: BlueskySession,
  env: Env
): Promise<BlueskyBlob | null> {
  const apiUrl = getBlueskyApi(env);
  try {
    // Fetch the image from R2 URL
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`Failed to fetch image: ${imageUrl}`);
      return null;
    }

    const imageData = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // Check size limit (1MB)
    if (imageData.byteLength > 1000000) {
      console.error('Image too large for Bluesky (>1MB)');
      return null;
    }

    // Upload to Bluesky
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

// Truncate text to fit Bluesky's character limit, adding link if needed
function truncateForBluesky(text: string, postUrl: string): string {
  // If no text, just return the URL
  if (!text.trim()) {
    return postUrl;
  }

  // If text fits, return it with the link
  const suffix = `\n\n${postUrl}`;

  if (text.length + suffix.length <= BLUESKY_CHAR_LIMIT) {
    return text + suffix;
  }

  // Truncate text to fit with ellipsis and link
  const maxTextLength = BLUESKY_CHAR_LIMIT - suffix.length - 3; // -3 for "..."
  const truncated = text.slice(0, maxTextLength).trim();
  return truncated + '...' + suffix;
}

// Get the URL for a stream post on the blog
function getPostUrl(postId: string): string {
  return `https://www.urcad.es/writing/${postId}`;
}

// Create a post on Bluesky
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

    // Build the post record
    const record: BlueskyPost = {
      $type: 'app.bsky.feed.post',
      text: truncatedText,
      createdAt: new Date().toISOString(),
    };

    // Upload images and add as embed (max 4, skip videos)
    const images = media.filter(m => m.type === 'image').slice(0, 4);
    if (images.length > 0) {
      const uploadedImages: Array<{ image: BlueskyBlob; alt: string }> = [];

      for (const img of images) {
        const blob = await uploadBlueskyBlob(img.url, session, env);
        if (blob) {
          uploadedImages.push({
            image: blob,
            alt: '', // Could be enhanced to include alt text
          });
        }
      }

      if (uploadedImages.length > 0) {
        record.embed = {
          $type: 'app.bsky.embed.images',
          images: uploadedImages,
        };
      }
    }

    // Create the post
    const response = await fetch(`${apiUrl}/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: record,
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

// Cross-post to Bluesky (called after successful GitHub commit)
async function crossPostToBluesky(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isBlueskyConfigured(env)) {
    return false; // Silently skip if not configured
  }

  const session = await createBlueskySession(env);
  if (!session) {
    console.error('Failed to create Bluesky session');
    return false;
  }

  return await postToBluesky(text, media, postId, session, env);
}

// ============================================
// Are.na Cross-posting Functions
// ============================================

const ARENA_API = 'https://api.are.na/v2';

// Check if Are.na is configured
function isArenaConfigured(env: Env): boolean {
  return !!(env.ARENA_ACCESS_TOKEN && env.ARENA_CHANNEL_SLUG);
}

// Create a block in an Are.na channel
async function createArenaBlock(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isArenaConfigured(env)) {
    return false; // Silently skip if not configured
  }

  try {
    const postUrl = getPostUrl(postId);
    const results: boolean[] = [];

    // If there are images, create image blocks with the source URL
    // Are.na will fetch and process the image
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
            body: JSON.stringify({
              source: item.url,
            }),
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

    // Create a text block with the content and link to the post
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
          body: JSON.stringify({
            content: content,
          }),
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

    // Return true if at least one block was created successfully
    return results.some(r => r === true);
  } catch (error) {
    console.error('Are.na post error:', error);
    return false;
  }
}

// Cross-post to Are.na (called after successful GitHub commit)
async function crossPostToArena(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isArenaConfigured(env)) {
    return false; // Silently skip if not configured
  }

  return await createArenaBlock(text, media, postId, env);
}

// ============================================
// GoToSocial Cross-posting Functions
// ============================================

interface GoToSocialMediaAttachment {
  id: string;
  type: string;
  url: string;
}

// Check if GoToSocial is configured
function isGoToSocialConfigured(env: Env): boolean {
  return !!(env.GOTOSOCIAL_URL && env.GOTOSOCIAL_ACCESS_TOKEN);
}

// Upload media to GoToSocial and return attachment ID
async function uploadGoToSocialMedia(
  mediaUrl: string,
  env: Env
): Promise<string | null> {
  try {
    // Fetch the media from R2 URL
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      console.error(`Failed to fetch media: ${mediaUrl}`);
      return null;
    }

    const mediaData = await mediaResponse.arrayBuffer();
    const contentType = mediaResponse.headers.get('content-type') || 'image/jpeg';

    // Extract filename from URL
    const filename = mediaUrl.split('/').pop() || 'media';

    // Create form data for upload
    const formData = new FormData();
    formData.append('file', new Blob([mediaData], { type: contentType }), filename);

    // Upload to GoToSocial
    const response = await fetch(`${env.GOTOSOCIAL_URL}/api/v1/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GOTOSOCIAL_ACCESS_TOKEN}`,
        'User-Agent': 'Telegram-Publisher-Worker',
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

// Create a status on GoToSocial
async function postToGoToSocial(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  try {
    const postUrl = getPostUrl(postId);

    // Build status text with link to blog post
    const statusText = text ? `${text}\n\n${postUrl}` : postUrl;

    // Upload media and collect IDs (images only, skip videos for now)
    const mediaIds: string[] = [];
    const images = media.filter(m => m.type === 'image').slice(0, 6); // GTS allows up to 6

    for (const img of images) {
      const mediaId = await uploadGoToSocialMedia(img.url, env);
      if (mediaId) {
        mediaIds.push(mediaId);
      }
    }

    // Create form data for status
    const formData = new FormData();
    formData.append('status', statusText);
    formData.append('visibility', 'public');

    // Add media IDs
    for (const id of mediaIds) {
      formData.append('media_ids[]', id);
    }

    // Create the status
    const response = await fetch(`${env.GOTOSOCIAL_URL}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GOTOSOCIAL_ACCESS_TOKEN}`,
        'User-Agent': 'Telegram-Publisher-Worker',
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

// Cross-post to GoToSocial (called after successful GitHub commit)
async function crossPostToGoToSocial(
  text: string,
  media: MediaItem[],
  postId: string,
  env: Env
): Promise<boolean> {
  if (!isGoToSocialConfigured(env)) {
    return false; // Silently skip if not configured
  }

  return await postToGoToSocial(text, media, postId, env);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Telegram Blog Publisher is running!', { status: 200 });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const update: TelegramUpdate = await request.json();

      // Only process messages
      if (!update.message) {
        return new Response('OK', { status: 200 });
      }

      const message = update.message;
      const userId = message.from.id;
      const chatId = message.chat.id;

      // Get message text (either text or caption for media)
      const messageText = message.text || message.caption || '';

      // Ignore empty messages without media
      if (!messageText && !message.photo && !message.video && !message.document) {
        return new Response('OK', { status: 200 });
      }

      // Check if user is whitelisted
      const whitelisted = isWhitelisted(userId, env.WHITELISTED_USERS);
      const isDraft = !whitelisted;

      // Get daily post ID
      const postId = getDailyPostId();

      // Process media
      const media = await processMedia(message, env);

      // Create the snippet for this message
      const snippet = createSnippet(messageText, media);

      // Check if today's post already exists
      const existingFileResult = await getExistingFile(postId, isDraft, env);

      // Handle GitHub fetch errors
      if (!existingFileResult.success) {
        await sendTelegramMessage(chatId, existingFileResult.error || 'Error checking existing file.', env);
        return new Response('OK', { status: 200 });
      }

      let finalContent: string;
      let sha: string | null = null;

      if (existingFileResult.data) {
        // Append to existing post
        finalContent = appendToPost(existingFileResult.data.content, snippet);
        sha = existingFileResult.data.sha;
      } else {
        // Create new daily post
        finalContent = createNewDailyPost(snippet);
      }

      // Commit to GitHub
      const commitResult = await commitToGitHub(finalContent, postId, isDraft, sha, env);

      // Send response to user
      if (commitResult.success) {
        const action = existingFileResult.data ? 'Added to' : 'Started';
        let status = isDraft
          ? `Saved as draft (user ${userId} not whitelisted)`
          : `${action} ${getFormattedDate()}`;

        // Cross-post to other platforms (only for published posts, not drafts)
        if (!isDraft) {
          // Bluesky
          if (isBlueskyConfigured(env)) {
            const blueskySuccess = await crossPostToBluesky(messageText, media, postId, env);
            if (blueskySuccess) {
              status += ' + Bluesky';
            } else {
              status += ' (Bluesky failed)';
            }
          }

          // Are.na
          if (isArenaConfigured(env)) {
            const arenaSuccess = await crossPostToArena(messageText, media, postId, env);
            if (arenaSuccess) {
              status += ' + Are.na';
            } else {
              status += ' (Are.na failed)';
            }
          }

          // GoToSocial
          if (isGoToSocialConfigured(env)) {
            const gtsSuccess = await crossPostToGoToSocial(messageText, media, postId, env);
            if (gtsSuccess) {
              status += ' + GoToSocial';
            } else {
              status += ' (GoToSocial failed)';
            }
          }
        }

        await sendTelegramMessage(chatId, status, env);
      } else {
        await sendTelegramMessage(chatId, commitResult.error || 'Error publishing. Please try again.', env);
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal error', { status: 500 });
    }
  },
};
