# axis-motion

Animate OpenType variable font axes from a small timeline DSL, and export the result to CSS
`@keyframes`, a Web Animations API object, and video.

**[Watch the axes animate →](https://jesserweigel.github.io/axis-motion/)**

> Measurements described here were taken on one development machine: an RTX 5090 with
> 32 GB of VRAM, 12 cores, 48 GB of RAM, running Linux under WSL2. Numbers from your own
> hardware will differ.

The part worth caring about is that it reads the font. A variable font declares its axes in the
OpenType `fvar` table, with a tag, a minimum, a maximum and a default for each. `src/fvar.js`
parses that table by hand, and the compiler refuses to emit an animation for an axis a font does
not have, or a value outside the range the font declares. A browser given either of those renders
something and tells you nothing, so the refusal is the feature.

Written in Node. The Web Animations export is a JavaScript object, the browser verification needs
`playwright-core` which is a Node package, and the video exporter drives that same browser, so a
second runtime would have bought nothing.

## Axis inventory

Every number below was read from the `fvar` table of the file named. `fc-list :variable` returns
nothing on the development machine, so `axis-motion fonts` walks the system font directories and checks each
file's table directory for `fvar` itself.

```
$ node bin/axis-motion.js fonts
scanned 117 font files
Ubuntu-Italic[wdth,wght].ttf
    Ubuntu  wdth[75..100] def 100  wght[100..800] def 400
    4 symlinks point here: Ubuntu-BI.ttf, Ubuntu-LI.ttf, Ubuntu-MI.ttf, Ubuntu-RI.ttf
UbuntuMono-Italic[wght].ttf
    Ubuntu Mono  wght[400..700] def 400
    2 symlinks point here: UbuntuMono-BI.ttf, UbuntuMono-RI.ttf
UbuntuMono[wght].ttf
    Ubuntu Mono  wght[400..700] def 400
    2 symlinks point here: UbuntuMono-B.ttf, UbuntuMono-R.ttf
UbuntuSans-Italic[wdth,wght].ttf
    Ubuntu Sans  wdth[75..100] def 100  wght[100..800] def 400
UbuntuSansMono-Italic[wght].ttf
    Ubuntu Sans Mono  wght[400..700] def 400
UbuntuSansMono[wght].ttf
    Ubuntu Sans Mono  wght[100..700] def 400
UbuntuSans[wdth,wght].ttf
    Ubuntu Sans  wdth[75..100] def 100  wght[100..800] def 400
Ubuntu[wdth,wght].ttf
    Ubuntu  wdth[75..100] def 100  wght[100..800] def 400
    6 symlinks point here: Ubuntu-B.ttf, Ubuntu-C.ttf, Ubuntu-L.ttf, Ubuntu-M.ttf, Ubuntu-R.ttf, Ubuntu-Th.ttf
22 paths with fvar, 8 distinct files, 95 static, 0 unreadable
```

Full paths are under `/usr/share/fonts/truetype/ubuntu/`. Three things in that listing are worth
saying out loud.

**There are 8 variable fonts here, not 21 or 22.** Twenty-two paths carry an `fvar` table, and
fourteen of them are symlinks. `Ubuntu-B.ttf` sounds like a static bold and is a symlink to
`Ubuntu[wdth,wght].ttf`. A count that trusted filenames or `fc-list` output would be wrong by a
factor of nearly three.

**The only axis tags on the development machine are `wght` and `wdth`.** There is no `opsz`, no `ital`, no
`slnt`, and no custom axis anywhere in this font set. The brief asked for custom axes, and the
honest answer from the table is that the development machine has none to demonstrate on. So the parser is
tested two ways: against the real fonts above, and against a synthetic font built in memory by
`test/fvar.test.js` carrying `GRAD` and `XPRT` axes, one hidden and one with a negative minimum.
That test would fail immediately if the parser returned a fixed list of common tags.

**The same tag means different things in different files.** `wght` runs 100 to 800 in
`UbuntuSans[wdth,wght].ttf`, 100 to 700 in `UbuntuSansMono[wght].ttf`, and 400 to 700 in
`UbuntuMono[wght].ttf`. `wdth` has a maximum of 100, not the 125 or 151 that other families use,
so 110 is out of range here and would be silently clamped by a browser. This is exactly why the
range check reads the file rather than assuming CSS defaults.

## The timeline DSL

One statement per line. Blank lines are ignored, and `#` starts a comment except inside a quoted
string.

```
program    := line*
line       := directive | keyframe | comment | blank
comment    := ws* "#" any*
directive  := ws* name ws+ argument (ws+ argument)* ws*
name       := "font" | "text" | "duration" | "stagger" | "easing" | "name"
keyframe   := ws* "@" position ws+ settings (ws* "[" easing "]")? ws*
position   := number "%" | number ("ms" | "s")
settings   := setting (ws* "," ws* setting)*
setting    := tag ws+ number
tag        := <4 characters, [A-Za-z0-9 ], an OpenType axis tag>
number     := ["+"|"-"] digit* ["." digit*]
easing     := "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out"
            | "cubic-bezier(" number "," number "," number "," number ")"
```

| Directive | Required | Meaning |
|---|---|---|
| `font` | yes | Path to a font file. Relative paths resolve against the timeline's directory. |
| `text` | yes | The string to animate. One animation per code point. |
| `duration` | yes | How long one glyph's animation runs. `800ms` or `1.5s`. |
| `stagger` | no, default `0` | Delay added per glyph. Glyph `i` starts at exactly `i * stagger`. |
| `easing` | no, default `linear` | The timing function used between keyframes that do not name their own. |
| `name` | no, default `axis-motion` | The CSS identifier used for the `@keyframes` rule and the glyph class. |

Rules the parser enforces:

- At least two keyframes. The first must be at `0%` and the last at `100%`.
- Keyframe offsets strictly increase.
- A keyframe given as a time may not exceed `duration`.
- An axis may appear only once per keyframe, and a directive only once per file.
- Anything left over at the end of a keyframe line is an error rather than ignored input.

A keyframe that does not mention an axis inherits the last value set before it, or the font's
declared default if nothing set it yet. Every emitted keyframe then lists the full axis set in
sorted order, because Chromium only interpolates `font-variation-settings` when both sides list
identical axes in identical order. Omitting an axis from one keyframe stops the animation dead,
which is a confusing failure to debug, so the compiler makes it impossible.

Example, `examples/wide-to-narrow.tl`:

```
font     /usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf
text     "Axis Motion"
name     axisWave
duration 1200ms
stagger  60ms
easing   ease-in-out

@0%    wght 100, wdth 100
@50%   wght 800, wdth 75  [cubic-bezier(0.4, 0, 0.2, 1)]
@100%  wght 100, wdth 100
```

### Parse errors

A parse error names the line and the column and is never swallowed:

```
$ node bin/axis-motion.js css examples/bad-syntax.tl
timeline parse error
line 5, column 12: expected a number, found "heavy"
   5 | @0%   wght heavy
                  ^
$ echo $?
1
```

### Refusals

```
$ node bin/axis-motion.js css examples/bad-axis.tl
refused: axis "opsz" is not present in UbuntuSans[wdth,wght].ttf. Axes this font declares: wdth, wght
$ echo $?
1

$ node bin/axis-motion.js css examples/out-of-range.tl
refused: axis "wght" value 900 is outside the range declared by UbuntuSans[wdth,wght].ttf: allowed 100 to 800 (default 400)
$ echo $?
1
```

A static font is refused outright rather than treated as having a weight axis:

```
refused: DejaVuSans.ttf has no fvar table, so it has no variation axes and nothing can be animated on it
```

The refusal happens before any output exists, so there is no partly written CSS file to clean up.

## Running it

```
node bin/axis-motion.js fonts                    # every font here with an fvar table
node bin/axis-motion.js axes <font-file>         # the axes one font declares
node bin/axis-motion.js grammar                  # the grammar above
node bin/axis-motion.js css examples/wide-to-narrow.tl
node bin/axis-motion.js waapi examples/wide-to-narrow.tl
node bin/axis-motion.js page examples/wide-to-narrow.tl > preview.html
node bin/axis-motion.js sample examples/wide-to-narrow.tl 3 700
node bin/axis-motion.js video examples/wide-to-narrow.tl -o out/demo.mp4
node tools/build-docs.js                         # regenerate docs/index.html
bash scripts/verify.sh
```

No dependencies are installed. `package.json` lists none and the tests use `node:test`. The
browser checks and the video exporter borrow `playwright-core` from the sibling `a11y-sweep`
project in this workspace, or from `$AXIS_MOTION_PLAYWRIGHT`.

## The three exports

**CSS.** A `@keyframes` rule with `font-variation-settings` per keyframe, plus per-glyph
`animation-delay`. Verified by parsing back what it emits with `test/read-css.js`, which shares no
code with the emitter, and comparing every offset, axis value and axis order against the compiled
plan. Also verified byte-identical across ten compilations of the same timeline, and different
across two timelines that differ by one millisecond of stagger.

**WAAPI.** A JSON object with one entry per glyph, each carrying `keyframes` and `options` ready
for `element.animate()`. Verified in real Chromium: the export is loaded, the animations are
seeked to seven timeline points, and `getComputedStyle(el).fontVariationSettings` is read back and
compared against weights computed by hand in `test/browser.test.js` from the timeline text. That
check found a real bug the first time it ran, in the arithmetic written into the test.

**Video.** See the limitation below. It is faithful, and it gets there by driving a browser rather
than by rendering text itself.

## Status

`bash scripts/verify.sh`, run from a clean shell on 2026-07-31. Exit code 0. The test list is
trimmed at the marked point for length; nothing else was edited.

```
== environment
v24.13.0
ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers
repo: <repo>/axis-motion

== no secrets and no home directory paths in tracked files
scanned 32 tracked files, 186 KB
no credential shaped strings, no /home/<user>/ paths, no NUL bytes

== nothing large and nothing binary is committed
32 tracked files, 186 KB total
largest tracked file: docs/index.html

== the axis inventory the development machine really has
/usr/share/fonts/truetype/ubuntu/UbuntuSans-Italic[wdth,wght].ttf
    Ubuntu Sans  wdth[75..100] def 100  wght[100..800] def 400
/usr/share/fonts/truetype/ubuntu/UbuntuSansMono-Italic[wght].ttf
    Ubuntu Sans Mono  wght[400..700] def 400
/usr/share/fonts/truetype/ubuntu/UbuntuSansMono[wght].ttf
    Ubuntu Sans Mono  wght[100..700] def 400
/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf
    Ubuntu Sans  wdth[75..100] def 100  wght[100..800] def 400
/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf
    Ubuntu  wdth[75..100] def 100  wght[100..800] def 400
    6 symlinks point here: Ubuntu-B.ttf, Ubuntu-C.ttf, Ubuntu-L.ttf, Ubuntu-M.ttf, Ubuntu-R.ttf, Ubuntu-Th.ttf
22 paths with fvar, 8 distinct files, 95 static, 0 unreadable

== refusals, run for real
refused: axis "opsz" is not present in UbuntuSans[wdth,wght].ttf. Axes this font declares: wdth, wght
refused: axis "wght" value 900 is outside the range declared by UbuntuSans[wdth,wght].ttf: allowed 100 to 800 (default 400)
timeline parse error
line 5, column 12: expected a number, found "heavy"
   5 | @0%   wght heavy
                  ^
exit codes: unknown axis 1, out of range 1, syntax error 1, valid timeline 0

== docs/index.html is a fresh build from the live font scan
docs/index.html matches a fresh build

== test suite
▶ browser checks
  ✔ the server serves this project, checked by content not status
    browser-read fontVariationSettings vs timeline
      t=   0ms  read [100, 100, 100]  expected [100, 100, 100]
      t= 200ms  read [240, 100, 100]  expected [240, 100, 100]
      t= 500ms  read [450, 310, 170]  expected [450, 310, 170]
      t= 700ms  read [590, 450, 310]  expected [590, 450, 310]
      t=1000ms  read [800, 660, 520]  expected [800, 660, 520]
      t=1200ms  read [800, 800, 660]  expected [800, 800, 660]
      t=1400ms  read [800, 800, 800]  expected [800, 800, 800]
  ✔ WAAPI export: computed font-variation-settings matches the timeline
  ✔ the harness really loaded the variable font, measured not assumed
    docs page animation mode on this Chromium: font-weight
      font-variation-settings widths [341.3125,341.3125,341.3125,341.3125]
      font-weight/stretch widths     [327.75,361.296875,270.21875,341.3125]
  ✔ the docs page animates for real, and its font report is true
  ✔ the docs page axis table matches a fresh scan of the development machine
  ✔ no horizontal body overflow at 390px
  ✔ light and dark both render, and data-theme overrides both ways
  ✔ prefers-reduced-motion: no autoplay, and the play control still works
  ✔ the docs page requests nothing from the network
✔ browser checks
[... 70 further tests, all passing, trimmed for length ...]
ℹ tests 79
ℹ pass 79
ℹ fail 0
ℹ skipped 0

== test accounting
pass 79, fail 0, skipped 0

== README is current
README.md carries the Status section, the success line, pass 79, all 8 variable fonts and all 2 axis tags

axis-motion verify: all checks passed
```

### The verify was attacked

A verify command that passes on a broken implementation is worth nothing, so two sabotages were
applied, and in each case the sabotaged output was inspected with the naked eye before drawing any
conclusion.

**Sabotage 1, the `fvar` parser returns a hardcoded `wght` axis for every font.** `readFvar` was
edited to return `[{tag:'wght', min:100, default:400, max:900}]` unconditionally before it ever
looks at the table directory.

Confirmed observable before anything else:

```
$ node bin/axis-motion.js axes /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
family: DejaVu Sans
  wght  min 100  default 400  max 900  name Weight
```

`DejaVuSans.ttf` has no `fvar` table at all, so that output is the sabotage working.

**Verify exit code 1.** It stopped inside the refusal section, reporting
`exit codes: unknown axis 1, out of range 0, syntax error 1, valid timeline 1`, with
`FAIL: a case that must be refused did not exit 1` and `FAIL: a valid timeline did not compile`,
then died on `tools/build-docs.js` which could no longer find the `wdth` axis. Running the test
suite by itself under the same sabotage: **79 tests, 57 pass, 22 fail**, including the exact
bounds check on Ubuntu Sans, both negative controls, the custom-axis synthetic font, every
determinism test, and the browser check that compares the docs page table against a live scan.

**Sabotage 2, the range check always passes.** `checkAxisValue` was edited to return the axis
without comparing the value against `min` and `max`.

Confirmed observable before anything else:

```
$ node bin/axis-motion.js css examples/out-of-range.tl
@keyframes axis-motion {
  0% { font-variation-settings: "wght" 400; ... }
  100% { font-variation-settings: "wght" 900; ... }
}
```

That is CSS asking for weight 900 from a font whose declared maximum is 800, which is exactly the
silent clamp this project exists to prevent.

**Verify exit code 1.** The refusal section reported
`exit codes: unknown axis 1, out of range 0, syntax error 1, valid timeline 0` and
`FAIL: a case that must be refused did not exit 1`, then the docs check reported
`docs/index.html is out of date` because the refusal message quoted on that page had vanished.
Running the test suite by itself under the same sabotage: **79 tests, 74 pass, 5 fail**, all five
in the refusal file.

Both sabotages were reverted with `git checkout`, and verify returns to exit 0.

## Limitations

**Video export goes through a browser, and that is the honest description of it.** ffmpeg's
`drawtext` filter draws text through libfreetype and exposes no option for OpenType variation
coordinates. Handed a variable font it draws that font's default instance and ignores the axis you
meant to animate, which would produce a video of completely static text with a convincing
filename. So `src/export-video.js` does not use `drawtext`. It renders the same WAAPI animation in
headless Chromium, seeks to each frame time, screenshots, and pipes the PNGs to ffmpeg for H.264
encoding. What that gives you is real variable font rendering by a real shaping and rasterisation
engine. What it does not give you is an independent text rasteriser, so the video looks like
Chromium because it is Chromium. If Chromium cannot be loaded the exporter raises rather than
falling back. `test/video.test.js` asserts the `drawtext` claim against the ffmpeg on the development machine
by checking its filter help for any axis option, so if a future ffmpeg gains one this paragraph
fails a test instead of quietly going stale.

The demo render, `node bin/axis-motion.js video examples/wide-to-narrow.tl -o out/demo.mp4`,
produces 55 frames at 30 fps, 960x320, 1800ms, **51990 bytes**. It is written to `out/`, which is
gitignored, and it is not committed. Neither are any fonts: verify fails if a `.ttf`, `.mp4`,
`.png` or similar ever appears in the tracked file list, and the whole tracked repository is
under 200 KB.

**`docs/index.html` embeds no font, and says so on the page.** A whole variable font here would be
1.08 MB for `UbuntuSans[wdth,wght].ttf` alone, and a subset small enough to inline would still be
a font committed to a repository whose rule is not to commit fonts. So the page uses a system font
stack and then measures what the visitor's browser actually resolved. The page reports the result
in plain language, including the case where nothing animates because the visitor has no variable
font. It does not claim a font is loaded when it is not. The page is one file of about 28 KB with
no network requests at all, which a browser test asserts by counting requests.

**Chromium on Linux ignores `font-variation-settings` on fonts it gets from fontconfig.** This was
found by measuring, not by reading, and it is worth writing down because it is the kind of thing
that makes a demo page look broken for no visible reason. Measured on the Chromium in this
workspace, with `Ubuntu Sans` resolved through the system font stack:

```
font-variation-settings widths [341.3125, 341.3125, 341.3125, 341.3125]
font-weight/stretch widths     [327.75, 361.296875, 270.21875, 341.3125]
```

Four probes each, at `wght 100`, `wght 700`, `wdth 75` and `wdth 100`. Through
`font-variation-settings` nothing moves at all. Through `font-weight` and `font-stretch` the same
axes move, and at intermediate values such as 250 and 550 that are not named instances, so real
interpolation is happening. The same font loaded by an `@font-face` rule does respond to
`font-variation-settings`, which `test/browser.test.js` confirms separately against the harness
page.

So the docs page probes both, picks whichever works, and says which one it picked. When it falls
back it rebuilds the identical timeline on `font-weight` and `font-stretch` and states on the page
that the exported CSS and WAAPI objects still use `font-variation-settings`, which is the right
thing for a font you ship yourself. The browser test asserts that the mode the page claims agrees
with the widths the page measured, so the page cannot report a mode it did not actually verify.

**Only one glyph run, one font, one text string per timeline.** There is no support for multiple
fonts in one animation, no per-glyph axis targets, no reverse or alternate direction, and no
`steps()` easing. Easing is cubic Bezier only, which covers what CSS and WAAPI share.

**Named instances are parsed but not usable from a timeline.** `fvar` instance records are read
and asserted in tests, and `axis-motion axes` prints the count, but you cannot yet write
`@50% instance "Bold"`.

**The `avar` table is ignored.** Fonts with an axis variation table remap user coordinates
non-linearly, so a value halfway between an axis minimum and maximum may not be halfway in design
space. None of the fonts on the development machine carries `avar`, so this has no effect here. It would
matter on a font that does.

**The CSS export assumes one span per glyph, in order.** It emits `:nth-child()` delay rules
against a container with class `.<name>` whose children carry class `.glyph`. Whitespace between
those spans in your HTML renders as extra space; the markup from `axis-motion page` avoids it.

**The scan only looks at the standard font directories.** Fonts inside application bundles,
`node_modules`, or a Wine prefix are not found.

## Layout

```
bin/axis-motion.js     CLI
src/fvar.js            OpenType fvar and name table reader
src/scan.js            walk system font directories, report which files have fvar
src/dsl.js             timeline parser, errors carry line and column
src/easing.js          cubic-bezier easing, the five CSS keywords
src/compile.js         validate a timeline against a real font, refuse or plan
src/emit-css.js        @keyframes export
src/emit-waapi.js      Web Animations API export
src/render-page.js     standalone preview page, used by the video exporter and tests
src/export-video.js    Chromium frames plus ffmpeg encoding
tools/build-docs.js    generate docs/index.html from a live font scan
test/                  79 tests, node:test
scripts/verify.sh      the whole thing
```

MIT licensed. Part of the 722 things to build catalog, task ART-026.
