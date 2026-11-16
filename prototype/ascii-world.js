/* Deskland · núcleo compartilhado de ASCII City / ASCII Starship Bridge.
   Tudo é desenhado numa grade de caracteres monoespaçados. A cena estática (céu, lua, prédios, rua,
   nebulosa, planeta, console, molduras do HUD) vai para um canvas de cache, refeito só quando mudam o
   tamanho, a paleta, a densidade ou os ícones. Cada quadro copia o cache e desenha por cima apenas o que
   se move: chuva, carros, letreiros, janelas piscando, estrelas em warp, radar, barras e o letreiro de
   notícias. */
(function () {
  'use strict';

  var mode = document.body.dataset.mode === 'starship' ? 'starship' : 'city';
  var qs = new URLSearchParams(location.search);
  var WALL = qs.has('wallpaper'), PREVIEW = qs.has('preview');
  var cv = document.getElementById('art'), ctx = cv.getContext('2d', { alpha: false });
  var cache = document.createElement('canvas'), cctx = cache.getContext('2d', { alpha: false });
  var W = innerWidth, H = innerHeight, DPR = 1, icons = [], screens = [];
  var paused = false, seed = 20261115, last = 0, lastDraw = 0, frameN = 0, fps = 0, dirty = true, scene = null;
  var stats = { cpu: 0, mem: 0, rx: 0, tx: 0, bat: -1, ac: true, procs: 0 };
  var track = null, audioOff = null, mediaOff = null;
  var P = {
    palette: mode === 'city' ? 0 : 2, density: 0.72, speed: 1,
    audio: 1, media: 1, telemetry: 1, windowFx: 1, windowFxIntensity: .7
  };
  var DEFAULTS = Object.assign({}, P);
  var PALETTES = mode === 'city' ? [
    { bg: '#05070f', sky: '#26134d', street: '#090b1a', far: '#11143a', near: '#070916', fg: '#72f6ff', hot: '#ff5fbe', warm: '#ffd166', mid: '#a7b9d6', rain: '#7fb8ff', moon: '#f4eed8' },
    { bg: '#0a0604', sky: '#4f2610', street: '#120a06', far: '#2c170a', near: '#0f0804', fg: '#ffc15c', hot: '#ff6e43', warm: '#ffe6b0', mid: '#e6c899', rain: '#e0b070', moon: '#fff1d0' },
    { bg: '#03070d', sky: '#123a5e', street: '#060c16', far: '#0f2440', near: '#040a13', fg: '#9ee7ff', hot: '#c29cff', warm: '#e8f4ff', mid: '#c8d9ec', rain: '#a8d4ff', moon: '#e8f6ff' }
  ] : [
    { bg: '#02040a', neb1: '#7445d6', neb2: '#1f86c4', hull: '#0a1020', fg: '#8be9fd', hot: '#ff79c6', warm: '#ffd580', mid: '#b9c8df', planet: '#ff9e7a', ring: '#ffd580' },
    { bg: '#070402', neb1: '#b9601f', neb2: '#86621f', hull: '#140c06', fg: '#ffd580', hot: '#ff8a65', warm: '#fff0c0', mid: '#f0d6a4', planet: '#ffb070', ring: '#fff0c0' },
    { bg: '#02070c', neb1: '#2276ab', neb2: '#4256c9', hull: '#081420', fg: '#a9f0ff', hot: '#7aa7ff', warm: '#e0fbff', mid: '#c6e6ef', planet: '#9fd8ff', ring: '#e0fbff' }
  ];
  var AU = { level: 0, beat: 0, bass: 0, mid: 0, high: 0 };
  var palette = PALETTES[P.palette];
  var FS = 14, CW = 8.4, CH = 16, COLS = 1, ROWS = 1, BOT = 0;   // BOT: última linha inteira visível
  var RAMP = ' .:-=+*#%@', TAU = Math.PI * 2;
  var SIGNS = ['HOTEL', 'BAR', '24H', 'RAMEN', 'CLUB', 'NET', 'ARCADE', 'SUSHI', 'MOTEL', 'JAZZ', 'CAFE'];

  // ---------------------------------------------------------------- utilidades
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  function hash(x, y, n) {
    var h = Math.imul((x | 0) ^ Math.imul((y | 0), 374761393) ^ Math.imul(n | 0, 668265263), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function rng(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var a = hash(xi, yi, 7), b = hash(xi + 1, yi, 7), c = hash(xi, yi + 1, 7), d = hash(xi + 1, yi + 1, 7);
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) { return vnoise(x, y) * .55 + vnoise(x * 2.1, y * 2.1) * .3 + vnoise(x * 4.3, y * 4.3) * .15; }
  function setFont(c, bold) {
    c.font = (bold ? 'bold ' : '') + FS + 'px "Cascadia Mono", Consolas, "Courier New", monospace';
    c.textBaseline = 'middle'; c.textAlign = 'left';
  }
  // Um caractere por célula (col/row podem ser fracionários); cada caractere separado mantém a grade alinhada.
  function put(c, ch, col, row, color) { if (color) c.fillStyle = color; c.fillText(ch, col * CW, row * CH + CH / 2); }
  function puts(c, s, col, row, color) {
    if (color) c.fillStyle = color;
    for (var i = 0; i < s.length; i++) if (s[i] !== ' ') c.fillText(s[i], (col + i) * CW, row * CH + CH / 2);
  }
  function putsPx(c, s, x, y, color) {
    if (color) c.fillStyle = color;
    for (var i = 0; i < s.length; i++) if (s[i] !== ' ') c.fillText(s[i], x + i * CW, y);
  }
  function panel(c, b, title, color) {
    c.fillStyle = rgba(palette.bg, .88); c.fillRect(b.col * CW, b.row * CH, b.w * CW, b.h * CH);
    var inner = title ? '═╡ ' + title + ' ╞' : '';
    var top = '╔' + (inner + '═'.repeat(Math.max(0, b.w))).slice(0, b.w - 2) + '╗';
    puts(c, top, b.col, b.row, color);
    for (var r = 1; r < b.h - 1; r++) { put(c, '║', b.col, b.row + r); put(c, '║', b.col + b.w - 1, b.row + r); }
    puts(c, '╚' + '═'.repeat(b.w - 2) + '╝', b.col, b.row + b.h - 1);
  }
  function bar(v, n) { var k = clamp(Math.round(v / 100 * n), 0, n); return '█'.repeat(k) + '░'.repeat(n - k); }
  function kb(v) { return v >= 1048576 ? (v / 1048576).toFixed(1) + 'M' : Math.round(v / 1024) + 'K'; }

  function resize() {
    DPR = Math.max(1, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = cache.width = Math.max(1, Math.round(W * DPR)); cv.height = cache.height = Math.max(1, Math.round(H * DPR));
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    FS = clamp(Math.round(H / 62), 11, 17);
    setFont(ctx); CW = ctx.measureText('M').width; CH = Math.round(FS * 1.2);
    COLS = Math.ceil(W / CW); ROWS = Math.ceil(H / CH); BOT = Math.max(0, Math.floor(H / CH) - 1);
    dirty = true;
  }
  function setPalette() { palette = PALETTES[clamp(Math.round(P.palette), 0, PALETTES.length - 1)]; }
  function applySettings(v) {
    v = v || {};
    Object.keys(P).forEach(function (k) { if (typeof v[k] === typeof P[k]) P[k] = v[k]; });
    P.palette = clamp(Math.round(P.palette), 0, PALETTES.length - 1);
    P.density = clamp(Number(P.density), 0, 1); if (!Number.isFinite(P.density)) P.density = .72;
    P.speed = clamp(Number(P.speed) || 1, .25, 3);
    setPalette(); syncAudio(); syncMedia(); dirty = true; draw(performance.now());
    if (window.DesklandWindowEffects) window.DesklandWindowEffects.configure({ enabled: P.windowFx !== 0, intensity: P.windowFxIntensity });
  }

  // ---------------------------------------------------------------- partes comuns
  function hudLayout() {
    var tw = Math.min(COLS - 4, 56);
    var tel = P.telemetry && COLS > tw + 40 ? { col: COLS - 34, row: 1, w: 32, h: 6 } : null;
    return { title: { col: 2, row: 1, w: tw, h: 3 }, tel: tel };
  }
  function buildHud(c) {
    var p = palette, L = hudLayout();
    setFont(c, true);
    panel(c, L.title, mode === 'city' ? 'ASCII CITY // NIGHT GRID' : 'STARSHIP BRIDGE // FLIGHT COMPUTER', rgba(p.fg, .85));
    if (L.tel) panel(c, L.tel, 'TELEMETRY', rgba(p.fg, .85));
    c.fillStyle = rgba(p.bg, .9); c.fillRect(0, BOT * CH, W, H - BOT * CH);
    puts(c, mode === 'city' ? ' NEWS ▸' : 'COMMS ▸', 1, BOT, p.hot);
    setFont(c);
  }
  function buildIcons(c) {
    var p = palette;
    icons.forEach(function (ic) {
      var c0 = Math.floor((ic.x - 3) / CW), c1 = Math.ceil((ic.x + ic.w + 3) / CW) - 1;
      var r0 = Math.floor((ic.y - 2) / CH), r1 = Math.ceil((ic.y + ic.h + 2) / CH) - 1;
      c.fillStyle = rgba(p.bg, .45); c.fillRect(c0 * CW, r0 * CH, (c1 - c0 + 1) * CW, (r1 - r0 + 1) * CH);
      var col = rgba(p.fg, .55);
      put(c, '┌', c0, r0, col); put(c, '┐', c1, r0); put(c, '└', c0, r1); put(c, '┘', c1, r1);
    });
  }
  function dynHud(t) {
    var p = palette, L = hudLayout(), s = t / 1000;
    setFont(ctx);
    var status = mode === 'city'
      ? 'TRAFFIC ' + kb(stats.rx + stats.tx) + '/s   MEM ' + Math.round(stats.mem) + '%   ' + (AU.level > .5 ? 'PULSE HIGH' : 'GRID STABLE')
      : 'ENERGY ' + Math.round(100 - stats.cpu) + '%   SHIELD ' + Math.round(100 - stats.mem) + '%   ' + (AU.beat > .5 ? 'CONTACT' : 'COURSE STEADY');
    puts(ctx, status.slice(0, L.title.w - 4), L.title.col + 2, L.title.row + 1, p.mid);
    if (L.tel) {
      var x = L.tel.col + 2, y = L.tel.row + 1, n = 14;
      puts(ctx, 'CPU', x, y, p.mid); puts(ctx, bar(stats.cpu, n), x + 5, y, p.fg); puts(ctx, String(Math.round(stats.cpu)).padStart(3) + '%', x + 6 + n, y, p.mid);
      puts(ctx, 'MEM', x, y + 1, p.mid); puts(ctx, bar(stats.mem, n), x + 5, y + 1, p.hot); puts(ctx, String(Math.round(stats.mem)).padStart(3) + '%', x + 6 + n, y + 1, p.mid);
      if (mode === 'city') puts(ctx, 'NET  ↓' + kb(stats.rx) + '  ↑' + kb(stats.tx), x, y + 2, p.mid);
      else { puts(ctx, 'WRP', x, y + 2, p.mid); puts(ctx, bar(25 + AU.level * 75, n), x + 5, y + 2, p.warm); }
      puts(ctx, 'MON  ' + (screens.length || 1) + '    AUDIO ' + (P.audio ? 'ON' : 'OFF'), x, y + 3, p.mid);
    }
    // letreiro rolando na última linha
    var msg = (P.media && track ? '♪ ' + track.title + ' — ' + track.artist
      : mode === 'city' ? 'waiting for transmission...' : 'no incoming transmission...') +
      (mode === 'city' ? '     •     NIGHT GRID ONLINE     •     RAIN ALERT: LIGHT     •     '
        : '     •     ALL DECKS NOMINAL     •     HEADING 042 MARK 7     •     ');
    var span = COLS - 12, off = Math.floor(s * 6 * P.speed) % msg.length, rep = msg;
    while (rep.length < off + span) rep += msg;
    puts(ctx, rep.substr(off, span), 10, BOT, p.fg);
  }

  // ---------------------------------------------------------------- ASCII City
  function buildCity(c) {
    var p = palette, R = rng(seed), dens = P.density, hz = Math.round(ROWS * .7), i, r, col, k;
    var sc = { hz: hz, twinkle: [], blink: [], signs: [], beacons: [], cars: [], drops: [] }, lit = [];
    var sky = c.createLinearGradient(0, 0, 0, hz * CH);
    sky.addColorStop(0, p.bg); sky.addColorStop(.55, p.bg); sky.addColorStop(1, p.sky);
    c.fillStyle = sky; c.fillRect(0, 0, W, hz * CH + 1);
    c.fillStyle = p.street; c.fillRect(0, hz * CH, W, H - hz * CH);
    setFont(c);
    // estrelas (algumas cintilam no quadro dinâmico)
    for (r = 0; r < hz - 5; r++) for (col = 0; col < COLS; col++) {
      var hs = hash(col, r, 11); if (hs > .013) continue;
      if (hs < .0024 && sc.twinkle.length < 44) { sc.twinkle.push([col, r, hash(col, r, 13) * TAU, .7 + hash(col, r, 14) * 1.8]); continue; }
      put(c, hs < .006 ? '+' : hs < .01 ? '.' : '·', col, r, rgba(p.mid, (.25 + hash(col, r, 12) * .6) * (1 - r / hz * .7)));
    }
    // lua sombreada com a rampa de caracteres
    // fica alta e à esquerda da telemetria, acima de todos os prédios
    var mr = Math.max(3, Math.round(ROWS * .075)), mrow = mr + 3, mcol = Math.round(COLS * .66), kx = CW / (mr * CH);
    var skyTop = Math.max(mrow + mr + 3, Math.round(ROWS * .24));
    var mx = mcol * CW + CW / 2, my = mrow * CH + CH / 2, halo = c.createRadialGradient(mx, my, mr * CH * .8, mx, my, mr * CH * 2.6);
    halo.addColorStop(0, rgba(p.moon, .13)); halo.addColorStop(1, rgba(p.moon, 0));
    c.fillStyle = halo; c.fillRect(mx - mr * CH * 3, my - mr * CH * 3, mr * CH * 6, mr * CH * 6);
    c.fillStyle = sky; c.beginPath(); c.arc(mx, my, mr * CH * 1.05, 0, TAU); c.fill();
    for (r = mrow - mr - 2; r <= mrow + mr + 2; r++) for (col = Math.floor(mcol - 1.6 / kx); col <= mcol + 1.6 / kx; col++) {
      var dx = (col - mcol) * kx, dy = (r - mrow) / mr, d2 = dx * dx + dy * dy;
      if (d2 <= 1) {
        var nz = Math.sqrt(1 - d2), l = clamp(-dx * .55 - dy * .4 + nz * .7 - fbm(col * .35, r * .5) * .3, 0, 1);
        put(c, RAMP[Math.max(1, Math.round(l * 9))], col, r, rgba(p.moon, .3 + l * .7));
      } else if (d2 < 2 && hash(col, r, 21) < .2 / d2) put(c, '.', col, r, rgba(p.moon, .2));
    }
    // skyline distante
    for (col = 0; col < COLS;) {
      var fw = 3 + (R() * 6 | 0), fh = Math.round(ROWS * (.1 + R() * .2)), ft = hz - fh;
      c.fillStyle = p.far; c.fillRect(col * CW, ft * CH, fw * CW, fh * CH);
      for (r = ft + 1; r < hz; r++) for (k = col; k < col + fw; k++) if (hash(k, r, 31) < .1) put(c, '.', k, r, rgba(p.fg, .3));
      col += fw;
    }
    // skyline próxima: contorno, janelas, telhados, letreiros neon
    for (col = -2; col < COLS;) {
      var bw = 6 + (R() * 9 | 0);
      if (R() > .35 + dens * .65) { col += bw; continue; }
      var bh = Math.min(hz - skyTop, Math.round(ROWS * (.14 + R() * (.22 + dens * .16)))), top = hz - bh, wc = [p.warm, p.fg, p.hot, p.warm][R() * 4 | 0];
      c.fillStyle = p.near; c.fillRect(col * CW, top * CH, bw * CW, bh * CH);
      puts(c, '.' + '-'.repeat(bw - 2) + '.', col, top, rgba(p.fg, .6));
      for (r = top + 1; r < hz; r++) { put(c, '|', col, r, rgba(p.fg, .38)); put(c, '|', col + bw - 1, r); }
      for (r = top + 2; r < hz - 1; r += 2) for (k = col + 2; k < col + bw - 2; k += 2) {
        if (R() < .44) {
          lit.push([k, r, wc]);
          if (R() < .1 && sc.blink.length < 70) { sc.blink.push([k, r, wc]); continue; }
          put(c, '#', k, r, rgba(wc, .55 + R() * .4));
        } else put(c, '.', k, r, rgba(p.fg, .16));
      }
      var roof = R(), mid = col + (bw >> 1);
      if (roof < .3) { for (i = 1; i <= 3; i++) put(c, '|', mid, top - i, rgba(p.fg, .6)); sc.beacons.push([mid, top - 4]); }
      else if (roof < .45) puts(c, '/\\', mid - 1, top - 1, rgba(p.fg, .6));
      else if (roof < .58) puts(c, '(=)', mid - 1, top - 1, rgba(p.fg, .5));
      if (R() < .25 + dens * .2 && bh > 7) {
        var word = SIGNS[R() * SIGNS.length | 0];
        if (word.length < bh - 3) {
          var sx = R() < .5 ? col - 1 : col + bw, sg = { col: sx, row: top + 2, word: word, color: R() < .55 ? p.hot : p.fg };
          c.fillStyle = p.near; c.fillRect(sx * CW, sg.row * CH, CW, word.length * CH);
          sc.signs.push(sg);
        }
      }
      col += bw + (R() < .6 ? 1 : 0);
    }
    // rua: calçada, faixas e reflexos na pista molhada
    var dash = '';
    for (i = 0; i < COLS; i++) dash += i % 4 < 2 ? '-' : ' ';
    puts(c, '='.repeat(COLS), 0, hz, rgba(p.fg, .5));
    puts(c, dash, 0, hz + 3, rgba(p.fg, .22));
    puts(c, '='.repeat(COLS), 0, hz + 5, rgba(p.fg, .32));
    var floor = BOT - 1;
    lit.forEach(function (L) {
      var rr = Math.round(hz + 6 + (hz - L[1]) * .55);
      if (rr > floor) return;
      put(c, (rr & 1) ? '~' : '-', L[0] + Math.round(Math.sin(rr * 1.7 + L[0]) * 1.2), rr, rgba(L[2], .42 * (1 - (rr - hz) / (BOT - hz))));
    });
    sc.signs.forEach(function (sg) {
      for (var j = 0; j < sg.word.length; j++) {
        var rr = Math.round(hz + 6 + (hz - sg.row - j) * .55);
        if (rr <= floor) put(c, '~', sg.col, rr, rgba(sg.color, .45 * (1 - (rr - hz) / (BOT - hz))));
      }
    });
    // carros e chuva (estado dinâmico)
    var nCars = Math.max(2, Math.round(COLS / 40 * (.5 + dens)));
    for (i = 0; i < nCars; i++) sc.cars.push({ lane: i % 2 ? hz + 4 : hz + 2, dir: i % 2 ? -1 : 1, x: R() * W, v: 70 + R() * 80, color: [p.fg, p.hot, p.warm][i % 3] });
    var nd = Math.round(COLS * (.3 + dens * .55));
    for (i = 0; i < nd; i++) sc.drops.push({ x: R() * W * 1.25, y: R() * H, v: 280 + R() * 240 });
    buildIcons(c);
    return sc;
  }
  function dynCity(t, dt) {
    var sc = scene, p = palette, s = t / 1000 * P.speed, i, b;
    setFont(ctx);
    for (i = 0; i < sc.twinkle.length; i++) { b = sc.twinkle[i]; put(ctx, '*', b[0], b[1], rgba(p.mid, .15 + .75 * (.5 + .5 * Math.sin(s * b[3] + b[2])))); }
    for (i = 0; i < sc.blink.length; i++) {
      b = sc.blink[i]; var on = Math.sin(s * .45 + i * 1.7) > -.35;
      put(ctx, on ? '#' : '.', b[0], b[1], on ? rgba(b[2], .95) : rgba(p.fg, .16));
    }
    for (i = 0; i < sc.beacons.length; i++) { b = sc.beacons[i]; put(ctx, '*', b[0], b[1], ((s * .8 + i * .37) % 1) < .45 ? '#ff4b4b' : 'rgba(255,75,75,.2)'); }
    for (i = 0; i < sc.signs.length; i++) {
      var sg = sc.signs[i], fl = hash(Math.floor(s * 9), i, 5) < .04 ? .2 : 1, a = clamp((.72 + AU.level * .35 + AU.beat * .25) * fl, 0, 1);
      ctx.fillStyle = rgba(sg.color, .13 * a); ctx.fillRect((sg.col - .7) * CW, (sg.row - .4) * CH, CW * 2.4, (sg.word.length + .8) * CH);
      ctx.fillStyle = rgba(sg.color, a);
      for (var j = 0; j < sg.word.length; j++) put(ctx, sg.word[j], sg.col, sg.row + j);
    }
    var boost = dt * P.speed * (1 + AU.level * .6);
    sc.cars.forEach(function (car) {
      car.x += car.dir * car.v * boost;
      if (car.dir > 0 && car.x > W + 80) car.x = -80;
      if (car.dir < 0 && car.x < -80) car.x = W + 80;
      var y = car.lane * CH + CH / 2, x0 = car.dir > 0 ? car.x + CW * 6 : car.x, x1 = car.dir > 0 ? x0 + CW * 7 : x0 - CW * 7;
      var beam = ctx.createLinearGradient(x0, 0, x1, 0);              // farol: some aos poucos à frente do carro
      beam.addColorStop(0, rgba(p.warm, .3)); beam.addColorStop(1, rgba(p.warm, 0));
      ctx.fillStyle = beam; ctx.fillRect(Math.min(x0, x1), car.lane * CH + 4, CW * 7, CH - 8);
      if (car.dir > 0) { putsPx(ctx, '[o=o]', car.x, y, car.color); putsPx(ctx, '>', car.x + CW * 5, y, p.warm); }
      else { putsPx(ctx, '<', car.x, y, p.warm); putsPx(ctx, '[o=o]', car.x + CW, y, car.color); putsPx(ctx, '·', car.x + CW * 6, y, '#ff4b4b'); }
    });
    ctx.fillStyle = rgba(p.rain, .3);
    for (i = 0; i < sc.drops.length; i++) {
      var d = sc.drops[i]; d.y += d.v * dt; d.x -= d.v * dt * .3;
      if (d.y > H) { d.y = -CH; d.x = Math.random() * W * 1.25; }
      ctx.fillText('/', d.x, d.y);
    }
  }

  // ---------------------------------------------------------------- ASCII Starship Bridge
  function buildStar(c) {
    var p = palette, R = rng(seed + 7), dens = P.density, ct = BOT - 8, r, col, i;
    var sc = { ct: ct, stars: [], blips: [], buttons: [] };
    c.fillStyle = p.bg; c.fillRect(0, 0, W, H);
    setFont(c);
    // nebulosa e poeira de estrelas
    for (r = 0; r < ct; r++) for (col = 0; col < COLS; col++) {
      var v = fbm(col * .045, r * .09 + 3) * .75 + fbm(col * .03 + 10, r * .07) * .25;
      if (v > .55) {
        var g = (v - .55) / .35;
        put(c, RAMP[clamp(Math.round(g * 9), 1, 9)], col, r, rgba(fbm(col * .02 + 5, r * .04) > .5 ? p.neb1 : p.neb2, .2 + g * .5));
      } else if (hash(col, r, 41) < .008) put(c, '.', col, r, rgba(p.mid, .35 + hash(col, r, 42) * .5));
    }
    // planeta com anel
    var pr = Math.max(4, Math.round(ROWS * .19)), pcol = Math.round(COLS * .79), prow = Math.round(ct * .52), kx = CW / (pr * CH);
    sc.pcx = pcol * CW + CW / 2; sc.pcy = prow * CH + CH / 2; sc.prPx = pr * CH * 1.04;
    var ring = function (front) {
      // anel plano (sem inclinação, para não quebrar em degraus) com duas faixas; uma célula por posição
      var seen = {};
      for (var band = 0; band < 2; band++) for (var a = 0; a < TAU; a += .003) {
        var sn = Math.sin(a); if ((sn > 0) !== front) continue;
        var rad = band ? 1.45 : 1.7, rc = Math.round(pcol + Math.cos(a) * rad / kx), rw = Math.round(prow + sn * pr * .3 * rad);
        var key = rc + ',' + rw; if (seen[key]) continue; seen[key] = 1;
        var dx = (rc - pcol) * kx, dy = (rw - prow) / pr;
        if (dx * dx + dy * dy < 1 && !front) continue;
        put(c, band ? '-' : '=', rc, rw, rgba(p.ring, (band ? .35 : .55) + .35 * Math.abs(Math.cos(a))));
      }
    };
    ring(false);
    c.fillStyle = p.bg; c.beginPath(); c.arc(sc.pcx, sc.pcy, sc.prPx, 0, TAU); c.fill();
    for (r = prow - pr - 1; r <= prow + pr + 1; r++) for (col = Math.floor(pcol - 1.1 / kx); col <= pcol + 1.1 / kx; col++) {
      var dx = (col - pcol) * kx, dy = (r - prow) / pr, d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      var nz = Math.sqrt(1 - d2), l = clamp(-dx * .6 - dy * .35 + nz * .65, 0, 1);
      l = clamp(l * (.82 + .18 * Math.sin(dy * 11 + fbm(col * .2, r * .3) * 4)), 0, 1);
      put(c, RAMP[Math.max(1, Math.round(l * 9))], col, r, rgba(l > .45 ? p.planet : p.hot, .25 + l * .75));
    }
    ring(true);
    // molduras da cabine nos cantos superiores
    var hw = Math.round(COLS * .06), hh = Math.round(ROWS * .28);
    for (r = 0; r < hh; r++) {
      var edge = Math.round(hw * (1 - r / hh));
      c.fillStyle = p.hull; c.fillRect(0, r * CH, edge * CW, CH); c.fillRect(W - edge * CW, r * CH, edge * CW + 1, CH);
      for (col = 1; col < edge - 1; col += 3) if ((r + col) % 2 === 0) { put(c, '.', col, r, rgba(p.fg, .18)); put(c, '.', COLS - 1 - col, r); }
      put(c, '/', edge, r, rgba(p.fg, .55)); put(c, '\\', COLS - 1 - edge, r);
    }
    // retícula central
    var rc0 = Math.round(COLS / 2), rr0 = Math.round(ct / 2);
    puts(c, '──   (       )   ──', rc0 - 11, rr0, rgba(p.fg, .3)); put(c, '+', rc0, rr0, rgba(p.fg, .55));
    put(c, '·', rc0, rr0 - 2, rgba(p.fg, .3)); put(c, '·', rc0, rr0 + 2);
    // console
    c.fillStyle = p.hull; c.fillRect(0, ct * CH, W, H - ct * CH);
    puts(c, '═'.repeat(COLS), 0, ct, rgba(p.fg, .6));
    var x = 2;
    var addPanel = function (w, title) {
      if (w < 12 || x + w > COLS - 2) return null;
      var b = { col: x, row: ct + 1, w: w, h: 7 };
      setFont(c, true); panel(c, b, title, rgba(p.fg, .75)); setFont(c); x += w + 2; return b;
    };
    sc.radar = addPanel(24, 'RADAR');
    sc.eng = addPanel(30, 'ENGINES');
    sc.nav = COLS - 32 > x + 18 ? { col: COLS - 32, row: ct + 1, w: 30, h: 7 } : null;
    if (sc.nav) { setFont(c, true); panel(c, sc.nav, 'NAV', rgba(p.fg, .75)); setFont(c); }
    sc.sys = addPanel((sc.nav ? sc.nav.col - 2 : COLS - 2) - x, 'SYSTEMS');
    if (sc.radar) {
      var b = sc.radar, cc = b.col + Math.floor(b.w / 2), cr = b.row + 3, rad = 2.4, asp = CH / CW;
      sc.rc = cc; sc.rr = cr; sc.rad = rad;
      for (var a = 0; a < TAU; a += .2) put(c, '·', cc + Math.cos(a) * rad * asp, cr + Math.sin(a) * rad, rgba(p.fg, .4));
      for (var a2 = 0; a2 < TAU; a2 += .45) put(c, '·', cc + Math.cos(a2) * rad * asp * .5, cr + Math.sin(a2) * rad * .5, rgba(p.fg, .25));
      puts(c, '-   -   +   -   -', cc - 8, cr, rgba(p.fg, .25));
      for (i = 0; i < 4; i++) sc.blips.push({ a: R() * TAU, d: .35 + R() * .6 });
    }
    if (sc.eng) {
      var e = sc.eng, n = e.w - 12;
      ['PWR', 'SHD', 'WRP'].forEach(function (lab, j) { puts(c, lab, e.col + 2, e.row + 1 + j * 2, p.mid); puts(c, '░'.repeat(n), e.col + 7, e.row + 1 + j * 2, rgba(p.fg, .25)); });
      sc.engN = n;
    }
    if (sc.sys) {
      var sy = sc.sys, labels = ['AUX', 'LIFE', 'COMM', 'HULL', 'GRAV', 'O2', 'FUEL', 'SCAN', 'CARGO', 'DOCK'];
      for (var rowB = 0; rowB < 2; rowB++) for (var cb = sy.col + 2, li = rowB * 5; cb + 9 < sy.col + sy.w; cb += 10, li++) {
        puts(c, '[ ]', cb, sy.row + 2 + rowB * 2, rgba(p.fg, .5));
        puts(c, labels[li % labels.length], cb + 4, sy.row + 2 + rowB * 2, rgba(p.mid, .7));
        sc.buttons.push([cb + 1, sy.row + 2 + rowB * 2]);
      }
      puts(c, '─'.repeat(sy.w - 4), sy.col + 2, sy.row + 5, rgba(p.fg, .2));
    }
    if (sc.nav) {
      var nv = sc.nav;
      for (i = 0; i < 14; i++) put(c, '·', nv.col + 2 + R() * (nv.w - 4), nv.row + 1 + R() * 4.5, rgba(p.mid, .5));
      sc.path = [];
      for (i = 0; i <= 20; i++) { var tt = i / 20; sc.path.push([nv.col + 3 + tt * (nv.w - 7), nv.row + 4.6 - tt * 3.2 - Math.sin(tt * Math.PI) * .9]); }
      sc.path.forEach(function (q, j) { if (j % 2 === 0) put(c, '.', q[0], q[1], rgba(p.fg, .45)); });
      put(c, '◎', sc.path[20][0], sc.path[20][1], p.hot);
    }
    // estrelas em warp (dinâmicas)
    var ns = Math.round(70 + dens * 140);
    for (i = 0; i < ns; i++) sc.stars.push({ a: R() * TAU, d: R() * Math.hypot(W, H) * .5, v: .6 + R() * .8 });
    buildIcons(c);
    return sc;
  }
  function dynStar(t, dt) {
    var sc = scene, p = palette, s = t / 1000 * P.speed, i;
    setFont(ctx);
    var cx = W / 2, cy = sc.ct * CH / 2, maxD = Math.hypot(W, H) * .55, top = sc.ct * CH - CH, warp = 1 + AU.beat * 1.6 + AU.level * .6;
    for (i = 0; i < sc.stars.length; i++) {
      var st = sc.stars[i];
      st.d += (14 + st.d * 1.1) * dt * P.speed * st.v * warp;
      if (st.d > maxD) { st.d = 4 + Math.random() * 30; st.a = Math.random() * TAU; }
      var co = Math.cos(st.a), sn = Math.sin(st.a), x = cx + co * st.d, y = cy + sn * st.d * .62;
      if (y < 0 || y > top || x < 0 || x > W) continue;
      var ddx = x - sc.pcx, ddy = y - sc.pcy;
      if (ddx * ddx + ddy * ddy < sc.prPx * sc.prPx) continue;
      var f = st.d / maxD, ch = f < .22 ? '·' : Math.abs(co) > .9 ? '-' : Math.abs(sn) > .9 ? '|' : (co * sn > 0 ? '\\' : '/');
      ctx.fillStyle = rgba(f > .6 ? p.warm : p.mid, .2 + f * .8);
      ctx.fillText(ch, x, y);
    }
    if (sc.radar) {
      var ang = s * 1.8, asp = CH / CW;
      for (var tr = 0; tr < 3; tr++) for (var k = 1; k <= 5; k++) {
        var a = ang - tr * .22, fr = k / 5 * sc.rad;
        put(ctx, tr ? '·' : '•', sc.rc + Math.cos(a) * fr * asp, sc.rr + Math.sin(a) * fr, rgba(p.fg, (.9 - tr * .3) * (.5 + k / 10)));
      }
      sc.blips.forEach(function (bl, j) {
        var since = ((ang - bl.a) % TAU + TAU) % TAU, al = Math.max(0, 1 - since / 2.2) + (j === 0 ? AU.beat : 0);
        if (al > .05) put(ctx, '*', sc.rc + Math.cos(bl.a) * bl.d * sc.rad * asp, sc.rr + Math.sin(bl.a) * bl.d * sc.rad, rgba(p.hot, al));
      });
    }
    if (sc.eng) {
      var vals = [100 - stats.cpu, 100 - stats.mem, 30 + AU.level * 70 + Math.sin(s * 1.3) * 8];
      vals.forEach(function (v, j) {
        var nn = clamp(Math.round(v / 100 * sc.engN), 0, sc.engN);
        puts(ctx, '█'.repeat(nn), sc.eng.col + 7, sc.eng.row + 1 + j * 2, [p.fg, p.hot, p.warm][j]);
      });
    }
    for (i = 0; i < sc.buttons.length; i++) {
      if (hash(Math.floor(s * 1.2 + i * .37), i, 3) < .55) put(ctx, '■', sc.buttons[i][0], sc.buttons[i][1], [p.fg, p.hot, p.warm][i % 3]);
    }
    if (sc.path) {
      var q = sc.path[Math.floor((s * .06 % 1) * 20)];
      put(ctx, '▸', q[0], q[1], p.warm);
    }
  }

  // ---------------------------------------------------------------- quadro
  function build() {
    dirty = false;
    cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    scene = mode === 'city' ? buildCity(cctx) : buildStar(cctx);
    buildHud(cctx);
  }
  function draw(now) {
    now = now || performance.now();
    var dt = lastDraw ? clamp((now - lastDraw) / 1000, 0, .1) : .033; lastDraw = now;
    if (dirty || !scene) build();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cache, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (mode === 'city') dynCity(now, dt); else dynStar(now, dt);
    dynHud(now);
  }
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
    requestAnimationFrame(frame); if (paused) { last = 0; lastDraw = 0; return; }
    if (last && now - last < 31) return; var dt = last ? Math.min(.1, (now - last) / 1000) : .03; last = now; fps = fps ? fps * .95 + (1 / dt) * .05 : 1 / dt;
    stepAudio(now); draw(now); frameN++;               // window.frameN já é um getter (definido abaixo)
  }
  var lastIconKey = '';
  function iconData(m) {
    icons.length = 0;
    if (m.vis) m.r.forEach(function (r) { icons.push({ x: r[0] / DPR, y: r[1] / DPR, w: (r[2] - r[0]) / DPR, h: (r[3] - r[1]) / DPR }); });
    var key = JSON.stringify(icons);
    if (key !== lastIconKey) { lastIconKey = key; dirty = true; }
  }
  function handle(m) {
    if (!m) return;
    if (m.t === 'icons') { iconData(m); return; }
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
  window.asciiWorld = { applySettings: applySettings, setMode: function (v) { mode = v; dirty = true; } };
  window.cv = cv; window.draw = draw;
  Object.defineProperties(window, {
    icons: { configurable: true, get: function () { return icons; }, set: function (v) { icons = v; dirty = true; } },
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
