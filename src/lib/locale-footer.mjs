function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function joinParts(parts) {
  return parts.map(text).filter(Boolean).join(' · ');
}

export function buildLocaleFooterRows(locale) {
  if (!locale || typeof locale !== 'object') return [];

  const rows = [];
  const place = locale.place && typeof locale.place === 'object' ? locale.place : {};
  const context = locale.context && typeof locale.context === 'object' ? locale.context : {};
  const previousPost = locale.previousPost && typeof locale.previousPost === 'object'
    ? locale.previousPost
    : {};

  const placeValue = joinParts([
    place.neighborhood,
    place.namedPlace,
    place.category,
    place.altitude,
  ]);
  if (placeValue) rows.push({ label: 'Place', value: placeValue });

  const contextValue = joinParts([
    context.motion,
    context.posture,
    context.freshness ? `fresh ${context.freshness}` : null,
  ]);
  if (contextValue) rows.push({ label: 'Context', value: contextValue });

  const dwell = text(locale.dwell);
  if (dwell) rows.push({ label: 'Dwell', value: dwell });

  const localTime = text(locale.localTime);
  if (localTime) rows.push({ label: 'Local time', value: localTime });

  const previousLabel = text(previousPost.label);
  if (previousLabel) rows.push({ label: 'Previous post', value: previousLabel });

  return rows;
}
