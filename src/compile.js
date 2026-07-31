'use strict';
// Turn a parsed timeline plus a real font into a validated animation plan.
//
// This is where the refusals live. A browser given
// `font-variation-settings: "opsz" 40` on a font with no opsz axis will
// render something and tell you nothing. A value past an axis maximum gets
// clamped just as quietly. So the compiler checks both against the fvar
// table and raises instead of emitting.

const path = require('path');
const { readFvar, findAxis } = require('./fvar');
const { parseEasing } = require('./easing');

class AxisError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AxisError';
    Object.assign(this, detail);
  }
}

class UnknownAxisError extends AxisError {
  constructor(tag, font, line) {
    const have = font.axes.map((a) => a.tag);
    const list = have.length ? have.join(', ') : '(none, this font has no fvar table)';
    super(
      `axis "${tag}" is not present in ${path.basename(font.file)}. ` +
        `Axes this font declares: ${list}`,
      { tag, available: have, line }
    );
    this.name = 'UnknownAxisError';
  }
}

class AxisRangeError extends AxisError {
  constructor(tag, value, axis, font, line) {
    super(
      `axis "${tag}" value ${value} is outside the range declared by ` +
        `${path.basename(font.file)}: allowed ${axis.min} to ${axis.max} ` +
        `(default ${axis.default})`,
      { tag, value, min: axis.min, max: axis.max, line }
    );
    this.name = 'AxisRangeError';
  }
}

class StaticFontError extends AxisError {
  constructor(font) {
    super(
      `${path.basename(font.file)} has no fvar table, so it has no variation ` +
        `axes and nothing can be animated on it`,
      { file: font.file }
    );
    this.name = 'StaticFontError';
  }
}

/**
 * Validate one axis value against a font. Raises rather than clamping.
 * Exported so callers can check a single value without a whole timeline.
 */
function checkAxisValue(font, tag, value, line) {
  const axis = findAxis(font, tag);
  if (!axis) throw new UnknownAxisError(tag, font, line);
  if (!Number.isFinite(value)) {
    throw new AxisRangeError(tag, value, axis, font, line);
  }
  if (value < axis.min || value > axis.max) {
    throw new AxisRangeError(tag, value, axis, font, line);
  }
  return axis;
}

/**
 * @param {object} timeline output of parseTimeline
 * @param {object} [opts.font] a font already read with readFvar, for tests
 * @param {string} [opts.baseDir] directory to resolve a relative font path against
 */
function compile(timeline, opts = {}) {
  const font =
    opts.font ||
    readFvar(
      path.isAbsolute(timeline.font)
        ? timeline.font
        : path.resolve(opts.baseDir || process.cwd(), timeline.font)
    );

  if (!font.isVariable || font.axes.length === 0) throw new StaticFontError(font);

  // Every axis named anywhere in the timeline, checked against the font.
  const used = new Set();
  for (const kf of timeline.keyframes) {
    for (const s of kf.settings) {
      checkAxisValue(font, s.tag, s.value, kf.line);
      used.add(s.tag);
    }
  }
  const axesUsed = [...used].sort();

  // Chromium (and the spec) only interpolate font-variation-settings when
  // both sides list the same axes in the same order. So every keyframe gets
  // the full axis set, sorted. A keyframe that does not mention an axis
  // inherits the last value set before it, or the font default at the start.
  const carry = new Map();
  for (const tag of axesUsed) carry.set(tag, findAxis(font, tag).default);

  const keyframes = timeline.keyframes.map((kf) => {
    for (const s of kf.settings) carry.set(s.tag, s.value);
    const values = {};
    for (const tag of axesUsed) values[tag] = carry.get(tag);
    return {
      offset: kf.offset,
      timeMs: kf.timeMs,
      values,
      easing: kf.easing || timeline.easing,
      explicit: kf.settings.map((s) => s.tag).sort(),
      line: kf.line,
    };
  });

  const glyphs = [...timeline.text]; // code points, so astral characters stay whole
  const stagger = timeline.stagger;
  const total = timeline.duration + Math.max(0, glyphs.length - 1) * stagger;

  return {
    name: timeline.name,
    text: timeline.text,
    glyphs,
    // Glyph i starts at exactly i * stagger. Asserted in test/stagger.test.js.
    delays: glyphs.map((_, i) => i * stagger),
    font: {
      file: font.file,
      family: font.family,
      axes: font.axes,
    },
    axesUsed,
    duration: timeline.duration,
    stagger,
    totalDuration: total,
    defaultEasing: timeline.easing,
    keyframes,
  };
}

/**
 * Sample the plan at an absolute time, for one glyph index.
 * Returns { tag: value }. Before the glyph's delay elapses it holds the first
 * keyframe, and after its animation ends it holds the last, which is what
 * animation-fill-mode: both does.
 * Independent of any export format, so exports can be checked against it.
 */
function sample(plan, glyphIndex, timeMs) {
  const { ease } = require('./easing');
  const start = plan.delays[glyphIndex];
  if (start === undefined) throw new RangeError(`no glyph at index ${glyphIndex}`);
  const local = timeMs - start;
  const kfs = plan.keyframes;
  if (local <= 0) return { ...kfs[0].values };
  if (local >= plan.duration) return { ...kfs[kfs.length - 1].values };
  const p = local / plan.duration;
  let i = 0;
  while (i < kfs.length - 2 && kfs[i + 1].offset <= p) i++;
  const a = kfs[i];
  const b = kfs[i + 1];
  const span = b.offset - a.offset;
  const raw = span === 0 ? 0 : (p - a.offset) / span;
  // CSS applies the timing function of the keyframe a segment starts from.
  const t = ease(a.easing, raw);
  const out = {};
  for (const tag of plan.axesUsed) {
    out[tag] = a.values[tag] + (b.values[tag] - a.values[tag]) * t;
  }
  return out;
}

module.exports = {
  compile,
  sample,
  checkAxisValue,
  AxisError,
  UnknownAxisError,
  AxisRangeError,
  StaticFontError,
};
