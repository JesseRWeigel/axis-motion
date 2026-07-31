'use strict';
// DSL parsing, and in particular that a parse error names the line and the
// column and is never swallowed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimeline, DslError } = require('../src/dsl');
const { catches } = require('./expect');

const FONT = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf';

function src(...lines) {
  return lines.join('\n');
}

const GOOD = src(
  `font ${FONT}`,
  'text "Ax"',
  'duration 1200ms',
  'stagger 60ms',
  'easing ease-in-out',
  '@0%   wght 100, wdth 100',
  '@100% wght 800, wdth 75'
);

test('a well formed timeline parses', () => {
  const t = parseTimeline(GOOD);
  assert.equal(t.font, FONT);
  assert.equal(t.text, 'Ax');
  assert.equal(t.duration, 1200);
  assert.equal(t.stagger, 60);
  assert.equal(t.easing.name, 'ease-in-out');
  assert.equal(t.keyframes.length, 2);
  assert.deepEqual(t.keyframes[0].settings.map((s) => [s.tag, s.value]), [
    ['wght', 100],
    ['wdth', 100],
  ]);
});

test('comments and blank lines are ignored, and # inside a quoted string is not a comment', () => {
  const t = parseTimeline(
    src(
      '# leading comment',
      '',
      `font ${FONT}`,
      'text "A#B"   # trailing comment',
      '   ',
      'duration 1s',
      '@0% wght 100',
      '@100% wght 200 # another'
    )
  );
  assert.equal(t.text, 'A#B');
  assert.equal(t.duration, 1000);
});

test('seconds and milliseconds both parse', () => {
  const t = parseTimeline(src(`font ${FONT}`, 'text "A"', 'duration 1.5s', 'stagger 0.04s', '@0% wght 100', '@100% wght 200'));
  assert.equal(t.duration, 1500);
  assert.equal(t.stagger, 40);
});

test('keyframe positions may be given as times as well as percentages', () => {
  const t = parseTimeline(
    src(`font ${FONT}`, 'text "A"', 'duration 1000ms', '@0ms wght 100', '@250ms wght 400', '@1s wght 800')
  );
  assert.deepEqual(t.keyframes.map((k) => k.offset), [0, 0.25, 1]);
});

function failsAt(source, line, column, pattern) {
  const err = catches(() => parseTimeline(source), DslError);
  assert.equal(err.line, line, `expected line ${line}, got ${err.line}: ${err.message}`);
  assert.equal(err.column, column, `expected column ${column}, got ${err.column}: ${err.message}`);
  assert.match(err.message, pattern);
  assert.match(err.message, new RegExp(`line ${line}, column ${column}`));
  return err;
}

test('an unknown directive names its line and column', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', 'wobble 3', '@0% wght 100', '@100% wght 200'),
    4,
    1,
    /unknown directive "wobble"/
  );
});

test('a misspelled axis tag length is caught with the column of the tag', () => {
  //          1234567890
  // line 5:  @0% wgt 100
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '', '@0% wgt 100', '@100% wght 200'),
    5,
    5,
    /axis tag "wgt" must be exactly 4 characters/
  );
});

test('a non numeric axis value is caught at the value column', () => {
  //          1234567890123
  // line 4:  @0% wght heavy
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght heavy', '@100% wght 200'),
    4,
    10,
    /expected a number, found "heavy"/
  );
});

test('a bad easing inside brackets is caught at the easing column', () => {
  const err = failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100 [bounce]', '@100% wght 200'),
    4,
    15,
    /unknown easing "bounce"/
  );
  assert.ok(err.format().includes('^'), 'format() should point a caret at the column');
});

test('an unclosed bracket is reported at the bracket', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100 [ease-in', '@100% wght 200'),
    4,
    14,
    /unclosed "\[" around easing/
  );
});

test('a duration without a unit is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1200', '@0% wght 100', '@100% wght 200'),
    3,
    10,
    /expected a duration like 800ms or 1\.5s/
  );
});

test('keyframes out of order are rejected and name the offending line', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100', '@60% wght 200', '@40% wght 300', '@100% wght 400'),
    6,
    1,
    /keyframe offsets must increase: 40% does not come after 60%/
  );
});

test('a timeline that does not start at 0% is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@10% wght 100', '@100% wght 200'),
    4,
    1,
    /first keyframe must be at 0%, found 10%/
  );
});

test('a timeline that does not end at 100% is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100', '@90% wght 200'),
    5,
    1,
    /last keyframe must be at 100%, found 90%/
  );
});

test('a keyframe past the declared duration is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0ms wght 100', '@1500ms wght 200'),
    5,
    1,
    /keyframe at 1500ms is past the 1000ms duration/
  );
});

test('the same axis twice in one keyframe is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100, wght 200', '@100% wght 300'),
    4,
    15,
    /axis "wght" set twice in one keyframe/
  );
});

test('a repeated directive is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', 'duration 2s', '@0% wght 100', '@100% wght 200'),
    4,
    1,
    /directive "duration" given more than once/
  );
});

test('a keyframe with no settings is rejected', () => {
  failsAt(src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0%', '@100% wght 200'), 4, 4, /keyframe has no axis settings/);
});

test('missing required directives are reported, not defaulted', () => {
  assert.throws(() => parseTimeline('text "A"\nduration 1s\n@0% wght 100\n@100% wght 200'), /no "font" directive/);
  assert.throws(() => parseTimeline(`font ${FONT}\nduration 1s\n@0% wght 100\n@100% wght 200`), /no "text" directive/);
  assert.throws(() => parseTimeline(`font ${FONT}\ntext "A"\n@0% wght 100\n@100% wght 200`), /no "duration" directive/);
});

test('a single keyframe is rejected', () => {
  assert.throws(
    () => parseTimeline(`font ${FONT}\ntext "A"\nduration 1s\n@0% wght 100`),
    /needs at least 2 keyframes, found 1/
  );
});

test('a percentage above 100 is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100', '@120% wght 200', '@100% wght 300'),
    5,
    1,
    /keyframe position 120% is outside 0% to 100%/
  );
});

test('trailing junk after a keyframe is rejected rather than ignored', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght 100 ease-out', '@100% wght 200'),
    4,
    14,
    /unexpected input "ease-out" at end of keyframe/
  );
});

test('a name that is not a CSS identifier is rejected', () => {
  failsAt(
    src(`font ${FONT}`, 'text "A"', 'name 9lives', 'duration 1s', '@0% wght 100', '@100% wght 200'),
    3,
    6,
    /must be a CSS identifier/
  );
});

test('DslError.format shows the source line and a caret', () => {
  const err = catches(
    () => parseTimeline(src(`font ${FONT}`, 'text "A"', 'duration 1s', '@0% wght heavy', '@100% wght 200')),
    DslError
  );
  const lines = err.format().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^line 4, column 10: /);
  assert.ok(lines[1].includes('@0% wght heavy'), lines[1]);
  assert.equal(lines[2].trimEnd().endsWith('^'), true);
  assert.equal(lines[2].indexOf('^'), lines[1].indexOf('@0%') + 9);
});
