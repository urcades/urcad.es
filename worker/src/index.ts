/**
 * urcades — unified Cloudflare Worker
 *
 * Routes:
 *   POST /api/location          → Overland iOS location receiver
 *   GET  /api/location/current  → Latest stored location (city, coords)
 *   *                           → Static Astro site (dist/)
 */

import { handleLocationPost, handleLocationGet } from './location';

export interface Env {
  // Static assets binding (serves dist/)
  ASSETS: Fetcher;
  // KV namespace for latest location storage
  LOCATION_KV: KVNamespace;
  // Overland iOS location tracking
  OVERLAND_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    // --- API routes ---

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
