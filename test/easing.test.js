'use strict';
// Easing correctness against values that do not come from this code.
//
// The cubic-bezier reference points below were computed from the closed form
// B(t) = 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 with the parameter t solved by
// hand for the cases where it is exact, and cross checked against the CSS
// specification's stated behaviour at the endpoints.

const test = require('node:test');
const assert = require('node:assert/strict');
const { cubicBezier, parseEasing, ease, easingToCss, NAMED, EasingError } = require('../src/easing');

test('every named easing is 0 at t=0 and 1 at t=1', () => {
  for (const name of Object.keys(NAMED)) {
    const e = parseEasing(name);
    assert.equal(ease(e, 0), 0, `${name} at 0`);
    assert.equal(ease(e, 1), 1, `${name} at 1`);
  }
});

test('an arbitrary cubic-bezier is 0 at t=0 and 1 at t=1', () => {
  for (const spec of [
    'cubic-bezier(0.4, 0, 0.2, 1)',
    'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
    'cubic-bezier(1, 0, 0, 1)',
    'cubic-bezier(0, 0.9, 1, 0.1)',
  ]) {
    const e = parseEasing(spec);
    assert.equal(ease(e, 0), 0, `${spec} at 0`);
    assert.equal(ease(e, 1), 1, `${spec} at 1`);
  }
});

test('linear easing produces evenly spaced samples', () => {
  const e = parseEasing('linear');
  const n = 20;
  const samples = [];
  for (let i = 0; i <= n; i++) samples.push(ease(e, i / n));
  for (let i = 0; i <= n; i++) {
    assert.ok(
      Math.abs(samples[i] - i / n) < 1e-12,
      `linear sample ${i} was ${samples[i]}, expected ${i / n}`
    );
  }
  const gaps = [];
  for (let i = 1; i <= n; i++) gaps.push(samples[i] - samples[i - 1]);
  const first = gaps[0];
  for (const g of gaps) {
    assert.ok(Math.abs(g - first) < 1e-12, `gap ${g} differs from ${first}`);
  }
  assert.ok(Math.abs(first - 1 / n) < 1e-12);
});

test('a symmetric easing is symmetric about the midpoint', () => {
  // ease-in-out uses control points (0.42,0) and (0.58,1), which are
  // point-symmetric about (0.5,0.5), so f(x) + f(1-x) must equal 1.
  const e = parseEasing('ease-in-out');
  for (const x of [0.1, 0.25, 0.3, 0.5, 0.75, 0.9]) {
    assert.ok(
      Math.abs(ease(e, x) + ease(e, 1 - x) - 1) < 1e-9,
      `ease-in-out not symmetric at ${x}: ${ease(e, x)} and ${ease(e, 1 - x)}`
    );
  }
  assert.ok(Math.abs(ease(e, 0.5) - 0.5) < 1e-9, 'ease-in-out midpoint should be 0.5');
});

test('monotone easings are monotone across 1000 samples', () => {
  // These four have both y controls inside [0,1], so y(t) is non decreasing.
  for (const spec of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.4, 0, 0.2, 1)']) {
    const e = parseEasing(spec);
    let prev = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const y = ease(e, i / 1000);
      assert.ok(y >= prev - 1e-12, `${spec} decreased at ${i / 1000}: ${y} after ${prev}`);
      assert.ok(y >= -1e-12 && y <= 1 + 1e-12, `${spec} left [0,1] at ${i / 1000}: ${y}`);
      prev = y;
    }
  }
});

test('an overshooting easing does leave [0,1], which is correct', () => {
  // The check above must not be vacuous. A back-easing overshoots by design.
  const e = parseEasing('cubic-bezier(0.68, -0.55, 0.27, 1.55)');
  let sawBelow = false;
  let sawAbove = false;
  for (let i = 0; i <= 1000; i++) {
    const y = ease(e, i / 1000);
    if (y < -1e-6) sawBelow = true;
    if (y > 1 + 1e-6) sawAbove = true;
  }
  assert.ok(sawBelow, 'expected the back easing to dip below 0');
  assert.ok(sawAbove, 'expected the back easing to rise above 1');
});

test('ease-in is slower than linear early and ease-out is faster', () => {
  const lin = parseEasing('linear');
  const inE = parseEasing('ease-in');
  const outE = parseEasing('ease-out');
  for (const x of [0.1, 0.2, 0.3, 0.4]) {
    assert.ok(ease(inE, x) < ease(lin, x), `ease-in should trail linear at ${x}`);
    assert.ok(ease(outE, x) > ease(lin, x), `ease-out should lead linear at ${x}`);
  }
});

test('cubic-bezier matches values solved independently', () => {
  // cubic-bezier(1, 0, 0, 1) has P1 = (1,0) and P2 = (0,1), so
  //   x(t) = 3(1-t)^2 t (1) + 3(1-t) t^2 (0) + t^3 = 3t - 6t^2 + 4t^3
  //   y(t) = 3(1-t)^2 t (0) + 3(1-t) t^2 (1) + t^3 = 3t^2 - 2t^3
  // At t = 0.5: x = 1.5 - 1.5 + 0.5 = 0.5 and y = 0.75 - 0.25 = 0.5.
  assert.ok(Math.abs(cubicBezier(1, 0, 0, 1, 0.5) - 0.5) < 1e-9);

  // For cubic-bezier(0.25, 0.25, 0.75, 0.75) the curve is the identity.
  for (const x of [0.13, 0.37, 0.62, 0.88]) {
    assert.ok(
      Math.abs(cubicBezier(0.25, 0.25, 0.75, 0.75, x) - x) < 1e-9,
      `identity bezier wrong at ${x}`
    );
  }

  // ease-in is cubic-bezier(0.42, 0, 1, 1). At t = 0.5, x = 3(0.25)(0.5)(0.42)
  // + 3(0.5)(0.25)(1) + 0.125 = 0.1575 + 0.375 + 0.125 = 0.6575 and
  // y = 0 + 0.375 + 0.125 = 0.5. So easeIn(0.6575) = 0.5.
  assert.ok(
    Math.abs(cubicBezier(0.42, 0, 1, 1, 0.6575) - 0.5) < 1e-6,
    `ease-in(0.6575) was ${cubicBezier(0.42, 0, 1, 1, 0.6575)}, expected 0.5`
  );
});

test('easing parse errors are explicit', () => {
  assert.throws(() => parseEasing('bounce'), EasingError);
  assert.throws(() => parseEasing('cubic-bezier(0.1, 0.2, 0.3)'), EasingError);
  assert.throws(() => parseEasing('cubic-bezier(2, 0, 0.2, 1)'), /x controls must be in \[0,1\]/);
  assert.throws(() => parseEasing('cubic-bezier(a, 0, 0.2, 1)'), /is not a number/);
});

test('easing round trips to a CSS string', () => {
  assert.equal(easingToCss(parseEasing('ease-in-out')), 'ease-in-out');
  assert.equal(easingToCss(parseEasing('cubic-bezier(0.4,0,0.2,1)')), 'cubic-bezier(0.4, 0, 0.2, 1)');
});
