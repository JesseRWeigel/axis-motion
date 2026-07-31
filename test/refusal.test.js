'use strict';
// The compiler must refuse to emit anything a browser would silently clamp
// or silently ignore. Each refusal is checked for the message naming the
// axis and the allowed range, and each has a control that must NOT raise.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimeline } = require('../src/dsl');
const {
  compile,
  checkAxisValue,
  UnknownAxisError,
  AxisRangeError,
  StaticFontError,
} = require('../src/compile');
const { readFvar } = require('../src/fvar');
const { catches } = require('./expect');

const UBUNTU_SANS = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf';
const UBUNTU_SANS_MONO = '/usr/share/fonts/truetype/ubuntu/UbuntuSansMono[wght].ttf';
const STATIC_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function timeline(fontPath, body) {
  return parseTimeline(`font ${fontPath}\ntext "Ab"\nduration 1000ms\n${body}`);
}

test('control: a valid axis at a valid value compiles without raising', () => {
  const plan = compile(timeline(UBUNTU_SANS, '@0% wght 100\n@100% wght 800'));
  assert.deepEqual(plan.axesUsed, ['wght']);
  assert.equal(plan.keyframes[1].values.wght, 800);
});

test('control: a value exactly on the minimum and the maximum is allowed', () => {
  const f = readFvar(UBUNTU_SANS);
  assert.doesNotThrow(() => checkAxisValue(f, 'wght', 100));
  assert.doesNotThrow(() => checkAxisValue(f, 'wght', 800));
  assert.doesNotThrow(() => checkAxisValue(f, 'wdth', 75));
  assert.doesNotThrow(() => checkAxisValue(f, 'wdth', 100));
});

test('refuses an axis the font does not declare, naming the axis and what exists', () => {
  // opsz is a real OpenType axis tag. Ubuntu Sans does not have one.
  const err = catches(() => compile(timeline(UBUNTU_SANS, '@0% opsz 8\n@100% opsz 40')), UnknownAxisError);
  assert.match(err.message, /axis "opsz" is not present/);
  assert.match(err.message, /UbuntuSans\[wdth,wght\]\.ttf/);
  assert.match(err.message, /Axes this font declares: wdth, wght/);
  assert.equal(err.tag, 'opsz');
  assert.deepEqual(err.available, ['wdth', 'wght']);
});

test('refuses a width axis on a font that only has weight', () => {
  const err = catches(() => compile(timeline(UBUNTU_SANS_MONO, '@0% wdth 100\n@100% wdth 75')), UnknownAxisError);
  assert.match(err.message, /axis "wdth" is not present/);
  assert.match(err.message, /Axes this font declares: wght$/);
});

test('refuses a value above the declared maximum, naming the allowed range', () => {
  // 900 is a perfectly ordinary CSS weight. This font stops at 800, and a
  // browser would clamp to 800 without saying anything.
  const err = catches(() => compile(timeline(UBUNTU_SANS, '@0% wght 400\n@100% wght 900')), AxisRangeError);
  assert.match(err.message, /axis "wght" value 900 is outside the range/);
  assert.match(err.message, /allowed 100 to 800/);
  assert.match(err.message, /default 400/);
  assert.equal(err.min, 100);
  assert.equal(err.max, 800);
  assert.equal(err.value, 900);
});

test('refuses a value below the declared minimum', () => {
  const err = catches(() => compile(timeline(UBUNTU_SANS, '@0% wdth 50\n@100% wdth 100')), AxisRangeError);
  assert.match(err.message, /axis "wdth" value 50 is outside the range/);
  assert.match(err.message, /allowed 75 to 100/);
});

test('refuses just outside the bound, and allows just inside it', () => {
  const f = readFvar(UBUNTU_SANS);
  assert.throws(() => checkAxisValue(f, 'wght', 800.0001), AxisRangeError);
  assert.throws(() => checkAxisValue(f, 'wght', 99.9999), AxisRangeError);
  assert.doesNotThrow(() => checkAxisValue(f, 'wght', 799.9999));
  assert.doesNotThrow(() => checkAxisValue(f, 'wght', 100.0001));
});

test('refuses a static font outright rather than pretending it has wght', () => {
  const err = catches(() => compile(timeline(STATIC_FONT, '@0% wght 100\n@100% wght 700')), StaticFontError);
  assert.match(err.message, /DejaVuSans\.ttf has no fvar table/);
  assert.match(err.message, /nothing can be animated/);
});

test('the refusal happens before any CSS exists, so nothing clampable is emitted', () => {
  const { emitCss } = require('../src/emit-css');
  let emitted = null;
  try {
    emitted = emitCss(compile(timeline(UBUNTU_SANS, '@0% wght 100\n@100% wght 900')));
  } catch {
    /* expected */
  }
  assert.equal(emitted, null, 'no CSS may be produced for an out of range value');
});

test('an axis is checked at every keyframe, not only the first', () => {
  assert.throws(
    () => compile(timeline(UBUNTU_SANS, '@0% wght 400\n@50% wght 400\n@100% wght 1000')),
    AxisRangeError
  );
});

test('a non-finite value is refused', () => {
  const f = readFvar(UBUNTU_SANS);
  assert.throws(() => checkAxisValue(f, 'wght', NaN), AxisRangeError);
  assert.throws(() => checkAxisValue(f, 'wght', Infinity), AxisRangeError);
});
