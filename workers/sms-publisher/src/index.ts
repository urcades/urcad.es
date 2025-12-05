/**
 * Telegram Blog Publisher Cloudflare Worker
 * Receives messages from Telegram bot and publishes to the blog
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
  alt?: string;
}

// Generate a post ID based on current timestamp
function generatePostId(): string {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const hh = now.getHours().toString().padStart(2, '0');
  const min = now.getMinutes().toString().padStart(2, '0');
  const ss = now.getSeconds().toString().padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}${ss}`;
}

// Check if user ID is whitelisted
function isWhitelisted(userId: number, whitelist: string): boolean {
  const whitelistedIds = whitelist.split(',').map(id => id.trim());
  return whitelistedIds.includes(userId.toString());
}

// Get file from Telegram and upload to R2
async function downloadAndUploadMedia(
  fileId: string,
  postId: string,
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
    const filename = `${postId}-${index}.${extension}`;
    const r2Key = `stream/${postId}/${filename}`;

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
  postId: string,
  env: Env
): Promise<MediaItem[]> {
  const mediaItems: MediaItem[] = [];
  let index = 0;

  // Handle photos (Telegram sends multiple sizes, we want the largest)
  if (message.photo && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    const item = await downloadAndUploadMedia(largestPhoto.file_id, postId, index, 'image', env);
    if (item) {
      mediaItems.push(item);
      index++;
    }
  }

  // Handle video
  if (message.video) {
    const item = await downloadAndUploadMedia(message.video.file_id, postId, index, 'video', env);
    if (item) {
      mediaItems.push(item);
      index++;
    }
  }

  // Handle documents (images/videos sent as files)
  if (message.document) {
    const mimeType = message.document.mime_type || '';
    if (mimeType.startsWith('image/')) {
      const item = await downloadAndUploadMedia(message.document.file_id, postId, index, 'image', env);
      if (item) mediaItems.push(item);
    } else if (mimeType.startsWith('video/')) {
      const item = await downloadAndUploadMedia(message.document.file_id, postId, index, 'video', env);
      if (item) mediaItems.push(item);
    }
  }

  return mediaItems;
}

// Create markdown content for the post
function createMarkdownContent(
  body: string,
  media: MediaItem[],
  isDraft: boolean
): string {
  const now = new Date().toISOString();

  // Generate title from first line or truncate body
  const firstLine = body.split('\n')[0].trim();
  const title = firstLine.length > 60
    ? firstLine.substring(0, 57) + '...'
    : firstLine || 'Stream Post';

  // Build frontmatter
  const frontmatterYaml = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `pubDate: ${now}`,
    `description: "${(body.length > 160 ? body.substring(0, 157) + '...' : body).replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
    `tags: ["stream"]`,
    `source: "telegram"`,
  ];

  if (media.length > 0) {
    frontmatterYaml.push('media:');
    media.forEach(m => {
      frontmatterYaml.push(`  - url: "${m.url}"`);
      frontmatterYaml.push(`    type: "${m.type}"`);
    });
  }

  frontmatterYaml.push('---');

  // Build content body with media embeds
  let content = body;

  if (media.length > 0) {
    content += '\n\n';
    media.forEach(m => {
      if (m.type === 'video') {
        content += `<video src="${m.url}" controls style="max-width: 100%;"></video>\n`;
      } else {
        content += `![](${m.url})\n`;
      }
    });
  }

  return frontmatterYaml.join('\n') + '\n\n' + content;
}

// Commit file to GitHub
async function commitToGitHub(
  content: string,
  postId: string,
  isDraft: boolean,
  env: Env
): Promise<boolean> {
  const [owner, repo] = env.GITHUB_REPO.split('/');
  const collection = isDraft ? 'drafts' : 'writing';
  const path = `src/content/${collection}/${postId}.md`;

  try {
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
        body: JSON.stringify({
          message: `${isDraft ? '[Draft] ' : ''}Stream post via Telegram: ${postId}`,
          content: btoa(unescape(encodeURIComponent(content))),
          branch: 'main',
        }),
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
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
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

      // Generate post ID
      const postId = generatePostId();

      // Process media
      const media = await processMedia(message, postId, env);

      // Create markdown content
      const markdownContent = createMarkdownContent(messageText, media, isDraft);

      // Commit to GitHub
      const success = await commitToGitHub(markdownContent, postId, isDraft, env);

      // Send response to user
      if (success) {
        const status = isDraft
          ? `Saved as draft (user ${userId} not whitelisted)`
          : 'Published!';
        await sendTelegramMessage(chatId, `${status}\nPost ID: ${postId}`, env);
      } else {
        await sendTelegramMessage(chatId, 'Error publishing post. Please try again.', env);
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal error', { status: 500 });
    }
  },
};
