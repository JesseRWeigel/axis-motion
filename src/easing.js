'use strict';
// Easing functions. Every easing here is a cubic Bezier with fixed
// endpoints P0=(0,0) and P3=(1,1), which is exactly what CSS
// `cubic-bezier()` and the Web Animations API both accept, so the same
// curve can be handed to either without translation.

const NAMED = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

class EasingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EasingError';
  }
}

function bezierComponent(t, a, b) {
  // B(t) for control points 0, a, b, 1.
  const mt = 1 - t;
  return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t;
}

function bezierDerivative(t, a, b) {
  const mt = 1 - t;
  return 3 * mt * mt * a + 6 * mt * t * (b - a) + 3 * t * t * (1 - b);
}

/**
 * Evaluate a cubic-bezier easing at progress x in [0,1].
 * Solves x(t) = x for t by Newton then bisection, then returns y(t).
 * Exact at the endpoints: 0 -> 0 and 1 -> 1, by definition of P0 and P3.
 */
function cubicBezier(x1, y1, x2, y2, x) {
  for (const [name, v] of [['x1', x1], ['x2', x2]]) {
    if (v < 0 || v > 1) {
      throw new EasingError(`cubic-bezier ${name} must be in [0,1], got ${v}`);
    }
  }
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x; // identity curve, linear

  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bezierComponent(t, x1, x2) - x;
    if (Math.abs(err) < 1e-9) return bezierComponent(t, y1, y2);
    const d = bezierDerivative(t, x1, x2);
    if (Math.abs(d) < 1e-9) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 60; i++) {
    const v = bezierComponent(t, x1, x2);
    if (Math.abs(v - x) < 1e-12) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bezierComponent(t, y1, y2);
}

/**
 * Parse an easing spec into { name, points:[x1,y1,x2,y2] }.
 * Accepts the five CSS keywords and cubic-bezier(a,b,c,d).
 */
function parseEasing(spec) {
  const s = String(spec).trim();
  if (Object.prototype.hasOwnProperty.call(NAMED, s)) {
    return { name: s, points: NAMED[s].slice() };
  }
  const m = /^cubic-bezier\(\s*([^)]*)\)$/.exec(s);
  if (!m) {
    throw new EasingError(
      `unknown easing "${s}". Allowed: ${Object.keys(NAMED).join(', ')}, cubic-bezier(x1,y1,x2,y2)`
    );
  }
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts.length !== 4) {
    throw new EasingError(`cubic-bezier needs 4 numbers, got ${parts.length}`);
  }
  const nums = parts.map((p) => {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(p)) {
      throw new EasingError(`cubic-bezier argument "${p}" is not a number`);
    }
    return Number(p);
  });
  if (nums[0] < 0 || nums[0] > 1 || nums[2] < 0 || nums[2] > 1) {
    throw new EasingError(
      `cubic-bezier x controls must be in [0,1], got ${nums[0]} and ${nums[2]}`
    );
  }
  return { name: `cubic-bezier(${nums.join(', ')})`, points: nums };
}

/** Evaluate a parsed easing at progress x. */
function ease(parsed, x) {
  const [x1, y1, x2, y2] = parsed.points;
  return cubicBezier(x1, y1, x2, y2, x);
}

/** The CSS / WAAPI string form of a parsed easing. */
function easingToCss(parsed) {
  const [x1, y1, x2, y2] = parsed.points;
  if (parsed.name in NAMED) return parsed.name;
  return `cubic-bezier(${num(x1)}, ${num(y1)}, ${num(x2)}, ${num(y2)})`;
}

function num(v) {
  // Stable, locale free formatting. Determinism depends on it.
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
}

module.exports = { cubicBezier, parseEasing, ease, easingToCss, NAMED, EasingError };
