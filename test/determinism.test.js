'use strict';
// Determinism and round trip.
//
// Same timeline twice must give byte-identical CSS. Different timelines must
// differ, otherwise "identical" would be trivially satisfied by an emitter
// that returns a constant.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { parseTimeline } = require('../src/dsl');
const { compile } = require('../src/compile');
const { emitCss } = require('../src/emit-css');
const { emitWaapiJson } = require('../src/emit-waapi');
const { readKeyframes, readDuration } = require('./read-css');

const FONT = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf';

const SOURCE_A = [
  `font ${FONT}`,
  'text "Axis"',
  'name alpha',
  'duration 1200ms',
  'stagger 60ms',
  'easing ease-in-out',
  '@0%   wght 100, wdth 100',
  '@50%  wght 800, wdth 75 [cubic-bezier(0.4, 0, 0.2, 1)]',
  '@100% wght 100, wdth 100',
].join('\n');

const SOURCE_B = SOURCE_A.replace('wght 800', 'wght 700');

function css(source) {
  return emitCss(compile(parseTimeline(source)));
}

function sha(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

test('the same timeline compiles to byte-identical CSS twice', () => {
  const first = css(SOURCE_A);
  const second = css(SOURCE_A);
  assert.equal(Buffer.compare(Buffer.from(first), Buffer.from(second)), 0);
  assert.equal(sha(first), sha(second));
});

test('ten compilations in a row all hash the same', () => {
  const hashes = new Set();
  for (let i = 0; i < 10; i++) hashes.add(sha(css(SOURCE_A)));
  assert.equal(hashes.size, 1, `expected 1 distinct output, got ${hashes.size}`);
});

test('two different timelines produce different CSS', () => {
  assert.notEqual(sha(css(SOURCE_A)), sha(css(SOURCE_B)));
  assert.ok(css(SOURCE_B).includes('"wght" 700'));
  assert.ok(!css(SOURCE_B).includes('"wght" 800'));
});

test('a one millisecond difference in stagger changes the output', () => {
  const a = css(SOURCE_A);
  const b = css(SOURCE_A.replace('stagger 60ms', 'stagger 61ms'));
  assert.notEqual(sha(a), sha(b));
});

test('the WAAPI JSON export is byte-identical twice and differs between timelines', () => {
  const j = (s) => emitWaapiJson(compile(parseTimeline(s)));
  assert.equal(sha(j(SOURCE_A)), sha(j(SOURCE_A)));
  assert.notEqual(sha(j(SOURCE_A)), sha(j(SOURCE_B)));
});

test('the emitted CSS reads back as the plan that produced it', () => {
  const plan = compile(parseTimeline(SOURCE_A));
  const kfs = readKeyframes(css(SOURCE_A), 'alpha');
  assert.equal(kfs.length, plan.keyframes.length);
  assert.equal(readDuration(css(SOURCE_A), 'alpha'), plan.duration);
  for (let i = 0; i < kfs.length; i++) {
    assert.equal(kfs[i].offset, plan.keyframes[i].offset, `keyframe ${i} offset`);
    for (const tag of plan.axesUsed) {
      assert.equal(kfs[i].values[tag], plan.keyframes[i].values[tag], `keyframe ${i} ${tag}`);
    }
    assert.deepEqual(kfs[i].order, plan.axesUsed, `keyframe ${i} axis order`);
  }
  assert.equal(kfs[1].easing, 'cubic-bezier(0.4, 0, 0.2, 1)');
  assert.equal(kfs[0].easing, 'ease-in-out');
});

test('every keyframe lists the same axes in the same order', () => {
  // Chromium only interpolates font-variation-settings when both sides list
  // identical axes in identical order. A keyframe that omits an axis stops
  // the animation dead, so the compiler fills them in.
  const source = [
    `font ${FONT}`,
    'text "Ax"',
    'name partial',
    'duration 1000ms',
    '@0%   wght 100',
    '@50%  wdth 75',
    '@100% wght 800, wdth 100',
  ].join('\n');
  const out = emitCss(compile(parseTimeline(source)));
  const kfs = readKeyframes(out, 'partial');
  for (const kf of kfs) assert.deepEqual(kf.order, ['wdth', 'wght']);
  // The keyframe that only named wdth inherits wght 100 from before it.
  assert.equal(kfs[1].values.wght, 100);
  // The first keyframe never named wdth, so it takes the font default, 100.
  assert.equal(kfs[0].values.wdth, 100);
});

test('numbers are formatted without locale or float noise', () => {
  const source = [
    `font ${FONT}`,
    'text "A"',
    'name floaty',
    'duration 1000ms',
    '@0%   wght 100.1',
    '@33.3% wght 400.25',
    '@100% wght 799.9',
  ].join('\n');
  const out = emitCss(compile(parseTimeline(source)));
  assert.ok(out.includes('"wght" 100.1'), out);
  assert.ok(out.includes('"wght" 400.25'), out);
  assert.ok(out.includes('"wght" 799.9'), out);
  assert.ok(out.includes('33.3% {'), out);
  assert.ok(!/\d\.\d{10,}/.test(out), 'no float noise in output');
});
