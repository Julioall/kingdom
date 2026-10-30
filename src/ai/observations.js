const ABSOLUTE_CALENDAR_TOKENS = new Set([
  'day', 'date', 'year', 'month', 'week', 'season', 'calendar', 'timestamp', 'datetime'
]);

const ABSOLUTE_TIMESTAMP_KEYS = new Set([
  'createdat', 'updatedat', 'observedat', 'reportedat', 'resolvedat', 'expiresat', 'startedat', 'endedat'
]);

function isAbsoluteCalendarKey(key) {
  const normalized = String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (ABSOLUTE_TIMESTAMP_KEYS.has(normalized.replaceAll('_', ''))) return true;
  return normalized.split(/[^a-z0-9]+/).some(token => ABSOLUTE_CALENDAR_TOKENS.has(token));
}

/** Remove absolute dates/seasons from prompt observations while preserving relative durations. */
export function stripAbsoluteCalendarFields(value) {
  if (Array.isArray(value)) return value.map(stripAbsoluteCalendarFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isAbsoluteCalendarKey(key))
    .map(([key, nested]) => [key, stripAbsoluteCalendarFields(nested)]));
}
