'use strict';
// Build a standalone HTML page that renders a plan's text with the real font
// loaded from a local file URL. Used by the video exporter and by the browser
// test. Not shipped as a deliverable page; docs/index.html is separate and
// embeds no font.

const path = require('path');
const { emitWaapi } = require('./emit-waapi');

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * @param {object} plan compiled plan
 * @param {object} opts { fontSize, background, color, width, height, title }
 */
function renderPage(plan, opts = {}) {
  const o = {
    fontSize: 96,
    background: '#0e0f12',
    color: '#f4f4f5',
    width: 960,
    height: 320,
    title: `axis-motion render: ${plan.name}`,
    ...opts,
  };
  const waapi = emitWaapi(plan);
  const fontUrl = 'file://' + plan.font.file.split('/').map(encodeURIComponent).join('/');
  const glyphs = plan.glyphs
    .map((ch) => `<span class="glyph">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(o.title)}</title>
<style>
@font-face {
  font-family: "axis-motion-target";
  src: url("${fontUrl}");
  font-weight: 1 1000;
  font-stretch: 1% 1000%;
}
html, body { margin: 0; padding: 0; }
body {
  width: ${o.width}px; height: ${o.height}px;
  background: ${o.background}; color: ${o.color};
  display: flex; align-items: center; justify-content: center;
  font-family: "axis-motion-target";
  font-size: ${o.fontSize}px;
  font-variation-settings: normal;
}
#stage { white-space: pre; }
#stage > .glyph { display: inline-block; white-space: pre; }
</style></head>
<body>
<div id="stage" class="${plan.name}">${glyphs}</div>
<script id="waapi" type="application/json">${JSON.stringify(waapi).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('waapi').textContent);
  var nodes = document.querySelectorAll('#stage > .glyph');
  window.axisMotionAnimations = [];
  for (var i = 0; i < data.animations.length; i++) {
    var spec = data.animations[i];
    var a = nodes[spec.index].animate(spec.keyframes, spec.options);
    a.pause();
    a.currentTime = 0;
    window.axisMotionAnimations.push(a);
  }
  window.axisMotionSeek = function (t) {
    for (var i = 0; i < window.axisMotionAnimations.length; i++) {
      window.axisMotionAnimations[i].currentTime = t;
    }
    return document.timeline ? t : t;
  };
  window.axisMotionReady = true;
  window.axisMotionTotal = data.totalDuration;
})();
</script>
</body></html>
`;
}

module.exports = { renderPage, escapeHtml };
