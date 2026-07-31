'use strict';
// Web Animations API export.
//
// Produces plain data, one entry per glyph, ready for
//   el.animate(entry.keyframes, entry.options)
// Nothing here touches the DOM, so it can be produced in Node, serialised to
// JSON, and replayed in a browser. test/browser.test.js does exactly that and
// reads getComputedStyle(el).fontVariationSettings back out.

const { easingToCss } = require('./easing');
const { variationSettings } = require('./emit-css');

function emitWaapi(plan) {
  const keyframes = plan.keyframes.map((kf) => ({
    offset: Math.round(kf.offset * 1e6) / 1e6,
    fontVariationSettings: variationSettings(kf.values, plan.axesUsed),
    easing: easingToCss(kf.easing),
  }));
  return {
    name: plan.name,
    text: plan.text,
    glyphs: plan.glyphs,
    fontFile: plan.font.file,
    fontFamily: plan.font.family,
    axesUsed: plan.axesUsed,
    duration: plan.duration,
    stagger: plan.stagger,
    totalDuration: plan.totalDuration,
    // One animation per glyph. Same keyframes, different delay.
    animations: plan.glyphs.map((ch, i) => ({
      glyph: ch,
      index: i,
      keyframes,
      options: {
        duration: plan.duration,
        delay: plan.delays[i],
        easing: easingToCss(plan.defaultEasing),
        fill: 'both',
        iterations: 1,
      },
    })),
  };
}

/** Deterministic JSON, keys in insertion order which is fixed by the code above. */
function emitWaapiJson(plan) {
  return JSON.stringify(emitWaapi(plan), null, 2) + '\n';
}

module.exports = { emitWaapi, emitWaapiJson };
