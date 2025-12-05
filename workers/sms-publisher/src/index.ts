/**
 * SMS Publisher Cloudflare Worker
 * Receives SMS/MMS from Twilio and publishes to the blog
 */

export interface Env {
  // R2 bucket for media storage
  MEDIA_BUCKET: R2Bucket;
  // GitHub Personal Access Token
  GITHUB_TOKEN: string;
  // GitHub repo in format "owner/repo"
  GITHUB_REPO: string;
  // Twilio Auth Token for webhook validation
  TWILIO_AUTH_TOKEN: string;
  // Comma-separated list of whitelisted phone numbers
  WHITELISTED_NUMBERS: string;
}

interface TwilioWebhookPayload {
  From: string;
  Body: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaUrl1?: string;
  MediaUrl2?: string;
  MediaUrl3?: string;
  MediaContentType0?: string;
  MediaContentType1?: string;
  MediaContentType2?: string;
  MediaContentType3?: string;
  MessageSid: string;
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

// Normalize phone number for comparison
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

// Check if phone number is whitelisted
function isWhitelisted(from: string, whitelist: string): boolean {
  const normalizedFrom = normalizePhone(from);
  const whitelistedNumbers = whitelist.split(',').map(n => normalizePhone(n.trim()));
  return whitelistedNumbers.includes(normalizedFrom);
}

// Determine media type from content type
function getMediaType(contentType: string): 'image' | 'video' {
  if (contentType.startsWith('video/')) return 'video';
  return 'image';
}

// Download media from Twilio and upload to R2
async function processMedia(
  mediaUrls: { url: string; contentType: string }[],
  postId: string,
  env: Env
): Promise<MediaItem[]> {
  const mediaItems: MediaItem[] = [];

  for (let i = 0; i < mediaUrls.length; i++) {
    const { url, contentType } = mediaUrls[i];

    try {
      // Fetch media from Twilio (requires auth)
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Basic ' + btoa(`${env.GITHUB_REPO.split('/')[0]}:${env.TWILIO_AUTH_TOKEN}`)
        }
      });

      if (!response.ok) {
        console.error(`Failed to fetch media: ${response.status}`);
        continue;
      }

      const mediaBuffer = await response.arrayBuffer();
      const extension = contentType.split('/')[1]?.split(';')[0] || 'bin';
      const filename = `${postId}-${i}.${extension}`;
      const r2Key = `stream/${postId}/${filename}`;

      // Upload to R2
      await env.MEDIA_BUCKET.put(r2Key, mediaBuffer, {
        httpMetadata: { contentType }
      });

      const mediaType = getMediaType(contentType);
      mediaItems.push({
        url: `https://media.urcad.es/${r2Key}`,
        type: mediaType,
      });
    } catch (error) {
      console.error(`Error processing media ${i}:`, error);
    }
  }

  return mediaItems;
}

// Create markdown content for the post
function createMarkdownContent(
  body: string,
  media: MediaItem[],
  isDraft: boolean,
  postId: string
): string {
  const now = new Date().toISOString();

  // Generate title from first line or truncate body
  const firstLine = body.split('\n')[0].trim();
  const title = firstLine.length > 60
    ? firstLine.substring(0, 57) + '...'
    : firstLine || 'Stream Post';

  // Build frontmatter
  const frontmatter = {
    title,
    pubDate: now,
    description: body.length > 160 ? body.substring(0, 157) + '...' : body,
    tags: ['stream'],
    source: 'sms',
    ...(media.length > 0 && { media }),
  };

  const frontmatterYaml = [
    '---',
    `title: "${frontmatter.title.replace(/"/g, '\\"')}"`,
    `pubDate: ${frontmatter.pubDate}`,
    `description: "${frontmatter.description.replace(/"/g, '\\"')}"`,
    `tags: [${frontmatter.tags.map(t => `"${t}"`).join(', ')}]`,
    `source: "${frontmatter.source}"`,
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
    // Create file via GitHub API
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SMS-Publisher-Worker',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          message: `${isDraft ? '[Draft] ' : ''}Stream post via SMS: ${postId}`,
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

// Generate TwiML response
function twimlResponse(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message}</Message>
</Response>`;

  return new Response(twiml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Only accept POST requests to /sms
    const url = new URL(request.url);

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (url.pathname !== '/sms' && url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }

    try {
      // Parse form data from Twilio
      const formData = await request.formData();
      const payload: TwilioWebhookPayload = {
        From: formData.get('From') as string || '',
        Body: formData.get('Body') as string || '',
        NumMedia: formData.get('NumMedia') as string || '0',
        MediaUrl0: formData.get('MediaUrl0') as string || undefined,
        MediaUrl1: formData.get('MediaUrl1') as string || undefined,
        MediaUrl2: formData.get('MediaUrl2') as string || undefined,
        MediaUrl3: formData.get('MediaUrl3') as string || undefined,
        MediaContentType0: formData.get('MediaContentType0') as string || undefined,
        MediaContentType1: formData.get('MediaContentType1') as string || undefined,
        MediaContentType2: formData.get('MediaContentType2') as string || undefined,
        MediaContentType3: formData.get('MediaContentType3') as string || undefined,
        MessageSid: formData.get('MessageSid') as string || '',
      };

      // Check if sender is whitelisted
      const whitelisted = isWhitelisted(payload.From, env.WHITELISTED_NUMBERS);
      const isDraft = !whitelisted;

      // Generate post ID
      const postId = generatePostId();

      // Collect media URLs
      const numMedia = parseInt(payload.NumMedia, 10);
      const mediaUrls: { url: string; contentType: string }[] = [];

      for (let i = 0; i < numMedia && i < 4; i++) {
        const mediaUrl = payload[`MediaUrl${i}` as keyof TwilioWebhookPayload] as string;
        const contentType = payload[`MediaContentType${i}` as keyof TwilioWebhookPayload] as string;
        if (mediaUrl && contentType) {
          mediaUrls.push({ url: mediaUrl, contentType });
        }
      }

      // Process media (upload to R2)
      const media = await processMedia(mediaUrls, postId, env);

      // Create markdown content
      const markdownContent = createMarkdownContent(payload.Body, media, isDraft, postId);

      // Commit to GitHub
      const success = await commitToGitHub(markdownContent, postId, isDraft, env);

      if (success) {
        const status = isDraft ? 'saved as draft' : 'published';
        return twimlResponse(`Post ${status}! ID: ${postId}`);
      } else {
        return twimlResponse('Error publishing post. Please try again.');
      }
    } catch (error) {
      console.error('Worker error:', error);
      return twimlResponse('Something went wrong. Please try again.');
    }
  },
};
