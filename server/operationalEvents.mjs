const MAX_OPERATIONAL_EVENTS = 100;
const MAX_TEXT_LENGTH = 240;

const state = globalThis.__ATOMFOLIO_OPERATIONAL_EVENTS__ ?? {
  startedAt: new Date().toISOString(),
  events: [],
};

globalThis.__ATOMFOLIO_OPERATIONAL_EVENTS__ = state;

function cleanText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata)
      .slice(0, 12)
      .map(([key, value]) => [cleanText(key, 'key').slice(0, 60), cleanText(value)]),
  );
}

export function recordOperationalEvent({
  level = 'info',
  area = 'app',
  code = 'event',
  message = '',
  metadata = {},
} = {}) {
  const event = {
    at: new Date().toISOString(),
    level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    area: cleanText(area, 'app').slice(0, 80),
    code: cleanText(code, 'event').slice(0, 80),
    message: cleanText(message),
    metadata: cleanMetadata(metadata),
  };

  state.events.push(event);
  if (state.events.length > MAX_OPERATIONAL_EVENTS) {
    state.events.splice(0, state.events.length - MAX_OPERATIONAL_EVENTS);
  }

  return event;
}

export function getOperationalEventStats({ includeRecent = false } = {}) {
  const countsByLevel = {};
  const countsByCode = {};

  state.events.forEach((event) => {
    countsByLevel[event.level] = (countsByLevel[event.level] ?? 0) + 1;
    countsByCode[event.code] = (countsByCode[event.code] ?? 0) + 1;
  });

  return {
    startedAt: state.startedAt,
    retainedEventCount: state.events.length,
    countsByLevel,
    countsByCode,
    ...(includeRecent ? { recent: state.events.slice(-20) } : {}),
  };
}
