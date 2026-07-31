'use strict';
// An independent reader for the CSS the project emits.
//
// This file deliberately shares no code with src/emit-css.js. It re-derives
// the numbers from the text with its own regular expressions, so a formatting
// bug in the emitter cannot hide behind a helper both sides call.

/** @returns {Array<number>} animation-delay in ms, in nth-child order. */
function readCssDelays(css, name) {
  const re = new RegExp(
    `\\.${escapeRe(name)}\\s*>\\s*\\.glyph:nth-child\\((\\d+)\\)\\s*\\{[^}]*animation-delay:\\s*(-?[\\d.]+)ms`,
    'g'
  );
  const found = new Map();
  let m;
  while ((m = re.exec(css)) !== null) found.set(Number(m[1]), Number(m[2]));
  const out = [];
  for (let i = 1; i <= found.size; i++) {
    if (!found.has(i)) throw new Error(`no animation-delay rule for nth-child(${i})`);
    out.push(found.get(i));
  }
  return out;
}

/**
 * @returns {Array<{offset:number, values:Object, easing:string}>}
 * Keyframes of the named @keyframes rule, in source order.
 */
function readKeyframes(css, name) {
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start === -1) throw new Error(`no @keyframes rule named ${name}`);
  // Find the matching closing brace by counting.
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`unbalanced braces in @keyframes ${name}`);
  const body = css.slice(css.indexOf('{', start) + 1, end);

  const out = [];
  const blockRe = /([\d.]+)%\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(body)) !== null) {
    const offset = Number(m[1]) / 100;
    const decls = m[2];
    const fvs = /font-variation-settings:\s*([^;]+);/.exec(decls);
    if (!fvs) throw new Error(`keyframe at ${m[1]}% has no font-variation-settings`);
    const values = {};
    const order = [];
    for (const part of fvs[1].split(',')) {
      const p = /^\s*"([^"]{4})"\s+(-?[\d.]+)\s*$/.exec(part);
      if (!p) throw new Error(`cannot read font-variation-settings entry "${part.trim()}"`);
      values[p[1]] = Number(p[2]);
      order.push(p[1]);
    }
    const timing = /animation-timing-function:\s*([^;]+);/.exec(decls);
    out.push({ offset, values, order, easing: timing ? timing[1].trim() : null });
  }
  if (out.length === 0) throw new Error(`@keyframes ${name} has no keyframe blocks`);
  return out;
}

/** The animation-duration in ms declared on the glyph rule. */
function readDuration(css, name) {
  const re = new RegExp(
    `\\.${escapeRe(name)}\\s*>\\s*\\.glyph\\s*\\{[\\s\\S]*?animation-duration:\\s*(-?[\\d.]+)ms`
  );
  const m = re.exec(css);
  if (!m) throw new Error('no animation-duration on the glyph rule');
  return Number(m[1]);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { readCssDelays, readKeyframes, readDuration };
