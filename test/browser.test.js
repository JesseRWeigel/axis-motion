'use strict';
// Browser checks, in a real Chromium.
//
// Two things happen here that unit tests cannot do.
//
// 1. The WAAPI export is handed to element.animate(), the animation is seeked
//    to several timeline points, and getComputedStyle(el).fontVariationSettings
//    is read back and compared against numbers written by hand in this file.
//    The expected values are arithmetic on a linear timeline, derived from the
//    timeline text rather than from src/compile.js, so a bug in the compiler
//    cannot make both sides agree.
//
// 2. docs/index.html is loaded and measured: no horizontal body overflow at
//    390px, both themes reachable, reduced motion respected, script actually
//    executed.
//
// The server binds port 0 so it cannot collide with another agent's server,
// and every evaluate() asserts document.title first, because the Playwright
// browser is shared across agents in this workspace and could be navigated
// away mid-check.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { parseTimeline } = require('../src/dsl');
const { compile } = require('../src/compile');
const { emitWaapi } = require('../src/emit-waapi');
const { renderPage } = require('../src/render-page');

const ROOT = path.resolve(__dirname, '..');
// Ordinary places first. Resolving only a SIBLING project works in the directory it was written
// in and nowhere else. PLAYWRIGHT_CORE is honoured as well as the project-specific name, because
// every other project in this catalog uses that one and a reader should not have to guess.
//
// Note how this fails when nothing is found: the throw is at module scope, so the FILE does not
// load and its 11 tests never register. The suite then reports 68 passing with zero failures,
// which is the silent-skip problem at file granularity. The count assertion in verify.sh is what
// catches it, and is the reason that assertion exists.
const CANDIDATES = [
  process.env.AXIS_MOTION_PLAYWRIGHT,
  process.env.PLAYWRIGHT_CORE,
  path.resolve(ROOT, 'node_modules', 'playwright-core'),
  'playwright-core',
  'playwright',
  path.resolve(ROOT, '..', 'a11y-sweep', 'node_modules', 'playwright-core'),
].filter(Boolean);

let chromium;
let tried = [];
for (const c of CANDIDATES) {
  try { chromium = require(c).chromium; break; } catch (e) { tried.push(c); }
}
if (!chromium) {
  // A missing browser is "could not verify", never "verified". Fail loudly and usefully.
  throw new Error(
    'browser tests need playwright-core and none was found.\n'
    + 'To run them:  npm install --no-save playwright-core && npx playwright install chromium\n'
    + 'Or point at an existing install with PLAYWRIGHT_CORE=/path/to/playwright-core\n'
    + `Tried: ${tried.join(', ')}`
  );
}

// The timeline the numeric assertions are written against. Linear easing and
// a single axis, so every expected value below is plain arithmetic.
const LINEAR_TL = path.join(ROOT, 'examples/linear-wght.tl');

function serve(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const body = routes[url === '/' ? '/index.html' : url];
      if (body === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      const isFont = Buffer.isBuffer(body);
      res.writeHead(200, {
        'content-type': isFont ? 'font/ttf' : 'text/html; charset=utf-8',
      });
      res.end(body);
    });
    // Port 0 asks the kernel for a free port. Nothing is assumed about 8080.
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

