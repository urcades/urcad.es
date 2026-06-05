const DEFAULT_RECEIVER_URLS = [
  'http://127.0.0.1:8765',
  'http://violaceae-1:8765',
];
const DEFAULT_TIMEOUT_MS = 5000;
const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function humanizeIdentifier(value) {
  const text = nonEmptyString(value);
  if (!text) return null;

  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function formatAltitude(meters) {
  const value = finiteNumber(meters);
  if (value === null) return null;
  return `${Math.round(value * FEET_PER_METER)} ft`;
}

export function formatFreshness(seconds) {
  const value = finiteNumber(seconds);
  if (value === null || value < 0) return null;
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  return `${Math.round(value / 3600)}h`;
}

export function formatDwell(seconds) {
  const value = finiteNumber(seconds);
  if (value === null || value < 0) return null;
  if (value < 60) return `about ${Math.round(value)}s`;
  if (value < 3600) return `about ${Math.round(value / 60)}m`;

  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  return minutes ? `about ${hours}h ${minutes}m` : `about ${hours}h`;
}

function formatLocalTime(date, timeZone) {
  try {
    const options = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    };
    if (timeZone) options.timeZone = timeZone;
    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch {
    return null;
  }
}

function parseDate(value) {
  const text = nonEmptyString(value);
  if (!text) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDwellSeconds(context, now) {
  const sample = context.latestSample && typeof context.latestSample === 'object'
    ? context.latestSample
    : {};
  const tracker = context.trackerStatus && typeof context.trackerStatus === 'object'
    ? context.trackerStatus
    : {};

  const arrival = parseDate(sample.visitArrivalDate) || parseDate(tracker.lastVisitArrivalAt);
  if (!arrival) return null;

  const departure = parseDate(sample.visitDepartureDate) || parseDate(tracker.lastVisitDepartureAt);
  if (departure && departure > arrival) return null;

  return (now.getTime() - arrival.getTime()) / 1000;
}

function getPosition(where) {
  const latitude = finiteNumber(where.latitude);
  const longitude = finiteNumber(where.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function isUsableFreshContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return false;
  if (context.schemaVersion !== 'locale.agent.v1' || context.ok !== true) return false;
  if (context.freshness?.status !== 'fresh') return false;

  const where = context.where && typeof context.where === 'object' ? context.where : null;
  if (!where) return false;
  if (!parseDate(where.timestamp)) return false;
  if (where.quality === 'stale' || where.quality === 'old') return false;
  if (!getPosition(where)) return false;

  return true;
}

export function normalizeLocaleContext(context, options = {}) {
  if (!isUsableFreshContext(context)) return null;

  const timeZone = nonEmptyString(options.timeZone);
  const where = context.where;
  const capturedAt = parseDate(where.timestamp);
  const now = options.now instanceof Date
    ? options.now
    : parseDate(context.asOf) || capturedAt;
  const admin = context.adminContext && typeof context.adminContext === 'object'
    ? context.adminContext
    : {};
  const place = context.place && typeof context.place === 'object' ? context.place : {};
  const posture = context.posture && typeof context.posture === 'object' ? context.posture : {};
  const movement = context.movement && typeof context.movement === 'object' ? context.movement : {};

  const motion = humanizeIdentifier(movement.state)
    || humanizeIdentifier(Array.isArray(context.latestSample?.motion) ? context.latestSample.motion[0] : null);
  const postureLabel = posture.unavailableReason ? null : humanizeIdentifier(posture.posture);
  const dwell = formatDwell(getDwellSeconds(context, now));

  return pruneEmpty({
    capturedAt: capturedAt.toISOString(),
    localTime: formatLocalTime(capturedAt, timeZone),
    place: {
      neighborhood: admin.status === 'matched'
        ? nonEmptyString(admin.neighborhood) || nonEmptyString(admin.borough)
        : null,
      namedPlace: place.match && place.match !== 'unknown' ? nonEmptyString(place.label) : null,
      category: humanizeIdentifier(place.category),
      altitude: formatAltitude(where.altitudeMeters),
    },
    context: {
      motion,
      posture: postureLabel,
      freshness: formatFreshness(context.freshness?.sampleAgeSeconds ?? where.ageSeconds),
    },
    dwell,
    position: getPosition(where),
  });
}

export function distanceMiles(from, to) {
  if (!from || !to) return null;

  const lat1 = finiteNumber(from.latitude);
  const lon1 = finiteNumber(from.longitude);
  const lat2 = finiteNumber(to.latitude);
  const lon2 = finiteNumber(to.longitude);
  if ([lat1, lon1, lat2, lon2].some(value => value === null)) return null;

  const toRadians = value => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371008.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const meters = 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return meters / METERS_PER_MILE;
}

export function previousPostDistance(currentPosition, previousPosition) {
  const miles = distanceMiles(currentPosition, previousPosition);
  if (miles === null) return null;
  if (miles < 0.1) {
    return { label: 'same place', distance: '0.0 mi' };
  }

  const distance = `${miles.toFixed(1)} mi`;
  return { label: `${distance} away`, distance };
}

export function withPreviousPostDistance(locale, previousPosition) {
  if (!locale?.position || !previousPosition) return locale;

  const previousPost = previousPostDistance(locale.position, previousPosition);
  if (!previousPost) return locale;

  return {
    ...locale,
    previousPost,
  };
}

export async function fetchLocaleContext(options = {}) {
  const env = options.env || process.env;
  const configuredReceiverUrl = nonEmptyString(options.receiverUrl)
    || nonEmptyString(env.LOCALE_CONTEXT_RECEIVER_URL);
  const receiverUrls = configuredReceiverUrl ? [configuredReceiverUrl] : DEFAULT_RECEIVER_URLS;
  const token = nonEmptyString(options.token) || nonEmptyString(env.LOCALE_CONTEXT_RECEIVER_TOKEN);
  const timeoutMs = finiteNumber(options.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  for (const receiverUrl of receiverUrls) {
    let url;
    try {
      url = new URL('/agent-context', receiverUrl);
      url.searchParams.set('limit', '500');
    } catch {
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!response.ok) continue;

      const context = await response.json();
      const locale = normalizeLocaleContext(context, options);
      if (locale) return locale;
    } catch {
      // Try the next configured/default receiver before giving up.
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter(item => item !== undefined);
    return items.length ? items : undefined;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, pruneEmpty(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (value === null || value === undefined || value === '') return undefined;
  return value;
}
