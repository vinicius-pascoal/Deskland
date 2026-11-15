/* Deskland · núcleo compartilhado dos protótipos ASCII City / ASCII Starship Bridge. */
(function () {
  'use strict';

  var mode = document.body.dataset.mode === 'starship' ? 'starship' : 'city';
  var qs = new URLSearchParams(location.search);
  var WALL = qs.has('wallpaper'), PREVIEW = qs.has('preview');
  var cv = document.getElementById('art'), ctx = cv.getContext('2d', { alpha: false });
  var W = innerWidth, H = innerHeight, DPR = 1, icons = [], windowRects = [], screens = [];
  var paused = false, seed = 20261115, last = 0, frameN = 0, fps = 0;
  var stats = { cpu: 0, mem: 0, rx: 0, tx: 0, bat: -1, ac: true, procs: 0 };
  var track = null, audioOff = null, mediaOff = null;
  var P = {
    palette: mode === 'city' ? 0 : 2, density: 0.72, speed: 1,
    audio: 1, media: 1, telemetry: 1, windowFx: 1, windowFxIntensity: .7
  };
  var DEFAULTS = Object.assign({}, P);
  var PALETTES = mode === 'city' ? [
    { bg: '#070b18', fg: '#72f6ff', hot: '#ff5fbe', dim: '#274866', mid: '#a7b9d6' },
    { bg: '#100b05', fg: '#ffc15c', hot: '#ff6e43', dim: '#624127', mid: '#e6c899' },
    { bg: '#070b12', fg: '#9ee7ff', hot: '#c29cff', dim: '#27405d', mid: '#c8d9ec' }
  ] : [
    { bg: '#050810', fg: '#8be9fd', hot: '#ff79c6', dim: '#233c5a', mid: '#b9c8df' },
    { bg: '#0c0805', fg: '#ffd580', hot: '#ff8a65', dim: '#61452b', mid: '#f0d6a4' },
    { bg: '#050c12', fg: '#a9f0ff', hot: '#7aa7ff', dim: '#24506a', mid: '#c6e6ef' }
  ];
  var AU = { level: 0, beat: 0, bass: 0, mid: 0, high: 0 };
  var palette = PALETTES[P.palette];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function hash(x, y, n) {
    var h = Math.imul((x | 0) ^ Math.imul((y | 0), 374761393) ^ Math.imul(n | 0, 668265263), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function font(size, bold) { return (bold ? 'bold ' : '') + size + 'px "Cascadia Mono", Consolas, "Courier New", monospace'; }
  function text(s, x, y, size, color, bold, align) {
    ctx.font = font(size || 14, !!bold); ctx.fillStyle = color || palette.fg; ctx.textAlign = align || 'left';
    ctx.fillText(String(s), x, y);
  }
  function line(x0, y0, x1, y1, color, width, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  function resize() {
    DPR = Math.max(1, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = Math.max(1, Math.round(W * DPR)); cv.height = Math.max(1, Math.round(H * DPR));
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function localRects(m) {
    var k = Math.max(1, devicePixelRatio || 1);
    return (m && Array.isArray(m.r) ? m.r : []).map(function (r) {
      return [r[0] / k, r[1] / k, r[2] / k, r[3] / k];
    });
  }
  function setPalette() { palette = PALETTES[clamp(Math.round(P.palette), 0, PALETTES.length - 1)]; }
  function applySettings(v) {
    v = v || {};
    Object.keys(P).forEach(function (k) { if (typeof v[k] === typeof P[k]) P[k] = v[k]; });
    P.palette = clamp(Math.round(P.palette), 0, PALETTES.length - 1);
    P.density = clamp(Number(P.density) || .72, 0, 1); P.speed = clamp(Number(P.speed) || 1, .25, 3);
    setPalette(); syncAudio(); syncMedia(); draw(performance.now());
    if (window.DesklandWindowEffects) window.DesklandWindowEffects.configure({ enabled: P.windowFx !== 0, intensity: P.windowFxIntensity });
  }
  function drawGrid(step, alpha) {
    ctx.strokeStyle = rgba(palette.dim, alpha); ctx.lineWidth = 1;
    for (var x = 0; x < W; x += step) line(x, 0, x, H, rgba(palette.dim, alpha), 1);
    for (var y = 0; y < H; y += step) line(0, y, W, y, rgba(palette.dim, alpha), 1);
  }
  function asciiBox(x, y, w, h, title, color) {
    var c = color || palette.fg; line(x, y, x + w, y, c, 1); line(x, y + h, x + w, y + h, c, 1);
    line(x, y, x, y + h, c, 1); line(x + w, y, x + w, y + h, c, 1);
    text('+' + '-'.repeat(Math.max(2, Math.floor(w / 9) - 2)) + '+', x, y + 10, 12, c, false);
    if (title) text('[ ' + title + ' ]', x + 8, y + 7, 11, c, true);
  }
  function iconLabel(i) { return mode === 'city' ? ['SHOP', 'NODE', 'CAFE', 'LAB'][i % 4] : ['ENG', 'NAV', 'COM', 'CORE'][i % 4]; }
  function drawCityBuilding(ic, i, t) {
    var x = ic.x + ic.w / 2, base = Math.min(H - 54, ic.y + ic.h + 22), w = 58 + (hash(ic.x, ic.y, 4) * 34), h = 62 + hash(ic.x, ic.y, 5) * 120;
    var top = Math.max(18, base - h), c = i % 3 === 0 ? palette.hot : palette.fg;
    ctx.fillStyle = rgba(palette.bg, .9); ctx.fillRect(x - w / 2, top, w, h);
    asciiBox(x - w / 2, top, w, h, iconLabel(i), rgba(c, .75));
    for (var yy = top + 22; yy < base - 8; yy += 19) for (var xx = x - w / 2 + 10; xx < x + w / 2 - 5; xx += 15)
      if (hash(xx, yy, i) < .42 + AU.level * .25) text(hash(xx, yy, i + 7) > .5 ? '[]' : '..', xx, yy, 10, c, false);
    text(i % 2 ? '/\\' : '|#|', x, top - 4, 11, c, true, 'center');
  }
  function drawCityWindow(r, i, t) {
    var x = r[0], y = r[1], w = r[2] - r[0], h = r[3] - r[1], c = i % 2 ? palette.fg : palette.hot;
    asciiBox(x, y, w, h, 'SECTOR ' + String(i + 1).padStart(2, '0'), rgba(c, .7));
    text(':: SIGNAL ' + (AU.level > .55 ? 'HIGH' : 'OK'), x + 10, y + 20, 11, c, false);
    text(':: ' + (stats.rx > 0 ? 'NET' : 'IDLE') + '  ' + Math.round(stats.rx / 1024) + 'K/s', x + 10, y + 36, 11, palette.mid, false);
  }
  function drawCity(t) {
    var grad = ctx.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, palette.bg); grad.addColorStop(1, '#02030a'); ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    drawGrid(64, .13); var horizon = H * .67;
    line(0, horizon, W, horizon, rgba(palette.fg, .28), 1);
    for (var i = 0; i < icons.length; i++) if (hash(icons[i].x, icons[i].y, 91) < .5 + P.density * .5) drawCityBuilding(icons[i], i, t);
    for (var j = 0; j < windowRects.length; j++) drawCityWindow(windowRects[j], j, t);
    for (var k = 0; k < icons.length - 1; k++) {
      var a = icons[k], b = icons[k + 1], ax = a[0] + a[2] / 2, ay = a[1] + a[3] / 2, bx = b[0] + b[2] / 2, by = b[1] + b[3] / 2;
      line(ax, ay, bx, by, rgba(palette.hot, .18), 1, [3, 8]);
      var p = ((t / 1400 * P.speed + k * .17) % 1); text('>', ax + (bx - ax) * p, ay + (by - ay) * p, 11, palette.hot, true);
    }
    drawHud(t, 'ASCII CITY // NIGHT GRID');
  }
  function drawStarshipModule(ic, i) {
    var x = ic.x + ic.w / 2, y = ic.y + ic.h / 2, r = 34 + hash(ic.x, ic.y, 2) * 24, c = i % 2 ? palette.fg : palette.hot;
    ctx.strokeStyle = rgba(c, .7); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    text('+---------+', x, y - 10, 11, c, true, 'center'); text('| ' + iconLabel(i) + '  |', x, y + 2, 11, c, true, 'center'); text('+---------+', x, y + 14, 11, c, true, 'center');
    line(x - r - 12, y, x - r, y, rgba(c, .5), 1); line(x + r, y, x + r + 12, y, rgba(c, .5), 1);
  }
  function drawStarshipWindow(r, i, t) {
    var x = r[0], y = r[1], w = r[2] - r[0], h = r[3] - r[1], c = i % 2 ? palette.hot : palette.fg;
    asciiBox(x, y, w, h, 'DECK-' + String(i + 1).padStart(2, '0'), rgba(c, .72));
    text('POWER ' + Math.round(100 - stats.cpu) + '%', x + 10, y + 20, 11, c, false);
    text('SHIELD ' + Math.round(100 - stats.mem) + '%', x + 10, y + 36, 11, palette.mid, false);
    text(AU.beat > .5 ? '!!! ALERT PULSE !!!' : '... SECTOR NOMINAL ...', x + 10, y + 52, 11, AU.beat > .5 ? palette.hot : palette.fg, true);
  }
  function drawStarship(t) {
    ctx.fillStyle = palette.bg; ctx.fillRect(0, 0, W, H); drawGrid(48, .15);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-.08); ctx.strokeStyle = rgba(palette.fg, .2); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-W * .45, 0); ctx.lineTo(-W * .12, -H * .24); ctx.lineTo(W * .38, -H * .12); ctx.lineTo(W * .47, 0); ctx.lineTo(W * .38, H * .12); ctx.lineTo(-W * .12, H * .24); ctx.closePath(); ctx.stroke(); ctx.restore();
    for (var i = 0; i < icons.length; i++) if (hash(icons[i].x, icons[i].y, 92) < .5 + P.density * .5) drawStarshipModule(icons[i], i);
    for (var j = 0; j < windowRects.length; j++) drawStarshipWindow(windowRects[j], j, t);
    var cx = W * .5, cy = H * .5, rr = 70 + AU.level * 24;
    ctx.strokeStyle = rgba(palette.hot, .35); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(palette.fg, .25); ctx.beginPath(); ctx.arc(cx, cy, rr * .55, -Math.PI / 2 + t / 1800 * P.speed, -Math.PI / 2 + t / 1800 * P.speed + AU.level * Math.PI * 2); ctx.stroke();
    text(AU.beat > .5 ? 'RADAR // CONTACT' : 'RADAR // CLEAR', cx, cy + 4, 12, AU.beat > .5 ? palette.hot : palette.fg, true, 'center');
    drawHud(t, 'STARSHIP BRIDGE // FLIGHT COMPUTER');
  }
  function drawHud(t, title) {
    var status = mode === 'city' ? 'TRAFFIC ' + Math.round((stats.rx + stats.tx) / 1024) + 'K/s' : 'ENERGY ' + Math.round(100 - stats.cpu) + '%';
    ctx.fillStyle = rgba(palette.bg, .82); ctx.fillRect(16, 14, Math.min(W - 32, 560), 54);
    asciiBox(16, 14, Math.min(W - 32, 560), 54, title, palette.fg);
    text(status + '   MEM ' + Math.round(stats.mem) + '%   ' + (track ? 'MEDIA LINK' : 'MEDIA IDLE'), 30, 48, 12, palette.mid, false);
    if (P.telemetry) {
      var x = Math.max(20, W - 265); ctx.fillStyle = rgba(palette.bg, .82); ctx.fillRect(x, 14, 245, 82); asciiBox(x, 14, 245, 82, 'TELEMETRY', palette.fg);
      text('CPU  [' + bar(stats.cpu) + '] ' + Math.round(stats.cpu) + '%', x + 12, 43, 11, palette.mid);
      text('MEM  [' + bar(stats.mem) + '] ' + Math.round(stats.mem) + '%', x + 12, 59, 11, palette.mid);
      text('MON  ' + (screens.length || 1) + '   ' + (P.audio ? 'AUDIO ON' : 'AUDIO OFF'), x + 12, 75, 11, palette.mid);
    }
    text((mode === 'city' ? 'NEWS> ' : 'COMMS> ') + (track ? track.title + ' / ' + track.artist : 'waiting for transmission...'), 24, H - 22, 12, palette.fg, false);
  }
  function bar(v) { var n = clamp(Math.round(v / 10), 0, 10); return '#'.repeat(n) + '.'.repeat(10 - n); }
  function stepAudio(now) {
    if (!audioOff || !P.audio) { AU.level *= .92; AU.beat *= .82; return; }
    var a = DesklandAudio.read(now); AU.bass = a.bass || 0; AU.mid = a.mid || 0; AU.high = a.high || 0; AU.level = clamp(Math.max(AU.bass * 1.2, AU.mid), 0, 1); if (a.beat) AU.beat = 1; AU.beat *= .9;
  }
  function syncAudio() {
    var want = P.audio === 1 && window.DesklandAudio;
    if (want && !audioOff) audioOff = DesklandAudio.subscribe(function () {});
    else if (!want && audioOff) { audioOff(); audioOff = null; AU.level = AU.beat = 0; }
  }
  function onMedia(m) { track = m && m.on ? { title: m.title || 'unknown track', artist: m.artist || 'unknown artist' } : null; }
  function syncMedia() {
    var want = P.media === 1 && window.DesklandMedia;
    if (want && !mediaOff) mediaOff = DesklandMedia.subscribe(onMedia);
    else if (!want && mediaOff) { mediaOff(); mediaOff = null; track = null; }
  }
  function frame(now) {
    requestAnimationFrame(frame); if (paused) { last = 0; return; }
    if (last && now - last < 31) return; var dt = last ? Math.min(.1, (now - last) / 1000) : .03; last = now; fps = fps ? fps * .95 + (1 / dt) * .05 : 1 / dt;
    stepAudio(now); draw(now); frameN++; window.frameN = frameN;
  }
  function draw(now) { if (mode === 'city') drawCity(now); else drawStarship(now); }
  function iconData(m) {
    icons.length = 0;
    if (m.vis) m.r.forEach(function (r) { icons.push({ x: r[0] / DPR, y: r[1] / DPR, w: (r[2] - r[0]) / DPR, h: (r[3] - r[1]) / DPR }); });
  }
  function handle(m) {
    if (!m) return;
    if (m.t === 'icons') { iconData(m); return; }
    if (m.t === 'windows') { windowRects = localRects(m); return; }
    if (m.t === 'screens') { screens = (m.all || []).map(function (r) { return r; }); return; }
    if (m.t === 'pause') { paused = PREVIEW ? false : !!m.v; return; }
    if (m.t === 'settings') { applySettings(m.v); return; }
    if (m.t === 'reset') { applySettings(DEFAULTS); return; }
    if (m.t === 'stats') { Object.keys(stats).forEach(function (k) { if (m[k] != null) stats[k] = Number(m[k]) || 0; }); return; }
    if (m.t === 'statsHist' && Array.isArray(m.list) && m.list.length) { handle(m.list[m.list.length - 1]); }
  }
  function startHosted() {
    document.body.classList.add('wall');
    if (PREVIEW) {
      document.body.classList.add('preview'); var g = document.createElement('div'); g.id = 'ghosts'; document.body.appendChild(g);
      addEventListener('message', function (e) { if (e.source === parent) { try { handle(typeof e.data === 'string' ? JSON.parse(e.data) : e.data); } catch (_) {} } });
      parent.postMessage(JSON.stringify({ t: 'ready' }), '*'); return;
    }
    var host = window.chrome && window.chrome.webview; if (!host) return;
    host.addEventListener('message', function (e) { try { handle(JSON.parse(e.data)); } catch (_) {} });
    host.postMessage('ready'); if (P.telemetry) host.postMessage('stats|on');
  }
  window.__dbg = { P: P, bench: function () { var a = performance.now(); draw(a); return { frame: +(performance.now() - a).toFixed(2), canvas: cv.width + 'x' + cv.height, fps: +fps.toFixed(1) }; } };
  window.asciiWorld = { applySettings: applySettings, setMode: function (v) { mode = v; } };
  window.cv = cv; window.draw = draw;
  Object.defineProperties(window, {
    icons: { configurable: true, get: function () { return icons; }, set: function (v) { icons = v; } },
    W: { configurable: true, get: function () { return W; } },
    H: { configurable: true, get: function () { return H; } },
    WALL: { configurable: true, get: function () { return WALL; } },
    paused: { configurable: true, get: function () { return paused; }, set: function (v) { paused = !!v; } },
    frameN: { configurable: true, get: function () { return frameN; } }
  });
  addEventListener('resize', resize); resize(); syncAudio(); syncMedia(); if (WALL || PREVIEW) startHosted(); else {
    icons.push({ x: W * .2, y: H * .45, w: 76, h: 92 }, { x: W * .5, y: H * .35, w: 76, h: 92 }, { x: W * .75, y: H * .52, w: 76, h: 92 });
  }
  requestAnimationFrame(frame);
})();
