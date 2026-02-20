/**
 * urcades — unified Cloudflare Worker
 *
 * Routes:
 *   POST /api/telegram          → Telegram bot webhook (blog publishing)
 *   POST /api/location          → Overland iOS location receiver
 *   GET  /api/location/current  → Latest stored location (city, coords)
 *   *                           → Static Astro site (dist/)
 */

import { handleTelegram } from './telegram';
import { handleLocationPost, handleLocationGet } from './location';

export interface Env {
  // Static assets binding (serves dist/)
  ASSETS: Fetcher;
  // KV namespace for latest location storage
  LOCATION_KV: KVNamespace;
  // R2 bucket for media storage
  MEDIA_BUCKET: R2Bucket;
  // GitHub
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  WHITELISTED_USERS: string;
  // Overland iOS location tracking
  OVERLAND_TOKEN: string;
  // Bluesky cross-posting (optional)
  BLUESKY_HANDLE?: string;
  BLUESKY_APP_PASSWORD?: string;
  BLUESKY_PDS_URL?: string;
  // Are.na cross-posting (optional)
  ARENA_ACCESS_TOKEN?: string;
  ARENA_CHANNEL_SLUG?: string;
  // GoToSocial cross-posting (optional)
  GOTOSOCIAL_URL?: string;
  GOTOSOCIAL_ACCESS_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    // --- API routes ---

    if (pathname === '/api/telegram') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleTelegram(request, env, ctx);
    }

    if (pathname === '/api/location') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleLocationPost(request, env, ctx);
    }

    if (pathname === '/api/location/current') {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return handleLocationGet(request, env, ctx);
    }

    // --- Fallthrough: serve static Astro build ---
    return env.ASSETS.fetch(request);
  },
};
