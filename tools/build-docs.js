#!/usr/bin/env node
'use strict';
// Generate docs/index.html.
//
// The axis table on that page is produced from a live scan of this machine's
// fonts, not typed by hand, so it cannot drift away from what the parser
// actually reads. scripts/verify.sh regenerates the page and fails if the
// committed copy differs.
//
// The page embeds no font. See the "About the type on this page" section in
// the output for why, and README.md "Limitations".

const fs = require('fs');
const path = require('path');
const { scanFonts } = require('../src/scan');
const { parseTimeline, GRAMMAR } = require('../src/dsl');
const { compile } = require('../src/compile');
const { emitCss } = require('../src/emit-css');
const { emitWaapi } = require('../src/emit-waapi');
const { UnknownAxisError, AxisRangeError } = require('../src/compile');

const ROOT = path.resolve(__dirname, '..');

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function refusalExample(source) {
  try {
    compile(parseTimeline(source), { baseDir: ROOT });
    return 'no error, which would be a bug in this example';
  } catch (err) {
    return err.message;
  }
}

function build() {
  const scan = scanFonts();
  const distinct = new Map();
  for (const v of scan.variable) {
    if (!distinct.has(v.realPath)) distinct.set(v.realPath, { ...v, aliases: [] });
    else distinct.get(v.realPath).aliases.push(path.basename(v.file));
  }
  const allTags = [...new Set(scan.variable.flatMap((v) => v.axes.map((a) => a.tag)))].sort();

  const timelineSrc = fs.readFileSync(path.join(ROOT, 'examples/wide-to-narrow.tl'), 'utf8');
  const plan = compile(parseTimeline(timelineSrc), { baseDir: ROOT });
  const css = emitCss(plan);
  const waapi = emitWaapi(plan);

  const rows = [...distinct.values()]
    .map((v) => {
      const axes = v.axes
        .map(
          (a) =>
            `<code>${esc(a.tag)}</code> <span class="rng">${a.min} to ${a.max}, default ${a.default}</span>`
        )
        .join('<br>');
      return `<tr>
        <th scope="row"><code>${esc(path.basename(v.realPath))}</code>
          <span class="fam">${esc(v.family || 'no family name')}</span>
          ${v.aliases.length ? `<span class="alias">${v.aliases.length} symlink${v.aliases.length === 1 ? '' : 's'} point here</span>` : ''}
        </th>
        <td>${axes}</td>
        <td class="n">${v.instanceCount}</td>
      </tr>`;
    })
    .join('\n');

  const unknownAxis = refusalExample(
    `font ${plan.font.file}\ntext "A"\nduration 1s\n@0% opsz 8\n@100% opsz 40`
  );
  const outOfRange = refusalExample(
    `font ${plan.font.file}\ntext "A"\nduration 1s\n@0% wght 400\n@100% wght 900`
  );

  const html = `<!doctype html>
<html lang="en" data-scanned-files="${scan.scanned}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>axis-motion</title>
<meta name="description" content="Animate OpenType variable font axes from a small timeline DSL, with exports to CSS, the Web Animations API and video.">
<style>
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --fg: #16181d; --dim: #5b6069; --line: #dcdcd6;
  --card: #ffffff; --accent: #7a3bd6; --code-bg: #f2f2ee; --warn-bg: #fdf6e3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101116; --fg: #e9e9ee; --dim: #9a9fab; --line: #2b2d36;
    --card: #171922; --accent: #b28cf5; --code-bg: #1c1f29; --warn-bg: #241f10;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #fbfbfa; --fg: #16181d; --dim: #5b6069; --line: #dcdcd6;
  --card: #ffffff; --accent: #7a3bd6; --code-bg: #f2f2ee; --warn-bg: #fdf6e3;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101116; --fg: #e9e9ee; --dim: #9a9fab; --line: #2b2d36;
  --card: #171922; --accent: #b28cf5; --code-bg: #1c1f29; --warn-bg: #241f10;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: "Ubuntu Sans", Ubuntu, "Segoe UI Variable Text", system-ui, sans-serif;
  line-height: 1.55; font-size: 16px;
  -webkit-text-size-adjust: 100%;
}
.wrap { max-width: 62rem; margin: 0 auto; padding: 1.5rem 1rem 5rem; }
header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: baseline; justify-content: space-between; }
h1 { font-size: clamp(1.7rem, 6vw, 2.6rem); margin: 0; letter-spacing: -0.02em; }
h2 { font-size: 1.25rem; margin: 2.5rem 0 0.6rem; letter-spacing: -0.01em; }
h3 { font-size: 1rem; margin: 1.4rem 0 0.4rem; }
p, li { max-width: 62ch; }
.lede { color: var(--dim); margin-top: 0.35rem; }
a { color: var(--accent); }
code, pre, .mono { font-family: "Ubuntu Sans Mono", "Ubuntu Mono", ui-monospace, "Cascadia Mono", Menlo, monospace; }
code { background: var(--code-bg); padding: 0.08em 0.32em; border-radius: 4px; font-size: 0.9em; }
pre {
  background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
  padding: 0.85rem 1rem; overflow-x: auto; font-size: 0.85rem; line-height: 1.5;
}
pre code { background: none; padding: 0; font-size: inherit; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.1rem; margin-top: 1rem; }
.note { background: var(--warn-bg); border: 1px solid var(--line); border-radius: 8px; padding: 0.8rem 1rem; margin-top: 1rem; font-size: 0.93rem; }
.note strong { display: block; margin-bottom: 0.25rem; }
button {
  font: inherit; color: var(--fg); background: var(--card);
  border: 1px solid var(--line); border-radius: 7px; padding: 0.4rem 0.85rem; cursor: pointer;
}
button:hover { border-color: var(--accent); }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.controls { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-top: 0.9rem; }
.controls label { font-size: 0.85rem; color: var(--dim); display: flex; align-items: center; gap: 0.45rem; }
input[type="range"] { width: min(16rem, 100%); accent-color: var(--accent); }

#stage-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
#stage {
  margin: 0; padding: 1.5rem 1rem; white-space: pre; text-align: center;
  font-size: clamp(2rem, 11vw, 4.5rem); line-height: 1.15; letter-spacing: -0.01em;
  font-variation-settings: "wdth" 100, "wght" 100;
}
#stage .glyph { display: inline-block; white-space: pre; will-change: font-variation-settings; }
.readout { font-size: 0.8rem; color: var(--dim); margin-top: 0.5rem; }

table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
.scroller { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; margin-top: 0.8rem; }
th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: none; }
th[scope="row"] { font-weight: 600; min-width: 0; }
.fam, .alias { display: block; font-weight: 400; color: var(--dim); font-size: 0.82em; }
.rng { color: var(--dim); }
td.n, th.n { text-align: right; }
ul { padding-left: 1.15rem; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--dim); font-size: 0.85rem; }
#font-status { font-size: 0.9rem; }
#font-status .yes { color: var(--accent); font-weight: 600; }
@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto; }
}
</style>
</head>
<body>
<div class="wrap">

<header>
  <div>
    <h1>axis-motion</h1>
    <p class="lede">Animate OpenType variable font axes from a small timeline DSL. Exports to CSS <code>@keyframes</code>, the Web Animations API, and video.</p>
  </div>
  <button id="theme" type="button" aria-pressed="false">Theme: system</button>
</header>

<h2>Preview</h2>

<div id="stage-wrap">
  <div id="stage" class="axisWave" aria-label="${esc(plan.text)}"></div>
</div>

<div class="controls">
  <button id="play" type="button">Play</button>
  <label for="scrub">Scrub
    <input id="scrub" type="range" min="0" max="${waapi.totalDuration}" step="1" value="0">
  </label>
  <span class="readout mono" id="readout">t = 0 ms</span>
</div>
<p class="readout" id="font-status">Checking whether your browser has a variable font for this text.</p>

<div class="note">
  <strong>About the type on this page</strong>
  No font file is embedded here. Shipping a whole variable font would add roughly a megabyte to
  this page, and a subset small enough to inline would still be a font committed to a repository
  that says it does not commit fonts. So the preview uses a system font stack:
  <code>"Ubuntu Sans", Ubuntu, "Segoe UI Variable Text", system-ui, sans-serif</code>.
  What you see depends on the fonts your machine has. The line above reports what this browser
  actually managed, measured rather than assumed. The axis values in the timeline were validated
  against <code>${esc(path.basename(plan.font.file))}</code> on the machine that generated this
  page, which is where the numbers in the table below come from.
</div>

<h2>The axes on the machine that built this page</h2>
<p>
  Every number here was read out of each file's OpenType <code>fvar</code> table by
  <code>src/fvar.js</code>. The scan looked at ${scan.scanned} font files under the system font
  directories. ${scan.variable.length} of them carry an <code>fvar</code> table, but
  ${distinct.size} of those are the distinct files; the rest are symlinks with static sounding
  names such as <code>Ubuntu-B.ttf</code> pointing at the same variable file.
</p>
<div class="scroller">
<table>
  <caption class="readout" style="caption-side: bottom; text-align: left; padding: 0.5rem 0.7rem;">
    Distinct variable font files found on this machine, with the axes each one declares.
  </caption>
  <thead><tr><th scope="col">File</th><th scope="col">Axes from <code>fvar</code></th><th scope="col" class="n">Named instances</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</div>
<p>
  The complete set of axis tags present on this machine is
  ${allTags.map((t) => `<code>${esc(t)}</code>`).join(' and ')}.
  There is no <code>opsz</code>, no <code>ital</code>, no <code>slnt</code>, and no custom axis
  anywhere in this font set. That is worth stating plainly, because a tool that hardcodes the four
  common tags would look correct here and be wrong on the first font that carries a custom one.
  The parser reads whatever tags the table contains, and a test builds a synthetic font with
  <code>GRAD</code> and <code>XPRT</code> axes to prove it.
</p>

<h2>The timeline DSL</h2>
<p>One statement per line. Blank lines and lines starting with <code>#</code> are ignored.</p>
<pre><code>${esc(GRAMMAR)}</code></pre>

<h3>The timeline driving the preview above</h3>
<pre><code>${esc(timelineSrc.trim())}</code></pre>

<h3>What that compiles to</h3>
<pre><code>${esc(css.trim())}</code></pre>

<h2>What it refuses to do</h2>
<p>
  A browser handed <code>font-variation-settings: "opsz" 40</code> on a font with no optical size
  axis renders something and reports nothing. A value past an axis maximum is clamped just as
  quietly. The compiler checks both against the font's own <code>fvar</code> table and raises
  instead of emitting. These two messages are the real output of running those cases:
</p>
<pre><code>$ axis-motion css bad-axis.tl
refused: ${esc(unknownAxis)}

$ axis-motion css out-of-range.tl
refused: ${esc(outOfRange)}</code></pre>

<h2>Running it</h2>
<pre><code>node bin/axis-motion.js fonts                    # every font here with an fvar table
node bin/axis-motion.js axes &lt;font-file&gt;         # the axes one font declares
node bin/axis-motion.js css examples/wide-to-narrow.tl
node bin/axis-motion.js waapi examples/wide-to-narrow.tl
node bin/axis-motion.js video examples/wide-to-narrow.tl -o out/demo.mp4
bash scripts/verify.sh</code></pre>

<footer>
  <p>Part of the thousand catalog, task ART-026. MIT licensed. No third party code, no network
  requests, no analytics. This page is a single self-contained file.</p>
</footer>

</div>

<script id="waapi-data" type="application/json">${JSON.stringify(waapi).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById('waapi-data').textContent);
  var stage = document.getElementById('stage');
  var playBtn = document.getElementById('play');
  var scrub = document.getElementById('scrub');
  var readout = document.getElementById('readout');
  var status = document.getElementById('font-status');

  // Build one span per glyph.
  var nodes = [];
  for (var i = 0; i < data.glyphs.length; i++) {
    var span = document.createElement('span');
    span.className = 'glyph';
    span.textContent = data.glyphs[i];
    stage.appendChild(span);
    nodes.push(span);
  }

  // One WAAPI animation per glyph, straight from the exported spec.
  var anims = [];
  for (var j = 0; j < data.animations.length; j++) {
    var spec = data.animations[j];
    var a = nodes[spec.index].animate(spec.keyframes, spec.options);
    a.pause();
    a.currentTime = 0;
    anims.push(a);
  }
  window.axisMotionAnimations = anims;
  window.axisMotionTotal = data.totalDuration;

  function seek(t) {
    for (var k = 0; k < anims.length; k++) anims[k].currentTime = t;
    scrub.value = String(Math.round(t));
    readout.textContent = 't = ' + Math.round(t) + ' ms of ' + data.totalDuration;
  }
  window.axisMotionSeek = seek;

  var playing = false;
  var rafId = null;
  var startedAt = 0;

  function tick(now) {
    var t = (now - startedAt) % data.totalDuration;
    seek(t);
    rafId = requestAnimationFrame(tick);
  }
  function play() {
    if (playing) return;
    playing = true;
    playBtn.textContent = 'Pause';
    playBtn.setAttribute('aria-pressed', 'true');
    startedAt = performance.now() - Number(scrub.value);
    rafId = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    playBtn.textContent = 'Play';
    playBtn.setAttribute('aria-pressed', 'false');
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }
  window.axisMotionIsPlaying = function () { return playing; };

  playBtn.addEventListener('click', function () { playing ? pause() : play(); });
  scrub.addEventListener('input', function () {
    if (playing) pause();
    seek(Number(scrub.value));
  });

  seek(0);

  // prefers-reduced-motion: show the first frame and wait to be asked.
  // Otherwise start moving, and stop the moment the preference changes.
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  window.axisMotionReducedMotion = mq.matches;
  if (!mq.matches) play();
  mq.addEventListener('change', function (e) {
    window.axisMotionReducedMotion = e.matches;
    if (e.matches) pause();
  });

  // Honest font report: measure, do not assume. If the rendered font has a
  // weight axis, the same string at wght 100 and wght 700 has different
  // widths. font-variation-settings never triggers synthetic bolding, so a
  // static fallback gives identical widths.
  function detect() {
    var probe = document.createElement('span');
    probe.textContent = data.text;
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;white-space:pre;font-size:64px;' +
      'font-family:' + getComputedStyle(stage).fontFamily;
    document.body.appendChild(probe);
    probe.style.fontVariationSettings = '"wght" 100';
    var thin = probe.getBoundingClientRect().width;
    probe.style.fontVariationSettings = '"wght" 700';
    var thick = probe.getBoundingClientRect().width;
    probe.style.fontVariationSettings = '"wdth" 75';
    var narrow = probe.getBoundingClientRect().width;
    probe.style.fontVariationSettings = '"wdth" 100';
    var full = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    return {
      wght: Math.abs(thick - thin) > 0.5,
      wdth: Math.abs(full - narrow) > 0.5,
      widths: [thin, thick, narrow, full]
    };
  }

  function report() {
    var d = detect();
    window.axisMotionFontReport = d;
    var have = [];
    if (d.wght) have.push('weight');
    if (d.wdth) have.push('width');
    if (have.length === 2) {
      status.innerHTML = '<span class="yes">Your browser resolved a variable font with a weight ' +
        'and a width axis for this text.</span> The preview above is really varying both.';
    } else if (have.length === 1) {
      status.innerHTML = '<span class="yes">Your browser resolved a variable font with a ' +
        have[0] + ' axis</span> and no ' + (d.wght ? 'width' : 'weight') +
        ' axis, so only that one axis moves here.';
    } else {
      status.textContent = 'Measured: the font your browser chose for this text has no variation ' +
        'axes, so the preview above is not moving. Nothing is broken and no font was loaded ' +
        'behind your back. Install Ubuntu Sans, or any variable font, to see it animate.';
    }
    window.axisMotionReady = true;
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(report);
  else report();

  // Theme control cycles system, light, dark and overrides the media query
  // in both directions.
  var themeBtn = document.getElementById('theme');
  var modes = ['system', 'light', 'dark'];
  var mode = 0;
  themeBtn.addEventListener('click', function () {
    mode = (mode + 1) % modes.length;
    var m = modes[mode];
    if (m === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
    themeBtn.textContent = 'Theme: ' + m;
    themeBtn.setAttribute('aria-pressed', m === 'system' ? 'false' : 'true');
  });
})();
</script>
</body>
</html>
`;
  return html;
}

if (require.main === module) {
  const out = path.join(ROOT, 'docs', 'index.html');
  const html = build();
  const changed = !fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== html;
  if (process.argv.includes('--check')) {
    if (changed) {
      process.stderr.write('docs/index.html is out of date, run tools/build-docs.js\n');
      process.exit(1);
    }
    process.stdout.write('docs/index.html matches a fresh build\n');
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  process.stdout.write(`wrote docs/index.html, ${Buffer.byteLength(html)} bytes${changed ? '' : ' (unchanged)'}\n`);
}

module.exports = { build };
