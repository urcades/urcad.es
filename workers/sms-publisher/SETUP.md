# SMS Publisher Setup Guide

This worker allows you to publish blog posts by texting a phone number.

## Architecture

```
Your Phone → SMS → Twilio → Cloudflare Worker → GitHub → Auto-deploy
                                    ↓
                              Cloudflare R2 (media)
```

## Prerequisites

- Cloudflare account with Workers enabled
- Twilio account
- GitHub Personal Access Token

## Step 1: Cloudflare R2 Setup

1. Go to Cloudflare Dashboard → R2
2. Create a bucket named `urcades`
3. Set up a custom domain for the bucket:
   - Add custom domain: `media.urcad.es`
   - This allows public access to uploaded media

## Step 2: Twilio Setup

1. Create a Twilio account at https://www.twilio.com
2. Buy a phone number with SMS/MMS capability (~$1.15/month)
3. Note your:
   - **Account SID** (found on dashboard)
   - **Auth Token** (found on dashboard, click to reveal)
   - **Phone Number** (the number you purchased)

## Step 3: GitHub Token

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
2. Create a new token with:
   - Repository access: `urcades/urcad.es`
   - Permissions: Contents (Read and Write)
3. Copy the token (you won't see it again)

## Step 4: Deploy the Worker

```bash
cd workers/sms-publisher

# Install dependencies
npm install

# Login to Cloudflare (if not already)
npx wrangler login

# Set secrets
npx wrangler secret put GITHUB_TOKEN
# Paste your GitHub token when prompted

npx wrangler secret put TWILIO_AUTH_TOKEN
# Paste your Twilio Auth Token when prompted

# Deploy
npm run deploy
```

The worker will be deployed to: `https://sms-publisher.<your-subdomain>.workers.dev`

## Step 5: Configure Twilio Webhook

1. Go to Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click on your phone number
3. Scroll to "Messaging Configuration"
4. Under "A message comes in":
   - Webhook URL: `https://sms-publisher.<your-subdomain>.workers.dev/sms`
   - Method: HTTP POST
5. Save

## Step 6: Test It!

Send a text message to your Twilio number:

```
Hello world! This is my first stream post.
```

You should receive a reply: `Post published! ID: 241203-143022`

Check your GitHub repo - a new file should appear in `src/content/writing/`.

## Configuration

### Whitelisted Numbers

Edit `wrangler.toml` to add/remove whitelisted phone numbers:

```toml
[vars]
WHITELISTED_NUMBERS = "5206099095,1234567890"
```

Or set as a secret for extra security:
```bash
npx wrangler secret put WHITELISTED_NUMBERS
```

Messages from non-whitelisted numbers are saved as drafts in `src/content/drafts/`.

### Custom R2 Bucket Name

If you use a different bucket name, update `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "urcades"
```

## Sending Media

The worker supports up to 4 media attachments per message:
- Images (jpg, png, gif, webp)
- Videos (mp4, mov, webm)

Media is automatically:
1. Downloaded from Twilio
2. Uploaded to R2
3. Embedded in the markdown post

## Costs

| Service | Monthly Cost |
|---------|--------------|
| Twilio Phone Number | ~$1.15 |
| Twilio SMS (incoming) | $0.0079/msg |
| Twilio MMS (incoming) | $0.02/msg |
| Cloudflare Workers | Free (100k req/day) |
| Cloudflare R2 | Free (up to 10GB) |

**Estimated total: $3-5/month** for typical personal use.

## Troubleshooting

### Posts not appearing
- Check the Worker logs: `npm run tail`
- Verify GitHub token has write permissions
- Ensure the webhook URL is correct in Twilio

### Media not loading
- Verify R2 bucket has public access via custom domain
- Check that `media.urcad.es` DNS is configured

### Wrong number
- Verify your phone number is in `WHITELISTED_NUMBERS`
- Phone numbers should be 10 digits (no country code, no dashes)

## Local Development

```bash
# Start local dev server
npm run dev

# Test with curl (simulating Twilio)
curl -X POST http://localhost:8787/sms \
  -d "From=+15206099095" \
  -d "Body=Test post from local dev" \
  -d "NumMedia=0" \
  -d "MessageSid=TEST123"
```
