/**
 * Overland iOS location tracking handler
 * Receives GeoJSON location batches, stores latest city in KV
 */

import type { Env } from './index';

interface OverlandLocation {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat] — GeoJSON order
  };
  properties: {
    timestamp: string;
    altitude?: number;
    speed?: number;
    horizontal_accuracy?: number;
    battery_level?: number;
    battery_state?: string;
    wifi?: string;
  };
}

interface OverlandPayload {
  locations: OverlandLocation[];
  current?: OverlandLocation;
}

export interface StoredLocation {
  lat: number;
  lon: number;
  timestamp: string;
  city?: string;
  country?: string;
  updatedAt: string;
}

const KV_LOCATION_KEY = 'latest_location';

// Reverse geocode lat/lon to city name using Nominatim (free, no API key)
async function reverseGeocode(lat: number, lon: number): Promise<{ city?: string; country?: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'urcad.es personal site location tracker',
        'Accept-Language': 'en',
      },
    });

    if (!response.ok) return {};

    const data = await response.json() as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        country?: string;
      };
    };

    const addr = data.address;
    if (!addr) return {};

    return {
      city: addr.city || addr.town || addr.village,
      country: addr.country,
    };
  } catch {
    return {};
  }
}

// POST /api/location — receive Overland batch
export async function handleLocationPost(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Validate bearer token
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token || token !== env.OVERLAND_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: OverlandPayload;
  try {
    payload = await request.json() as OverlandPayload;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const locations = payload.locations ?? [];

  // Respond immediately — Overland will retry if it doesn't get {"result":"ok"} quickly
  if (locations.length === 0) {
    return new Response(JSON.stringify({ result: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sort by timestamp descending, take the most recent
  const sorted = [...locations].sort((a, b) =>
    new Date(b.properties.timestamp).getTime() - new Date(a.properties.timestamp).getTime()
  );
  const latest = sorted[0];
  const [lon, lat] = latest.geometry.coordinates;
  const timestamp = latest.properties.timestamp;

  // Reverse geocode and write to KV in the background (non-blocking)
  ctx.waitUntil((async () => {
    const geo = await reverseGeocode(lat, lon);
    const stored: StoredLocation = {
      lat,
      lon,
      timestamp,
      city: geo.city,
      country: geo.country,
      updatedAt: new Date().toISOString(),
    };
    await env.LOCATION_KV.put(KV_LOCATION_KEY, JSON.stringify(stored));
  })());

  return new Response(JSON.stringify({ result: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/location/current — read latest stored location
export async function handleLocationGet(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  const raw = await env.LOCATION_KV.get(KV_LOCATION_KEY);

  if (!raw) {
    return new Response(JSON.stringify({ error: 'No location data' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(raw, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
