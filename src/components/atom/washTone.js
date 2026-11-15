import { clamp } from '../../utils/math.js';

export function parseLabelReturn(detail) {
  const numeric = Number.parseFloat(String(detail ?? '').replace(/[,%\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

// Watercolor wash inside each hand-drawn electron: red for gains, blue for losses (Korean market
// convention), stronger for bigger moves. Flat ink for ~0%.
// strength: 0..1, eased (sqrt) so a 10% move already reads clearly and 40%+ is fully saturated.
// glow: 0..1 halo intensity, zero below a ~3% move so small wiggles stay plain paint.
export function resolveWashTone(atomOrReturn) {
  const value =
    typeof atomOrReturn === 'number'
      ? atomOrReturn
      : Number.isFinite(atomOrReturn?.returnRate)
        ? atomOrReturn.returnRate
        : parseLabelReturn(atomOrReturn?.detail);
  // Every electron gets paint: unknown or ~0% returns get a faint ink wash instead of nothing,
  // so an unpainted electron never reads as "missing".
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 0.05) {
    return { className: 'node-wash is-flat', strength: 0, glow: 0, direction: 0 };
  }
  const linear = Math.min(1, Math.abs(value) / 40);
  return {
    className: value > 0 ? 'node-wash is-up' : 'node-wash is-down',
    strength: Math.sqrt(linear),
    glow: clamp((Math.abs(value) - 3) / 37, 0, 1) ** 0.75,
    direction: value > 0 ? 1 : -1,
  };
}
