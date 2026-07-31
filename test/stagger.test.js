'use strict';
// Per-glyph stagger. Glyph i starts at exactly i * S, and S = 0 starts every
// glyph together. Asserted on the compiled plan and again on the emitted CSS,
// because the plan being right does not prove the CSS says so.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimeline } = require('../src/dsl');
const { compile, sample } = require('../src/compile');
const { emitCss } = require('../src/emit-css');
const { emitWaapi } = require('../src/emit-waapi');
const { readCssDelays } = require('./read-css');

const FONT = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf';

function plan(text, staggerMs) {
  return compile(
    parseTimeline(
      [
        `font ${FONT}`,
        `text "${text}"`,
        'duration 1000ms',
        `stagger ${staggerMs}ms`,
        'easing linear',
        '@0% wght 100',
        '@100% wght 800',
      ].join('\n')
    )
  );
}

test('glyph i starts at exactly i * S', () => {
  const S = 37;
  const p = plan('ABCDEFGH', S);
  assert.equal(p.glyphs.length, 8);
  for (let i = 0; i < p.glyphs.length; i++) {
    assert.equal(p.delays[i], i * S, `glyph ${i} delay`);
  }
  assert.deepEqual(p.delays, [0, 37, 74, 111, 148, 185, 222, 259]);
});

test('the emitted CSS carries the same delays, read back out of the text', () => {
  const S = 37;
  const p = plan('ABCDEFGH', S);
  const delays = readCssDelays(emitCss(p), p.name);
  assert.equal(delays.length, 8, 'one animation-delay rule per glyph');
  for (let i = 0; i < 8; i++) assert.equal(delays[i], i * S, `CSS delay for glyph ${i}`);
});

test('the WAAPI export carries the same delays', () => {
  const S = 37;
  const w = emitWaapi(plan('ABCDEFGH', S));
  assert.equal(w.animations.length, 8);
  for (let i = 0; i < 8; i++) assert.equal(w.animations[i].options.delay, i * S);
});

test('stagger 0 starts every glyph together', () => {
  const p = plan('ABCDEFGH', 0);
  assert.deepEqual(p.delays, [0, 0, 0, 0, 0, 0, 0, 0]);
  const delays = readCssDelays(emitCss(p), p.name);
  assert.deepEqual(delays, [0, 0, 0, 0, 0, 0, 0, 0]);
  // And every glyph then holds the same value at every instant.
  for (const t of [0, 250, 500, 999, 1000]) {
    const first = sample(p, 0, t).wght;
    for (let i = 1; i < 8; i++) {
      assert.equal(sample(p, i, t).wght, first, `glyph ${i} at ${t}ms`);
    }
  }
});

test('a non-zero stagger makes glyphs differ at the same instant', () => {
  // Guards against the stagger-0 test passing because stagger is ignored.
  const p = plan('ABCDEFGH', 100);
  const a = sample(p, 0, 300).wght;
  const b = sample(p, 3, 300).wght;
  assert.notEqual(a, b, 'staggered glyphs should not share a value mid animation');
  // Linear, 100 to 800 over 1000ms. Glyph 0 is 300ms in: 100 + 0.3*700 = 310.
  // Glyph 3 starts at 300ms, so it is at 0 progress: 100.
  assert.ok(Math.abs(a - 310) < 1e-9, `glyph 0 at 300ms was ${a}`);
  assert.ok(Math.abs(b - 100) < 1e-9, `glyph 3 at 300ms was ${b}`);
});

test('total duration is the timeline duration plus (N-1) * S', () => {
  assert.equal(plan('ABCDEFGH', 37).totalDuration, 1000 + 7 * 37);
  assert.equal(plan('ABCDEFGH', 0).totalDuration, 1000);
  assert.equal(plan('A', 500).totalDuration, 1000, 'a single glyph has no stagger to add');
});

test('a stagger given in seconds is the same as the equivalent milliseconds', () => {
  assert.deepEqual(plan('ABC', 250).delays, compileWith('0.25s').delays);
});

function compileWith(staggerSpec) {
  return compile(
    parseTimeline(
      [
        `font ${FONT}`,
        'text "ABC"',
        'duration 1000ms',
        `stagger ${staggerSpec}`,
        '@0% wght 100',
        '@100% wght 800',
      ].join('\n')
    )
  );
}

test('astral characters count as one glyph', () => {
  const p = plan('A\u{1F600}B', 10);
  assert.equal(p.glyphs.length, 3, 'an emoji is one glyph, not two UTF-16 code units');
  assert.deepEqual(p.delays, [0, 10, 20]);
});