/** Parse `"wdth" 87.5, "wght" 450` into a plain object. */
function parseFvs(str) {
  if (!str || str === 'normal') return null;
  const out = {};
  for (const part of str.split(',')) {
    const m = /^\s*"([^"]{4})"\s+(-?[\d.]+)\s*$/.exec(part);
    if (!m) throw new Error(`could not parse computed font-variation-settings: ${str}`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

test('browser checks', { concurrency: 1 }, async (t) => {
  const plan = compile(parseTimeline(fs.readFileSync(LINEAR_TL, 'utf8')), { baseDir: ROOT });
  const waapi = emitWaapi(plan);
  // The harness is served over http, so the font has to be served too. It is
  // read from the system font path at test time and never copied into the
  // repository.
  const harness = renderPage(plan, {
    title: 'axis-motion waapi harness',
    fontUrl: '/font.ttf',
  });
  const docs = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');

  const { server, port } = await serve({
    '/index.html': docs,
    '/harness.html': harness,
    '/font.ttf': fs.readFileSync(plan.font.file),
  });
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    await t.test('the server serves this project, checked by content not status', async () => {
      const r = await get(`${base}/index.html`);
      assert.equal(r.status, 200);
      // Asserting on content, because a 200 can come from somebody else's
      // stale server on a port you assumed was yours.
      assert.ok(r.body.includes('<title>axis-motion</title>'), 'served page is not axis-motion');
      assert.ok(r.body.includes('The timeline DSL'), 'served page is missing a known section');
      const h = await get(`${base}/harness.html`);
      assert.ok(h.body.includes('axis-motion waapi harness'), 'harness page content is wrong');
    });

    await t.test('WAAPI export: computed font-variation-settings matches the timeline', async () => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
      await page.goto(`${base}/harness.html`);
      await page.waitForFunction('window.axisMotionReady === true');

      // examples/linear-wght.tl: text "ABC", duration 1000ms, stagger 200ms,
      // linear easing, wght 100 at 0% and wght 800 at 100%.
      // Glyph i starts at i*200ms. At absolute time t the local progress for
      // glyph i is clamp((t - 200i) / 1000, 0, 1) and the weight is
      // 100 + 700 * progress. Every number below was worked out that way and
      // written here by hand.
      const cases = [
        { t: 0, expect: [100, 100, 100] },
        { t: 200, expect: [240, 100, 100] },
        { t: 500, expect: [450, 310, 170] },
        { t: 700, expect: [590, 450, 310] },
        { t: 1000, expect: [800, 660, 520] },
        { t: 1200, expect: [800, 800, 660] },
        { t: 1400, expect: [800, 800, 800] },
      ];

      const measured = await page.evaluate((times) => {
        // Page identity, checked inside the evaluation. The browser is shared
        // across agents here and could have been navigated elsewhere.
        if (document.title !== 'axis-motion waapi harness') {
          throw new Error('wrong page in the browser: ' + document.title);
        }
        const nodes = document.querySelectorAll('#stage > .glyph');
        const rows = [];
        for (const t of times) {
          window.axisMotionSeek(t);
          const row = [];
          for (const n of nodes) row.push(getComputedStyle(n).fontVariationSettings);
          rows.push({ t, row });
        }
        return { title: document.title, rows };
      }, cases.map((c) => c.t));

      assert.equal(measured.title, 'axis-motion waapi harness');
      assert.equal(measured.rows.length, cases.length);

      for (let i = 0; i < cases.length; i++) {
        const { t, expect } = cases[i];
        const row = measured.rows[i];
        assert.equal(row.t, t);
        assert.equal(row.row.length, 3, `expected 3 glyphs at t=${t}`);
        for (let g = 0; g < 3; g++) {
          const got = parseFvs(row.row[g]);
          assert.ok(got !== null, `glyph ${g} at t=${t}ms had no font-variation-settings`);
          assert.deepEqual(
            Object.keys(got),
            ['wght'],
            `glyph ${g} at t=${t}ms should carry only wght`
          );
          assert.ok(
            Math.abs(got.wght - expect[g]) < 0.75,
            `glyph ${g} at t=${t}ms: browser computed wght ${got.wght}, timeline says ${expect[g]}`
          );
        }
      }

      // Print the readback so verify output carries the evidence rather than
      // a claim that the evidence was checked.
      process.stdout.write('    browser-read fontVariationSettings vs timeline\n');
      for (let i = 0; i < cases.length; i++) {
        const got = measured.rows[i].row.map((s) => parseFvs(s).wght);
        process.stdout.write(
          `      t=${String(cases[i].t).padStart(4)}ms  read [${got.join(', ')}]` +
            `  expected [${cases[i].expect.join(', ')}]\n`
        );
      }

      // A control: if the assertions above passed because every reading is
      // the same number, this catches it.
      const distinct = new Set(
        measured.rows.flatMap((r) => r.row.map((s) => parseFvs(s).wght))
      );
      assert.ok(distinct.size >= 6, `expected many distinct weights, saw ${distinct.size}`);
      await page.close();
    });

    await t.test('the harness really loaded the variable font, measured not assumed', async () => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
      await page.goto(`${base}/harness.html`);
      await page.waitForFunction('window.axisMotionReady === true');
      const widths = await page.evaluate(() => {
        if (document.title !== 'axis-motion waapi harness') {
          throw new Error('wrong page: ' + document.title);
        }
        const n = document.querySelector('#stage > .glyph');
        window.axisMotionSeek(0);
        const thin = n.getBoundingClientRect().width;
        window.axisMotionSeek(1000);
        const thick = n.getBoundingClientRect().width;
        return { thin, thick, title: document.title };
      });
      assert.equal(widths.title, 'axis-motion waapi harness');
      assert.ok(
        widths.thick > widths.thin + 0.5,
        `glyph should get wider from wght 100 to 800, measured ${widths.thin} then ${widths.thick}`
      );
      await page.close();
    });

    await t.test('the docs page animates for real, and its font report is true', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/index.html`);
      await page.waitForFunction('window.axisMotionReady === true');
      const r = await page.evaluate(() => {
        if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
        const glyphs = document.querySelectorAll('#stage > .glyph');
        const read = (t) => {
          window.axisMotionSeek(t);
          const cs = getComputedStyle(glyphs[0]);
          return {
            fvs: cs.fontVariationSettings,
            weight: cs.fontWeight,
            stretch: cs.fontStretch,
            width: glyphs[0].getBoundingClientRect().width,
          };
        };
        const start = read(0);
        const mid = read(600);
        window.axisMotionSeek(0);
        return {
          title: document.title,
          glyphCount: glyphs.length,
          animations: (window.axisMotionAnimations || []).length,
          mode: window.axisMotionMode,
          report: window.axisMotionFontReport,
          start,
          mid,
          text: document.getElementById('stage').textContent,
          statusText: document.getElementById('font-status').textContent,
        };
      });
      assert.equal(r.title, 'axis-motion');
      // The spans exist only because the inline script ran. A page whose
      // script failed to parse would render as static HTML with zero glyphs.
      assert.equal(r.glyphCount, 11, 'expected one span per glyph of "Axis Motion"');
      assert.equal(r.animations, 11);
      assert.equal(r.text, 'Axis Motion');
      assert.ok(r.statusText.length > 40, 'the font status line should have been filled in');
      assert.ok(
        !/Checking whether/.test(r.statusText),
        'the font status line still shows its placeholder'
      );

      // The page picks one of three modes by measuring. Whichever it picked
      // has to agree with the measurements it recorded, and the two motion
      // modes have to produce visible motion.
      assert.ok(
        ['font-variation-settings', 'font-weight', 'static'].includes(r.mode),
        `unexpected mode ${r.mode}`
      );
      const fvsWorks = r.report.fvsWght || r.report.fvsWdth;
      const cssWorks = r.report.cssWght || r.report.cssWdth;
      if (r.mode === 'font-variation-settings') {
        assert.ok(fvsWorks, 'claimed font-variation-settings mode without measuring it working');
        assert.notEqual(r.start.fvs, r.mid.fvs, 'the animation should change values over time');
        assert.match(r.mid.fvs, /"wght" \d/);
      } else if (r.mode === 'font-weight') {
        assert.equal(fvsWorks, false, 'fell back while font-variation-settings actually worked');
        assert.ok(cssWorks, 'claimed the css properties work without measuring it');
        assert.notEqual(r.start.weight, r.mid.weight, 'font-weight should change over time');
        assert.ok(
          Math.abs(r.start.width - r.mid.width) > 0.5,
          `the glyph should visibly change, measured ${r.start.width} then ${r.mid.width}`
        );
        assert.ok(
          r.statusText.includes('ignores'),
          'the page should say plainly that font-variation-settings is being ignored'
        );
      } else {
        assert.equal(fvsWorks, false);
        assert.equal(cssWorks, false);
        assert.ok(
          r.statusText.includes('not') && r.statusText.includes('moving'),
          'a static page must say so'
        );
      }
      // The report is a measurement, so its raw widths must back it up.
      assert.equal(
        Math.abs(r.report.widths.fvs[0] - r.report.widths.fvs[1]) > 0.5,
        !!r.report.fvsWght,
        'the fvs weight verdict disagrees with the widths it was derived from'
      );
      assert.equal(
        Math.abs(r.report.widths.css[0] - r.report.widths.css[1]) > 0.5,
        !!r.report.cssWght,
        'the css weight verdict disagrees with the widths it was derived from'
      );
      process.stdout.write(
        `    docs page animation mode on this Chromium: ${r.mode}\n` +
          `      font-variation-settings widths ${JSON.stringify(r.report.widths.fvs)}\n` +
          `      font-weight/stretch widths     ${JSON.stringify(r.report.widths.css)}\n`
      );
      await page.close();
    });

    await t.test('the docs page axis table matches a fresh scan of this machine', async () => {
      const { scanFonts } = require('../src/scan');
      const scan = scanFonts();
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/index.html`);
      const table = await page.evaluate(() => {
        if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
        return {
          title: document.title,
          rows: [...document.querySelectorAll('tbody tr')].map((tr) => ({
            file: tr.querySelector('th code').textContent,
            axes: [...tr.querySelectorAll('td code')].map((c) => c.textContent),
          })),
        };
      });
      assert.equal(table.title, 'axis-motion');
      const distinct = new Map();
      for (const v of scan.variable) {
        if (!distinct.has(v.realPath)) distinct.set(v.realPath, v);
      }
      assert.equal(table.rows.length, distinct.size, 'row count differs from the live scan');
      for (const row of table.rows) {
        const match = [...distinct.values()].find((v) => v.realPath.endsWith('/' + row.file));
        assert.ok(match, `page lists ${row.file}, which the scan did not find`);
        assert.deepEqual(
          row.axes,
          match.axes.map((a) => a.tag),
          `axes for ${row.file} differ from the fvar table`
        );
      }
      await page.close();
    });

    await t.test('no horizontal body overflow at 390px', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
      await page.goto(`${base}/index.html`);
      await page.waitForFunction('window.axisMotionReady === true');
      const r = await page.evaluate(() => {
        if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
        const root = document.documentElement;
        // Walk elements and find anything whose right edge escapes the page,
        // ignoring content that scrolls inside its own container, which is
        // correct. No overflow-x: hidden is used anywhere, which would mask
        // the bug and make this probe vacuous.
        const limit = root.clientWidth;
        const bad = [];
        const all = document.body.querySelectorAll('*');
        for (const el of all) {
          let a = el.parentElement;
          let scrolls = false;
          while (a) {
            const ox = getComputedStyle(a).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
              scrolls = true;
              break;
            }
            a = a.parentElement;
          }
          if (scrolls) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > limit + 0.5) {
            bad.push({
              tag: el.tagName.toLowerCase(),
              cls: el.className && String(el.className).slice(0, 40),
              right: Math.round(r.right),
            });
          }
        }
        return {
          title: document.title,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          bodyOverflowX: getComputedStyle(document.body).overflowX,
          htmlOverflowX: getComputedStyle(root).overflowX,
          bad,
        };
      });
      assert.equal(r.title, 'axis-motion');
      assert.equal(r.clientWidth, 390);
      assert.notEqual(r.bodyOverflowX, 'hidden', 'body must not hide overflow');
      assert.notEqual(r.htmlOverflowX, 'hidden', 'html must not hide overflow');
      assert.deepEqual(r.bad, [], `elements escaping the page: ${JSON.stringify(r.bad)}`);
      assert.ok(
        r.scrollWidth <= r.clientWidth,
        `root scrollWidth ${r.scrollWidth} exceeds clientWidth ${r.clientWidth}`
      );
      await page.close();
    });

    await t.test('light and dark both render, and data-theme overrides both ways', async () => {
      const results = {};
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 900, height: 700 } });
        await page.goto(`${base}/index.html`);
        const r = await page.evaluate(() => {
          if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
          const read = () => ({
            bg: getComputedStyle(document.body).backgroundColor,
            fg: getComputedStyle(document.body).color,
          });
          const media = read();
          document.documentElement.setAttribute('data-theme', 'light');
          const forcedLight = read();
          document.documentElement.setAttribute('data-theme', 'dark');
          const forcedDark = read();
          document.documentElement.removeAttribute('data-theme');
          return { title: document.title, media, forcedLight, forcedDark };
        });
        assert.equal(r.title, 'axis-motion');
        results[scheme] = r;
        await page.close();
      }
      // The media query alone must produce different colours.
      assert.notDeepEqual(
        results.light.media,
        results.dark.media,
        'prefers-color-scheme made no difference'
      );
      // data-theme must win in both directions: forcing dark inside a light
      // preference, and forcing light inside a dark preference.
      assert.deepEqual(results.light.forcedDark, results.dark.media, 'data-theme="dark" did not override a light preference');
      assert.deepEqual(results.dark.forcedLight, results.light.media, 'data-theme="light" did not override a dark preference');
      assert.notDeepEqual(results.light.forcedLight, results.light.forcedDark);
    });

    await t.test('prefers-reduced-motion: no autoplay, and the play control still works', async () => {
      const reduced = await browser.newPage({
        reducedMotion: 'reduce',
        viewport: { width: 900, height: 700 },
      });
      await reduced.goto(`${base}/index.html`);
      await reduced.waitForFunction('window.axisMotionReady === true');
      const r = await reduced.evaluate(() => {
        if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
        return {
          title: document.title,
          matched: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          reportedReduced: window.axisMotionReducedMotion,
          playing: window.axisMotionIsPlaying(),
          scrub: document.getElementById('scrub').value,
          buttonLabel: document.getElementById('play').textContent,
          hasStaticFrame: getComputedStyle(document.querySelector('#stage > .glyph'))
            .fontVariationSettings,
        };
      });
      assert.equal(r.title, 'axis-motion');
      assert.equal(r.matched, true, 'the page was not actually loaded with reduced motion');
      assert.equal(r.reportedReduced, true);
      assert.equal(r.playing, false, 'motion autoplayed despite prefers-reduced-motion');
      assert.equal(r.scrub, '0', 'the static preview should sit at the first frame');
      assert.equal(r.buttonLabel, 'Play');
      assert.ok(/"wdth"|"wght"/.test(r.hasStaticFrame), 'a static first frame should still be set');

      // The control must still work when asked for.
      await reduced.click('#play');
      const after = await reduced.evaluate(() => {
        if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
        return { title: document.title, playing: window.axisMotionIsPlaying() };
      });
      assert.equal(after.title, 'axis-motion');
      assert.equal(after.playing, true, 'the play control did nothing');
      await reduced.close();

      // Control: without the preference the page does start moving, so the
      // assertion above is not passing because nothing ever autoplays.
      const normal = await browser.newPage({
        reducedMotion: 'no-preference',
        viewport: { width: 900, height: 700 },
      });
      await normal.goto(`${base}/index.html`);
      await normal.waitForFunction('window.axisMotionReady === true');
      const n = await normal.evaluate(() => {
        if (document.title !== 'axis-motion') throw new Error('wrong page: ' + document.title);
        return { title: document.title, playing: window.axisMotionIsPlaying() };
      });
      assert.equal(n.title, 'axis-motion');
      assert.equal(n.playing, true, 'the page should animate when motion is not restricted');
      await normal.close();
    });

    await t.test('the docs page requests nothing from the network', async () => {
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      const requests = [];
      page.on('request', (req) => requests.push(req.url()));
      await page.goto(`${base}/index.html`);
      await page.waitForFunction('window.axisMotionReady === true');
      const title = await page.evaluate(() => document.title);
      assert.equal(title, 'axis-motion');
      const external = requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:'));
      assert.deepEqual(external, [], `page made external requests: ${external.join(', ')}`);
      assert.equal(requests.length, 1, `expected exactly one request, saw ${requests.length}`);
      await page.close();
    });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
