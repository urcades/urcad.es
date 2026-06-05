#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  fetchLocaleContext,
  normalizeLocaleContext,
  previousPostDistance,
  withPreviousPostDistance,
} from './locale-context.mjs';
import { buildLocaleFooterRows } from '../src/lib/locale-footer.mjs';

function sampleContext(overrides = {}) {
  return {
    schemaVersion: 'locale.agent.v1',
    ok: true,
    asOf: '2026-06-05T18:14:23.000Z',
    freshness: {
      status: 'fresh',
      sampleAgeSeconds: 38,
    },
    where: {
      latitude: 40.672,
      longitude: -73.957,
      timestamp: '2026-06-05T18:14:22.000Z',
      ageSeconds: 38,
      quality: 'good',
      altitudeMeters: 9.75,
    },
    adminContext: {
      status: 'matched',
      neighborhood: 'Brooklyn',
      borough: 'Brooklyn',
    },
    place: {
      label: 'Home',
      category: 'residential',
      match: 'inside',
    },
    movement: {
      state: 'stationary',
    },
    posture: {
      posture: 'faceUp',
      unavailableReason: null,
    },
    latestSample: {
      visitArrivalDate: '2026-06-05T17:27:00.000Z',
      visitDepartureDate: null,
    },
    ...overrides,
  };
}

function testNormalizeFreshContext() {
  const locale = normalizeLocaleContext(sampleContext(), {
    now: new Date('2026-06-05T18:14:22.000Z'),
    timeZone: 'America/New_York',
  });

  assert.deepEqual(locale, {
    capturedAt: '2026-06-05T18:14:22.000Z',
    localTime: '2:14 PM EDT',
    place: {
      neighborhood: 'Brooklyn',
      namedPlace: 'Home',
      category: 'residential',
      altitude: '32 ft',
    },
    context: {
      motion: 'stationary',
      posture: 'face up',
      freshness: '38s',
    },
    dwell: 'about 47m',
    position: {
      latitude: 40.672,
      longitude: -73.957,
    },
  });
}

function testRejectsStaleAndHiddenContext() {
  assert.equal(normalizeLocaleContext(sampleContext({
    freshness: { status: 'old', sampleAgeSeconds: 2000 },
  })), null);

  assert.equal(normalizeLocaleContext(sampleContext({
    where: {
      ...sampleContext().where,
      latitude: null,
      longitude: null,
    },
  })), null);

  assert.equal(normalizeLocaleContext(sampleContext({
    where: {
      ...sampleContext().where,
      quality: 'stale',
    },
  })), null);
}

function testPreviousPostDistanceLabels() {
  const current = { latitude: 40.672, longitude: -73.957 };

  assert.deepEqual(
    previousPostDistance(current, { latitude: 40.6721, longitude: -73.9571 }),
    { label: 'same place', distance: '0.0 mi' },
  );

  assert.deepEqual(
    previousPostDistance(current, { latitude: 40.6604, longitude: -73.957 }),
    { label: '0.8 mi away', distance: '0.8 mi' },
  );
}

function testPreviousPostAttachment() {
  const locale = normalizeLocaleContext(sampleContext());
  const withDistance = withPreviousPostDistance(locale, { latitude: 40.6604, longitude: -73.957 });

  assert.equal(withDistance.previousPost.label, '0.8 mi away');
  assert.equal(withDistance.previousPost.distance, '0.8 mi');
}

function testFooterRowsOmitMissingFields() {
  assert.deepEqual(buildLocaleFooterRows(null), []);
  assert.deepEqual(buildLocaleFooterRows({ position: { latitude: 1, longitude: 2 } }), []);

  const rows = buildLocaleFooterRows({
    place: {
      neighborhood: 'Brooklyn',
      namedPlace: 'Home',
      category: 'residential',
      altitude: '32 ft',
    },
    context: {
      motion: 'stationary',
      posture: 'face up',
      freshness: '38s',
    },
    dwell: 'about 47m',
    localTime: '2:14 PM EDT',
    previousPost: {
      label: 'same place',
      distance: '0.0 mi',
    },
    position: {
      latitude: 40.672,
      longitude: -73.957,
    },
  });

  assert.deepEqual(rows, [
    { label: 'Place', value: 'Brooklyn · Home · residential · 32 ft' },
    { label: 'Context', value: 'stationary · face up · fresh 38s' },
    { label: 'Dwell', value: 'about 47m' },
    { label: 'Local time', value: '2:14 PM EDT' },
    { label: 'Previous post', value: 'same place' },
  ]);
}

async function testFetchFallsBackToPrimaryReceiverName() {
  const calls = [];
  const locale = await fetchLocaleContext({
    env: {},
    timeZone: 'America/New_York',
    fetchImpl: async (url) => {
      calls.push(url.toString());
      if (calls.length === 1) {
        throw new Error('localhost unavailable');
      }

      return {
        ok: true,
        async json() {
          return sampleContext();
        },
      };
    },
  });

  assert.deepEqual(calls, [
    'http://127.0.0.1:8765/agent-context?limit=500',
    'http://violaceae-1:8765/agent-context?limit=500',
  ]);
  assert.equal(locale.place.namedPlace, 'Home');
}

async function testConfiguredReceiverUrlOverridesFallbacks() {
  const calls = [];
  await fetchLocaleContext({
    env: {
      LOCALE_CONTEXT_RECEIVER_URL: 'http://configured.example:8765',
    },
    fetchImpl: async (url) => {
      calls.push(url.toString());
      throw new Error('configured unavailable');
    },
  });

  assert.deepEqual(calls, [
    'http://configured.example:8765/agent-context?limit=500',
  ]);
}

testNormalizeFreshContext();
testRejectsStaleAndHiddenContext();
testPreviousPostDistanceLabels();
testPreviousPostAttachment();
testFooterRowsOmitMissingFields();
await testFetchFallsBackToPrimaryReceiverName();
await testConfiguredReceiverUrlOverridesFallbacks();

console.log('locale-context tests passed');
