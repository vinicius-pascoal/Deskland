/* Deskland · núcleo compartilhado de ASCII City / Starship Bridge / Data Center / Dungeon.
   Tudo é desenhado numa grade de caracteres monoespaçados. A cena estática (céu, lua, prédios, rua,
   nebulosa, planeta, console, molduras do HUD) vai para um canvas de cache, refeito só quando mudam o
   tamanho, a paleta, a densidade ou os ícones. Cada quadro copia o cache e desenha por cima apenas o que
   se move: chuva, carros, letreiros, janelas piscando, estrelas em warp, radar, barras e o letreiro de
   notícias. */
(function () {
  'use strict';

  var MODES = ['city', 'starship', 'datacenter', 'dungeon'];
  var mode = MODES.indexOf(document.body.dataset.mode) >= 0 ? document.body.dataset.mode : 'city';
  var qs = new URLSearchParams(location.search);
  var WALL = qs.has('wallpaper'), PREVIEW = qs.has('preview');
  var cv = document.getElementById('art'), ctx = cv.getContext('2d', { alpha: false });
  var cache = document.createElement('canvas'), cctx = cache.getContext('2d', { alpha: false });
  var W = innerWidth, H = innerHeight, DPR = 1, icons = [], screens = [];
  var paused = false, seed = 20261115, last = 0, lastDraw = 0, frameN = 0, fps = 0, dirty = true, scene = null;
  var stats = { cpu: 0, mem: 0, rx: 0, tx: 0, bat: -1, ac: true, procs: 0 };
  var track = null, audioOff = null, mediaOff = null;
  var P = {
    palette: mode === 'starship' ? 2 : 0, density: 0.72, speed: 1,
    audio: 1, media: 1, telemetry: 1, windowFx: 1, windowFxIntensity: .7
  };
  var DEFAULTS = Object.assign({}, P);
  var PALETTES = {
    city: [
      { bg: '#05070f', sky: '#26134d', street: '#090b1a', far: '#11143a', near: '#070916', fg: '#72f6ff', hot: '#ff5fbe', warm: '#ffd166', mid: '#a7b9d6', rain: '#7fb8ff', moon: '#f4eed8' },
      { bg: '#0a0604', sky: '#4f2610', street: '#120a06', far: '#2c170a', near: '#0f0804', fg: '#ffc15c', hot: '#ff6e43', warm: '#ffe6b0', mid: '#e6c899', rain: '#e0b070', moon: '#fff1d0' },
      { bg: '#03070d', sky: '#123a5e', street: '#060c16', far: '#0f2440', near: '#040a13', fg: '#9ee7ff', hot: '#c29cff', warm: '#e8f4ff', mid: '#c8d9ec', rain: '#a8d4ff', moon: '#e8f6ff' }
    ],
    starship: [
      { bg: '#02040a', neb1: '#7445d6', neb2: '#1f86c4', hull: '#0a1020', fg: '#8be9fd', hot: '#ff79c6', warm: '#ffd580', mid: '#b9c8df', planet: '#ff9e7a', ring: '#ffd580' },
      { bg: '#070402', neb1: '#b9601f', neb2: '#86621f', hull: '#140c06', fg: '#ffd580', hot: '#ff8a65', warm: '#fff0c0', mid: '#f0d6a4', planet: '#ffb070', ring: '#fff0c0' },
      { bg: '#02070c', neb1: '#2276ab', neb2: '#4256c9', hull: '#081420', fg: '#a9f0ff', hot: '#7aa7ff', warm: '#e0fbff', mid: '#c6e6ef', planet: '#9fd8ff', ring: '#e0fbff' }
    ],
    // corredor frio (azul), corredor quente (âmbar) e sala verde
    datacenter: [
      { bg: '#03060b', wall: '#0c1828', floor: '#060d18', fg: '#7cd8ff', hot: '#ff5f6d', warm: '#ffd166', ok: '#5cff9d', mid: '#9fb6cc', light: '#e8f6ff' },
      { bg: '#0a0503', wall: '#211108', floor: '#120804', fg: '#ffb35c', hot: '#ff4b3a', warm: '#ffe08a', ok: '#9dff6a', mid: '#e0c09a', light: '#fff1dc' },
      { bg: '#020803', wall: '#08190d', floor: '#041008', fg: '#5cff9d', hot: '#ff5f6d', warm: '#d9ff6a', ok: '#5cff9d', mid: '#9fd9b0', light: '#eaffef' }
    ],
    // caverna com tochas, cripta gelada e ruínas com musgo
    dungeon: [
      { bg: '#050403', floor: '#d8c39a', wall: '#a8957a', corr: '#7d6f5a', fg: '#f2e6c8', hot: '#ff7a2f', warm: '#ffd36b', water: '#4fb3ff', mid: '#b3a587' },
      { bg: '#03060a', floor: '#b4d2ea', wall: '#7393b0', corr: '#566e85', fg: '#e6f6ff', hot: '#7fd4ff', warm: '#e9f7ff', water: '#5ef0ff', mid: '#93adc2' },
      { bg: '#040603', floor: '#c4d4a4', wall: '#86a06e', corr: '#647654', fg: '#e8f3d0', hot: '#ffb347', warm: '#fff0a0', water: '#5fd3b0', mid: '#9cad86' }
    ]
  }[mode];
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
  var TITLES = { city: 'ASCII CITY // NIGHT GRID', starship: 'STARSHIP BRIDGE // FLIGHT COMPUTER', datacenter: 'DATA CENTER // HALL B-07', dungeon: 'DUNGEON // DEPTH 3' };
  var TELE = { city: 'TELEMETRY', starship: 'TELEMETRY', datacenter: 'RACK MONITOR', dungeon: 'CHARACTER' };
  var TICKER = { city: ' NEWS ▸', starship: 'COMMS ▸', datacenter: 'SYSLOG▸', dungeon: '  LOG ▸' };
  function buildHud(c) {
    var p = palette, L = hudLayout();
    setFont(c, true);
    panel(c, L.title, TITLES[mode], rgba(p.fg, .85));
    if (L.tel) panel(c, L.tel, TELE[mode], rgba(p.fg, .85));
    c.fillStyle = rgba(p.bg, .9); c.fillRect(0, BOT * CH, W, H - BOT * CH);
    puts(c, TICKER[mode], 1, BOT, p.hot);
    setFont(c);
  }
  // Por modo: linha de status, linhas da telemetria ([rótulo, valor 0-100 | null, cor, texto]) e letreiro.
  function hudInfo() {
    var p = palette, cpu = Math.round(stats.cpu), mem = Math.round(stats.mem), net = '↓' + kb(stats.rx) + '  ↑' + kb(stats.tx);
    var t = P.media && track;
    if (mode === 'city') return {
      status: 'TRAFFIC ' + kb(stats.rx + stats.tx) + '/s   MEM ' + mem + '%   ' + (AU.level > .5 ? 'PULSE HIGH' : 'GRID STABLE'),
      rows: [['CPU', stats.cpu, p.fg], ['MEM', stats.mem, p.hot], ['NET', null, null, net]],
      msg: (t ? '♪ ' + t.title + ' — ' + t.artist : 'waiting for transmission...') + '     •     NIGHT GRID ONLINE     •     RAIN ALERT: LIGHT     •     '
    };
    if (mode === 'starship') return {
      status: 'ENERGY ' + (100 - cpu) + '%   SHIELD ' + (100 - mem) + '%   ' + (AU.beat > .5 ? 'CONTACT' : 'COURSE STEADY'),
      rows: [['CPU', stats.cpu, p.fg], ['MEM', stats.mem, p.hot], ['WRP', 25 + AU.level * 75, p.warm]],
      msg: (t ? '♪ ' + t.title + ' — ' + t.artist : 'no incoming transmission...') + '     •     ALL DECKS NOMINAL     •     HEADING 042 MARK 7     •     '
    };
    if (mode === 'datacenter') return {
      status: 'RACKS ' + (scene && scene.racks || 0) + '   TEMP ' + (19 + stats.cpu * .12).toFixed(1) + '°C   LOAD ' + cpu + '%   ' + (stats.cpu > 85 ? 'THROTTLING' : 'ALL NODES UP'),
      rows: [['CPU', stats.cpu, p.ok], ['MEM', stats.mem, p.warm], ['NET', null, null, net]],
      msg: (t ? 'audio-svc: now playing "' + t.title + '" by ' + t.artist : 'audio-svc: idle') +
        '     •     kernel: eth0 link up 10Gb/s     •     raid: all disks healthy     •     cron: nightly backup completed     •     '
    };
    var h = scene && scene.hero;
    return {
      status: 'HP ' + (100 - cpu) + '/100   MP ' + (100 - mem) + '/100   GOLD ' + (scene && scene.gold || 0) + '   TURN ' + (h ? h.turn : 0),
      rows: [['HP', 100 - stats.cpu, p.hot], ['MP', 100 - stats.mem, p.water], ['XP', clamp((stats.rx + stats.tx) / 20000, 4, 100), p.warm]],
      msg: (t ? 'A bard sings "' + t.title + '" by ' + t.artist + '.' : 'The halls are silent.') +
        '     •     You hear water dripping somewhere.     •     A torch flickers in the draft.     •     Something scurries in the dark.     •     '
    };
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
    var p = palette, L = hudLayout(), s = t / 1000, info = hudInfo();
    setFont(ctx);
    puts(ctx, info.status.slice(0, L.title.w - 4), L.title.col + 2, L.title.row + 1, p.mid);
    if (L.tel) {
      var x = L.tel.col + 2, y = L.tel.row + 1, n = 14;
      info.rows.forEach(function (row, j) {
        puts(ctx, row[0], x, y + j, p.mid);
        if (row[1] == null) { puts(ctx, row[3], x + 5, y + j, p.mid); return; }
        puts(ctx, bar(row[1], n), x + 5, y + j, row[2]); puts(ctx, String(Math.round(clamp(row[1], 0, 100))).padStart(3) + '%', x + 6 + n, y + j, p.mid);
      });
      puts(ctx, 'MON  ' + (screens.length || 1) + '    AUDIO ' + (P.audio ? 'ON' : 'OFF'), x, y + 3, p.mid);
    }
    // letreiro rolando na última linha
    var msg = info.msg;
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

  // ---------------------------------------------------------------- ASCII Data Center
  // Corredor em perspectiva com um ponto de fuga (vpc, vpr). Para cada célula: sx = distância horizontal ao
  // ponto de fuga e sy = distância vertical, normalizadas para 1 na borda próxima. sx >= sy é parede de racks;
  // senão é teto ou piso; as duas abaixo de sg é a parede do fundo. 1/s é a profundidade: os racks são fatias
  // de profundidade constante e as unidades dividem a altura de cada fatia.
  function buildDC(c) {
    var p = palette, dens = P.density, sc = { leds: [], fans: [], tags: [], racks: 0 };
    var vpc = COLS / 2, vpr = Math.round(BOT * .47), topN = 8, botN = BOT - 1, sg = .075, q = .3, U = 14, maxRi = 0;
    sc.vpc = vpc; sc.vpr = vpr; sc.topN = topN;
    c.fillStyle = p.bg; c.fillRect(0, 0, W, H);
    setFont(c);
    for (var row = 0; row < BOT; row++) {
      var sy = row < vpr ? (vpr - row - .5) / (vpr - topN) : (row + .5 - vpr) / (botN - vpr);
      for (var col = 0; col < COLS; col++) {
        var xo = (col + .5 - vpc) / vpc, sx = Math.abs(xo);
        if (sx < sg && sy < sg) { c.fillStyle = rgba(p.wall, .95); c.fillRect(col * CW, row * CH, CW + .5, CH + .5); continue; }
        if (sx >= sy) {
          // parede de racks
          var s = sx, zz = (1 / s - 1) / q, ri = Math.floor(zz), r = zz - ri, f = .2 + .8 * Math.pow(s, .7), side = xo < 0 ? 0 : 1;
          var top = vpr - (vpr - topN) * s, bot = vpr + (botN - vpr) * s, v = (row + .5 - top) / (bot - top);
          var rpu = (bot - top) / U, uf = v * U, ui = Math.floor(uf), sub = Math.floor((uf - ui) * rpu), kind = hash(ri * 2 + side, ui, 5);
          if (ri > maxRi) maxRi = ri;
          c.fillStyle = rgba(p.wall, .3 + .62 * s); c.fillRect(col * CW, row * CH, CW + .5, CH + .5);
          if (r < .08 || r > .95) put(c, s > .3 ? '│' : '|', col, row, rgba(p.mid, .6 * f));
          else if (v < .025 || v > .985) put(c, '─', col, row, rgba(p.mid, .55 * f));
          else if (rpu >= 1.6 && sub === 0) put(c, '─', col, row, rgba(p.mid, .2 * f));
          else if (kind > .88 - dens * .1) { /* unidade vazia */ }
          else if (r < .2) {
            put(c, '·', col, row, rgba(p.ok, .22 * f));
            if (s > .16 && (rpu < 1.6 || sub === 1) && sc.leds.length < 650) sc.leds.push([col, row, f, kind]);
          } else {
            var g = kind < .45 ? ((col + row) & 1 ? ':' : '.') : kind < .7 ? '[=]'[col % 3] : (col & 1 ? '·' : ':');
            if (kind < .45 && s > .45 && r > .76 && r < .86 && (rpu < 1.6 || sub === 1) && sc.fans.length < 30) { sc.fans.push([col, row, f]); continue; }
            put(c, g, col, row, rgba(p.fg, (kind < .7 ? .3 : .22) * f));
          }
          continue;
        }
        var s2 = Math.min(sy, 1.4), zz2 = (1 / s2 - 1) / q, lx = xo / s2, f2 = .2 + .8 * Math.pow(Math.min(1, s2), .7), lf = zz2 - Math.floor(zz2);
        if (row < vpr) {
          // teto: luminárias e calhas de cabos (azul à esquerda, âmbar à direita)
          if (sy <= 1 && lf < .1 && Math.abs(lx) < .34) {
            // luminária: linha fina com um brilho suave embaixo (só dentro do corredor, não atrás do HUD)
            c.fillStyle = rgba(p.light, .06 * f2); c.fillRect(col * CW, row * CH, CW + .5, CH * 1.4);
            put(c, '=', col, row, rgba(p.light, .25 + .5 * f2));
          } else if (Math.abs(Math.abs(lx) - .66) * vpc * s2 < .55) put(c, lx < 0 ? '\\' : '/', col, row, rgba(lx < 0 ? p.fg : p.warm, .55 * f2));
          else if (lf < .04 * (1 + 1 / s2)) put(c, '·', col, row, rgba(p.mid, .15 * f2));
        } else {
          // piso elevado: placas em perspectiva, faixa amarela no meio do corredor e reflexo das luminárias
          c.fillStyle = rgba(p.floor, .95); c.fillRect(col * CW, row * CH, CW + .5, CH + .5);
          if (lf < .14 && Math.abs(lx) < .36) { c.fillStyle = rgba(p.light, .035 * f2); c.fillRect(col * CW, row * CH, CW + .5, CH + .5); }
          var tx = lx * 4, tf = tx - Math.floor(tx), lw = .55 / Math.max(.3, vpc * s2 / 4), zf = zz2 * 2 - Math.floor(zz2 * 2);
          var rpt = (botN - vpr) * s2 * s2 * q / 2;
          if (Math.abs(lx) * vpc * s2 < .5) { if ((zz2 * 3) % 1 < .5) put(c, '¦', col, row, rgba(p.warm, .5 * f2)); }
          else if (tf < lw || tf > 1 - lw) put(c, lx < 0 ? '/' : '\\', col, row, rgba(p.fg, .26 * f2));
          else if (zf < Math.min(.5, .9 / Math.max(1, rpt))) put(c, '_', col, row, rgba(p.fg, .2 * f2));
        }
      }
    }
    sc.racks = (maxRi + 1) * 2;
    // porta de saída no fundo do corredor
    var dw = Math.max(1, Math.round(vpc * sg * .45)), dTop = Math.round(vpr - (vpr - topN) * sg * .7), dBot = Math.round(vpr + (botN - vpr) * sg) - 1;
    c.fillStyle = rgba(p.ok, .16); c.fillRect((vpc - dw) * CW, dTop * CH, dw * 2 * CW, (dBot - dTop + 1) * CH);
    for (var dr = dTop; dr <= dBot; dr++) { put(c, '│', vpc - dw - .5, dr, rgba(p.ok, .6)); put(c, '│', vpc + dw - .5, dr); }
    puts(c, 'EXIT', vpc - 2, dTop - 1, rgba(p.ok, .85));
    // ícones viram servidores numerados, com um LED de atividade no canto
    icons.forEach(function (ic, i) {
      var c0 = Math.floor((ic.x - 3) / CW), c1 = Math.ceil((ic.x + ic.w + 3) / CW) - 1;
      var r0 = Math.floor((ic.y - 2) / CH), r1 = Math.ceil((ic.y + ic.h + 2) / CH) - 1, w = c1 - c0 + 1;
      c.fillStyle = rgba(p.bg, .55); c.fillRect(c0 * CW, r0 * CH, w * CW, (r1 - r0 + 1) * CH);
      var tag = 'SRV-' + String(i + 1).padStart(2, '0');
      puts(c, '┌' + (tag + '─'.repeat(w)).slice(0, Math.max(0, w - 2)) + '┐', c0, r0, rgba(p.fg, .7));
      for (var rr = r0 + 1; rr < r1; rr++) { put(c, '│', c0, rr); put(c, '│', c1, rr); }
      puts(c, '└' + '─'.repeat(Math.max(0, w - 2)) + '┘', c0, r1);
      sc.tags.push([c1 - 1, r1]);
    });
    return sc;
  }
  function dynDC(t, dt) {
    var sc = scene, p = palette, s = t / 1000 * P.speed, i, act = clamp(.16 + stats.cpu / 100 * .8 + AU.level * .3, 0, 1);
    var warn = stats.mem / 100 * .1, slot = Math.floor(s * 3), flash = AU.beat > .6;
    setFont(ctx);
    for (i = 0; i < sc.leds.length; i++) {
      var L = sc.leds[i];
      if (!flash && hash(slot + (i % 7), i, 9) > act) continue;
      put(ctx, '•', L[0], L[1], rgba(hash(Math.floor(s * .3), i, 4) < warn ? p.warm : L[3] > .6 ? p.fg : p.ok, .35 + .65 * L[2]));
    }
    for (i = 0; i < sc.fans.length; i++) { var fn = sc.fans[i]; put(ctx, '|/-\\'[(Math.floor(s * 12) + i) % 4], fn[0], fn[1], rgba(p.mid, .4 + .5 * fn[2])); }
    // pacotes correndo nas calhas do teto: a quantidade acompanha o tráfego de rede
    var n = Math.round(4 + Math.min(18, (stats.rx + stats.tx) / 40000) + AU.level * 6);
    for (i = 0; i < n; i++) {
      var side = i & 1 ? 1 : -1, ph = (s * (.16 + hash(i, 1, 2) * .14) + hash(i, 2, 3)) % 1;
      var sv = i % 3 === 0 ? .1 + ph * 1.1 : 1.2 - ph * 1.1;
      var col = sc.vpc + side * .66 * sv * sc.vpc - .5, row = sc.vpr - (sc.vpr - sc.topN) * sv - .5;
      if (row < 0) continue;
      put(ctx, '•', col, row, rgba(side < 0 ? p.fg : p.warm, .3 + .7 * Math.min(1, sv)));
    }
    for (i = 0; i < sc.tags.length; i++) put(ctx, '●', sc.tags[i][0], sc.tags[i][1], hash(Math.floor(s * 4), i, 7) < act ? p.ok : rgba(p.ok, .2));
  }

  // ---------------------------------------------------------------- ASCII Dungeon
  // Mapa visto de cima: os ícones viram salas (ícones encostados viram um salão), mais salas aleatórias,
  // ligadas por corredores em L. Células: 0 rocha, 1 piso, 2 corredor, 3 parede, 4 porta, 5 água.
  var WALK = [0, 1, 1, 0, 1, 0];
  var WALLS = ['▪', '│', '│', '│', '─', '┘', '┐', '┤', '─', '└', '┌', '├', '─', '┴', '┬', '┼'];
  function buildDG(c) {
    var p = palette, dens = P.density, R = rng(seed + 23), i, j, x, y;
    var G = new Uint8Array(COLS * BOT);
    var at = function (x, y) { return x < 0 || y < 0 || x >= COLS || y >= BOT ? 0 : G[y * COLS + x]; };
    var L = hudLayout(), res = [[L.title.col, L.title.row, L.title.col + L.title.w, L.title.row + L.title.h]];
    if (L.tel) res.push([L.tel.col, L.tel.row, L.tel.col + L.tel.w, L.tel.row + L.tel.h]);
    var hits = function (a, b, m) { return a.x0 - m <= b.x1 && b.x0 - m <= a.x1 && a.y0 - m <= b.y1 && b.y0 - m <= a.y1; };
    var rooms = icons.map(function (ic) {
      return { x0: Math.floor(ic.x / CW) - 2, y0: Math.floor(ic.y / CH) - 1, x1: Math.ceil((ic.x + ic.w) / CW) + 1, y1: Math.ceil((ic.y + ic.h) / CH), icon: true };
    });
    for (var merged = true; merged;) {
      merged = false;
      for (i = 0; i < rooms.length && !merged; i++) for (j = i + 1; j < rooms.length; j++) if (hits(rooms[i], rooms[j], 2)) {
        var a = rooms[i], b = rooms[j];
        a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
        rooms.splice(j, 1); merged = true; break;
      }
    }
    rooms.forEach(function (r) {
      r.x0 = clamp(r.x0, 1, COLS - 4); r.x1 = clamp(r.x1, r.x0 + 2, COLS - 2);
      r.y0 = clamp(r.y0, 1, BOT - 4); r.y1 = clamp(r.y1, r.y0 + 1, BOT - 2);
    });
    var want = rooms.length + Math.round(4 + dens * 12);
    for (var tries = 0; rooms.length < want && tries < 600; tries++) {
      var w = 6 + (R() * 14 | 0), h = 3 + (R() * 5 | 0), nr = { x0: 2 + (R() * (COLS - w - 4) | 0), y0: 2 + (R() * (BOT - h - 4) | 0) };
      nr.x1 = nr.x0 + w; nr.y1 = nr.y0 + h;
      var free = rooms.every(function (r) { return !hits(r, nr, 3); }) &&
        res.every(function (q) { return !(q[0] - 2 <= nr.x1 && nr.x0 - 2 <= q[2] && q[1] - 2 <= nr.y1 && nr.y0 - 2 <= q[3]); });
      if (free) rooms.push(nr);
    }
    rooms.forEach(function (r) {
      for (y = r.y0; y <= r.y1; y++) for (x = r.x0; x <= r.x1; x++) G[y * COLS + x] = 1;
      r.cx = (r.x0 + r.x1) >> 1; r.cy = (r.y0 + r.y1) >> 1;
    });
    var carve = function (a, b) {
      var x = a.cx, y = a.cy;
      var step = function (tx, ty) {
        while (x !== tx || y !== ty) {
          if (x !== tx) x += x < tx ? 1 : -1; else y += y < ty ? 1 : -1;
          if (!G[y * COLS + x]) G[y * COLS + x] = 2;
        }
      };
      if (R() < .5) { step(b.cx, y); step(b.cx, b.cy); } else { step(x, b.cy); step(b.cx, b.cy); }
    };
    var order = rooms.slice().sort(function (a, b) { return a.cx - b.cx; });
    for (i = 1; i < order.length; i++) carve(order[i - 1], order[i]);
    for (i = 0; i < Math.round(order.length * .35); i++) carve(order[R() * order.length | 0], order[R() * order.length | 0]);
    // paredes em volta dos pisos; corredor que cruza a parede vira porta (ou abertura)
    for (y = 0; y < BOT; y++) for (x = 0; x < COLS; x++) if (!G[y * COLS + x]) {
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === 1) { G[y * COLS + x] = 3; dy = 2; break; }
    }
    // decide sobre uma cópia: senão um corredor convertido em piso "contamina" o vizinho e vira uma linha de piso
    var G0 = G.slice(), at0 = function (x, y) { return x < 0 || y < 0 || x >= COLS || y >= BOT ? 0 : G0[y * COLS + x]; };
    for (y = 0; y < BOT; y++) for (x = 0; x < COLS; x++) if (G0[y * COLS + x] === 2) {
      if (at0(x - 1, y) !== 1 && at0(x + 1, y) !== 1 && at0(x, y - 1) !== 1 && at0(x, y + 1) !== 1) continue;
      G[y * COLS + x] = (at0(x - 1, y) === 3 && at0(x + 1, y) === 3) || (at0(x, y - 1) === 3 && at0(x, y + 1) === 3) ? 4 : 1;
    }
    var sc = { G: G, rooms: rooms, torches: [], water: [], objs: {}, critters: [], gold: 0 };
    // água, objetos e tochas
    rooms.forEach(function (r, k) {
      if (!r.icon && R() < .3) for (y = r.y0 + 1; y < r.y1; y++) for (x = r.x0 + 1; x < r.x1; x++) if (fbm(x * .25, y * .4) > .53) G[y * COLS + x] = 5;
      var spot = function () { for (var n = 0; n < 20; n++) { var xx = r.x0 + (R() * (r.x1 - r.x0 + 1) | 0), yy = r.y0 + (R() * (r.y1 - r.y0 + 1) | 0); if (G[yy * COLS + xx] === 1) return yy * COLS + xx; } return -1; };
      if (!r.icon) {
        var k1;
        if (R() < .45 && (k1 = spot()) >= 0) { sc.objs[k1] = ['$', p.warm]; sc.gold += 10 + (R() * 50 | 0); }
        if (R() < .15 && (k1 = spot()) >= 0) sc.objs[k1] = ['^', p.hot];
        if (R() < .12 && (k1 = spot()) >= 0) sc.objs[k1] = ['&', p.mid];
      }
      var nt = 1 + (R() < .5 ? 1 : 0);
      for (i = 0; i < nt; i++) {
        var tx = r.x0 + 1 + (R() * Math.max(1, r.x1 - r.x0 - 1) | 0), ty = i ? r.y1 + 1 : r.y0 - 1;
        if (at(tx, ty) === 3) sc.torches.push([tx, ty]);
      }
    });
    var nonIcon = rooms.filter(function (r) { return !r.icon; });
    [['>', p.fg], ['<', p.fg]].forEach(function (st, k) {
      var r = nonIcon[(k * 7 + 3) % Math.max(1, nonIcon.length)] || rooms[0];
      if (r && G[r.cy * COLS + r.cx] === 1) sc.objs[r.cy * COLS + r.cx] = st;
    });
    // luz estática das tochas
    var light = new Float32Array(COLS * BOT), asp = CW / CH;
    for (y = 0; y < BOT; y++) for (x = 0; x < COLS; x++) {
      var g = G[y * COLS + x]; if (!g || g === 3) continue;
      var lt = .14;
      for (i = 0; i < sc.torches.length; i++) {
        var d = Math.hypot((x - sc.torches[i][0]) * asp, y - sc.torches[i][1]);
        if (d < 9) lt += (1 - d / 9) * .75;
      }
      light[y * COLS + x] = Math.min(1, lt);
    }
    // desenho
    c.fillStyle = p.bg; c.fillRect(0, 0, W, H);
    sc.torches.forEach(function (tc) {
      var cx = tc[0] * CW + CW / 2, cy = tc[1] * CH + CH / 2, gr = c.createRadialGradient(cx, cy, 0, cx, cy, CH * 7);
      gr.addColorStop(0, rgba(p.hot, .2)); gr.addColorStop(1, rgba(p.hot, 0));
      c.fillStyle = gr; c.fillRect(cx - CH * 7, cy - CH * 7, CH * 14, CH * 14);
    });
    setFont(c);
    var wl = function (x, y) { var v = at(x, y); return v === 3 || v === 4; };
    for (y = 0; y < BOT; y++) for (x = 0; x < COLS; x++) {
      var k2 = y * COLS + x, v = G[k2], li = light[k2];
      if (v === 0) { var hr = hash(x, y, 51); if (hr < .04) put(c, hr < .015 ? '`' : ',', x, y, rgba(p.wall, .14)); }
      else if (v === 1) put(c, '.', x, y, rgba(p.floor, .1 + li * .75));
      else if (v === 2) put(c, '#', x, y, rgba(p.corr, .28 + li * .5));
      else if (v === 4) put(c, '+', x, y, rgba(p.warm, .55 + li * .4));
      else if (v === 5) { put(c, '~', x, y, rgba(p.water, .3 + li * .5)); if (sc.water.length < 400) sc.water.push([x, y]); }
      else {
        var m = (wl(x, y - 1) ? 1 : 0) | (wl(x, y + 1) ? 2 : 0) | (wl(x - 1, y) ? 4 : 0) | (wl(x + 1, y) ? 8 : 0);
        var near = Math.max(light[k2 - 1] || 0, light[k2 + 1] || 0, light[k2 - COLS] || 0, light[k2 + COLS] || 0);
        put(c, WALLS[m], x, y, rgba(p.wall, .5 + near * .5));
      }
    }
    Object.keys(sc.objs).forEach(function (k3) { var o = sc.objs[k3], ox = k3 % COLS, oy = (k3 / COLS) | 0; put(c, o[0], ox, oy, rgba(o[1], .5 + light[k3] * .5)); });
    // aventureiro e bichinhos
    var walkable = [];
    for (i = 0; i < G.length; i++) if (G[i] === 1) walkable.push(i);
    var pick = function () { return walkable.length ? walkable[R() * walkable.length | 0] : 0; };
    var h0 = rooms.length ? rooms[0].cy * COLS + rooms[0].cx : pick();
    if (G[h0] !== 1) h0 = pick();
    sc.hero = { k: h0, path: [], i: 0, wait: 4, turn: 0, acc: 0 };
    var nc = Math.round(2 + dens * 4);
    for (i = 0; i < nc; i++) sc.critters.push({ k: pick(), ch: i % 2 ? 'r' : 'b', acc: 0 });
    return sc;
  }
  function bfs(G, from, to) {
    var N = G.length, prev = new Int32Array(N).fill(-1), q = new Int32Array(N), hd = 0, tl = 0;
    prev[from] = from; q[tl++] = from;
    while (hd < tl) {
      var k = q[hd++]; if (k === to) break;
      var x = k % COLS, nb = [x > 0 ? k - 1 : -1, x < COLS - 1 ? k + 1 : -1, k - COLS, k + COLS];
      for (var n = 0; n < 4; n++) { var m = nb[n]; if (m >= 0 && m < N && prev[m] < 0 && WALK[G[m]]) { prev[m] = k; q[tl++] = m; } }
    }
    if (prev[to] < 0) return [];
    var path = [];
    for (var c2 = to; c2 !== from; c2 = prev[c2]) path.push(c2);
    return path.reverse();
  }
  function dynDG(t, dt) {
    var sc = scene, p = palette, s = t / 1000, G = sc.G, i;
    setFont(ctx);
    for (i = 0; i < sc.water.length; i++) if (hash(Math.floor(s * 2.5 * P.speed) + i % 5, i, 8) < .28) put(ctx, '≈', sc.water[i][0], sc.water[i][1], rgba(p.water, .8));
    for (i = 0; i < sc.torches.length; i++) {
      var tc = sc.torches[i], fl = clamp(.55 + .45 * vnoise(s * 6 * P.speed + i * 3.1, i) + AU.beat * .45, 0, 1);
      ctx.fillStyle = rgba(p.hot, .12 * fl); ctx.fillRect((tc[0] - 1) * CW, (tc[1] - .5) * CH, 3 * CW, 2 * CH);
      put(ctx, '*', tc[0], tc[1], rgba(fl > .8 ? p.warm : p.hot, .5 + fl * .5));
    }
    // o aventureiro anda até uma sala sorteada, para um pouco e escolhe outra
    var h = sc.hero;
    h.acc += dt * 6 * P.speed;
    while (h.acc >= 1) {
      h.acc -= 1;
      if (h.wait > 0) { h.wait--; continue; }
      if (h.i >= h.path.length) {
        var r = sc.rooms[Math.random() * sc.rooms.length | 0];
        h.path = r ? bfs(G, h.k, r.cy * COLS + r.cx) : []; h.i = 0; h.wait = 8;
        continue;
      }
      h.k = h.path[h.i++]; h.turn++;
    }
    var hx = h.k % COLS, hy = (h.k / COLS) | 0, cx = hx * CW + CW / 2, cy = hy * CH + CH / 2;
    var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, CH * 5);
    gr.addColorStop(0, rgba(p.warm, .2)); gr.addColorStop(1, rgba(p.warm, 0));
    ctx.fillStyle = gr; ctx.fillRect(cx - CH * 5, cy - CH * 5, CH * 10, CH * 10);
    setFont(ctx, true); put(ctx, '@', hx, hy, p.fg); setFont(ctx);
    sc.critters.forEach(function (cr, j) {
      cr.acc += dt * (cr.ch === 'b' ? 4 : 1.6) * P.speed * (1 + AU.beat * 2);
      while (cr.acc >= 1) {
        cr.acc -= 1;
        var dirs = [cr.k - 1, cr.k + 1, cr.k - COLS, cr.k + COLS], nk = dirs[Math.random() * 4 | 0];
        if (nk >= 0 && nk < G.length && G[nk] === 1) cr.k = nk;
      }
      put(ctx, cr.ch, cr.k % COLS, (cr.k / COLS) | 0, rgba(cr.ch === 'b' ? p.mid : p.corr, .9));
    });
  }

  // ---------------------------------------------------------------- quadro
  var BUILD = { city: buildCity, starship: buildStar, datacenter: buildDC, dungeon: buildDG };
  var DYN = { city: dynCity, starship: dynStar, datacenter: dynDC, dungeon: dynDG };
  function build() {
    dirty = false;
    cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    scene = BUILD[mode](cctx);
    buildHud(cctx);
  }
  function draw(now) {
    now = now || performance.now();
    var dt = lastDraw ? clamp((now - lastDraw) / 1000, 0, .1) : .033; lastDraw = now;
    if (dirty || !scene) build();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cache, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    DYN[mode](now, dt);
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
  window.asciiWorld = { applySettings: applySettings };
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
