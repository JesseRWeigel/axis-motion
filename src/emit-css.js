'use strict';
// CSS export: one @keyframes rule plus per-glyph animation-delay rules.
//
// Output is byte-for-byte deterministic. Axis tags are sorted, numbers use a
// single fixed formatter, and nothing depends on object key order, a clock,
// a locale, or a random value.

const { easingToCss } = require('./easing');

function num(v) {
  if (!Number.isFinite(v)) throw new RangeError(`cannot format ${v} as CSS number`);
  const r = Math.round(v * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
}

function offsetPct(offset) {
  const p = Math.round(offset * 1e6) / 1e4;
  return `${Number.isInteger(p) ? p : p}%`;
}

/** `"wdth" 75, "wght" 100` with tags in sorted order. */
function variationSettings(values, axesUsed) {
  return axesUsed.map((tag) => `"${tag}" ${num(values[tag])}`).join(', ');
}

function emitCss(plan) {
  const L = [];
  L.push(`/* axis-motion: ${plan.name} */`);
  L.push(`/* font: ${require('path').basename(plan.font.file)} */`);
  L.push(`/* axes animated: ${plan.axesUsed.join(', ')} */`);
  L.push(`@keyframes ${plan.name} {`);
  for (const kf of plan.keyframes) {
    L.push(`  ${offsetPct(kf.offset)} {`);
    L.push(`    font-variation-settings: ${variationSettings(kf.values, plan.axesUsed)};`);
    L.push(`    animation-timing-function: ${easingToCss(kf.easing)};`);
    L.push(`  }`);
  }
  L.push(`}`);
  L.push(``);
  L.push(`.${plan.name} > .glyph {`);
  L.push(`  display: inline-block;`);
  L.push(`  white-space: pre;`);
  L.push(`  animation-name: ${plan.name};`);
  L.push(`  animation-duration: ${num(plan.duration)}ms;`);
  L.push(`  animation-timing-function: ${easingToCss(plan.defaultEasing)};`);
  L.push(`  animation-fill-mode: both;`);
  L.push(`  animation-iteration-count: infinite;`);
  L.push(`}`);
  for (let i = 0; i < plan.glyphs.length; i++) {
    L.push(
      `.${plan.name} > .glyph:nth-child(${i + 1}) { animation-delay: ${num(plan.delays[i])}ms; }`
    );
  }
  L.push(``);
  return L.join('\n');
}

module.exports = { emitCss, variationSettings };
