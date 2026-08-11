export function noise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function jitter(seed, amount) {
  return (noise(seed) * 2 - 1) * amount;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function format(value) {
  return Math.round(value * 100) / 100;
}

export function midpoint(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}
