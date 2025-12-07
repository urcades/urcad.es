# Telegram Blog Publisher Setup Guide

Publish blog posts by messaging a Telegram bot. Supports text, images, and videos.

## Architecture

```
Telegram App → Your Bot → Cloudflare Worker → GitHub → Auto-deploy
                                ↓
                          Cloudflare R2 (media)
```

## Setup (5 minutes)

### Step 1: Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "My Blog Publisher")
4. Choose a username (must end in `bot`, e.g., `urcades_blog_bot`)
5. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)
3. Save this - you'll need it for the whitelist

### Step 3: Deploy the Worker

```bash
cd workers/sms-publisher
npm install

# Set your secrets
npx wrangler secret put GITHUB_TOKEN
# Paste your GitHub PAT

npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your bot token from BotFather

npx wrangler secret put WHITELISTED_USERS
# Paste your Telegram user ID (from step 2)

# Deploy
npm run deploy
```

Note the worker URL (e.g., `https://sms-publisher.your-subdomain.workers.dev`)

### Step 4: Connect Bot to Worker

Set the webhook by opening this URL in your browser (replace the values):

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://sms-publisher.<YOUR_SUBDOMAIN>.workers.dev
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

### Step 5: Test It!

1. Open Telegram and find your bot (search for the username you chose)
2. Send a message: `Hello world! My first stream post.`
3. You should get a reply: `Published! Post ID: 241205-143022`
4. Check your GitHub repo - a new file appears in `src/content/writing/`

## Usage

### Text Posts
Just send a message:
```
This is a quick thought I wanted to share.
```

### Posts with Images
Send a photo with a caption:
```
[attach photo]
Check out this sunset!
```

### Posts with Video
Send a video with a caption:
```
[attach video]
Quick demo of the new feature
```

## Configuration

### Bluesky Cross-posting (Optional)

Enable automatic cross-posting to Bluesky when you publish via Telegram.

#### Step 1: Create a Bluesky App Password

1. Log into [Bluesky](https://bsky.app)
2. Go to **Settings** → **Privacy and Security** → **App Passwords**
3. Click **Add App Password**
4. Name it (e.g., "Blog Publisher")
5. Copy the generated password (you won't see it again)

#### Step 2: Add Bluesky Secrets

```bash
cd workers/sms-publisher

npx wrangler secret put BLUESKY_HANDLE
# Enter your handle (e.g., yourname.bsky.social)

npx wrangler secret put BLUESKY_APP_PASSWORD
# Paste the app password from step 1
```

#### How It Works

- When you post via Telegram, it publishes to your blog AND Bluesky
- Text is truncated to 300 characters with a link to the full post
- Images are uploaded to Bluesky (max 4, videos are skipped)
- Telegram will show "Added to December 7 + Bluesky" on success

#### Limitations

- Bluesky has a 300-character limit (text is auto-truncated)
- Max 4 images per post, each under 1MB
- Videos are not cross-posted (Bluesky doesn't support video uploads via API yet)
- Only published posts are cross-posted (not drafts)

### Adding More Whitelisted Users

Update the secret with comma-separated user IDs:
```bash
npx wrangler secret put WHITELISTED_USERS
# Enter: 123456789,987654321
```

Non-whitelisted users' messages go to drafts.

### Custom Media Domain

The worker uploads media to R2 and references it via `https://media.urcad.es/`.

To set this up:
1. Go to Cloudflare Dashboard → R2 → `urcades` bucket
2. Settings → Custom Domains → Add `media.urcad.es`

## Costs

| Service | Cost |
|---------|------|
| Telegram Bot | **Free** |
| Cloudflare Workers | **Free** (100k req/day) |
| Cloudflare R2 | **Free** (up to 10GB) |
| **Total** | **$0/month** |

## Troubleshooting

### Bot not responding
- Check worker logs: `npm run tail`
- Verify webhook is set: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- Make sure TELEGRAM_BOT_TOKEN secret is set correctly

### Posts not appearing in GitHub
- Verify GITHUB_TOKEN has write access to the repo
- Check the worker logs for GitHub API errors

### Media not loading
- Ensure R2 bucket has a custom domain configured
- Verify the media URL is accessible: `https://media.urcad.es/stream/...`

### "Not whitelisted" message
- Get your user ID from @userinfobot
- Update WHITELISTED_USERS: `npx wrangler secret put WHITELISTED_USERS`

## Local Development

```bash
# Create .dev.vars from the example
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your values

# Start local server
npm run dev

# In another terminal, test with curl:
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{"message":{"from":{"id":123456789},"chat":{"id":123456789},"text":"Test post"}}'
```
