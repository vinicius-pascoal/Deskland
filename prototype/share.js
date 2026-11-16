// Deskland · 一键分享（所有主题页面共用，放在主题脚本后面加载）
// 把当前画面按屏幕的实际像素重新画一张，再在每个图标的位置画一个示例图标（文件夹、文档、图片、应用），
// 名字画成白色的圆角色块。不截屏：图标的样子和文件名一概不读，只用位置（是哪种图标、名字多长都是按位置随机编的），
// 所以图里不会露出任何文件名；设置窗口、别的窗口挡着桌面也没关系。
// 用到主题页面里的：cv（画布）、draw()、icons、W、H、WALL；部分主题另有 renderLabels()、cacheOK
// （2D 画布画的字、陆地上的画，画布大小变了要按新的大小重画）
// 窗口效果 API：宿主只负责提供矩形，主题页面负责选择风格和强度。
// 壁纸位于窗口下方，因此效果只会出现在窗口外侧，不遮挡窗口、不抢焦点。
(function () {
  const qs = new URLSearchParams(location.search);
  const wall = qs.has('wallpaper'), preview = qs.has('preview');
  if (!wall && !preview) return;

  const page = location.pathname.split('/').pop().toLowerCase();
  // Cada tema tem duas partes:
  //  - art: ilustração estática em volta da janela, desenhada num único canvas de tela cheia (pixels reais)
  //    e redesenhada só quando as janelas mudam — custo zero por quadro;
  //  - parts: poucos elementos pequenos animados (<b class="pN">), só com transform/opacity.
  // { nest: 1 } cria um <b> com outro <b> dentro (órbita: um eixo anima X, o filho anima Y).
  // Os textos são decorativos (letreiros/símbolos), nunca dados do usuário.
  const PROFILES = {
    flat:      { name: 'beach',     glow: 'rgba(61, 223, 224, .48)', halo: 'rgba(16, 145, 199, .26)', radius: '12px', parts: ['', '', '', ''] },
    meadow:    { name: 'meadow',    glow: 'rgba(145, 211, 92, .45)',  halo: 'rgba(54, 126, 56, .25)',  radius: '14px', parts: ['', '', '', ''] },
    space:     { name: 'space',     glow: 'rgba(139, 92, 246, .48)',  halo: 'rgba(52, 109, 255, .28)', radius: '9px',  parts: ['', '', '', { nest: 1 }] },
    desk:      { name: 'desk',      glow: 'rgba(244, 171, 76, .40)',  halo: 'rgba(131, 73, 30, .24)',  radius: '8px',  parts: ['', ''] },
    ide:       { name: 'ide',       glow: 'rgba(177, 101, 255, .48)', halo: 'rgba(71, 140, 255, .25)', radius: '6px',  parts: ['', 'Window.tsx ●'] },
    terminal:  { name: 'terminal',  glow: 'rgba(43, 220, 104, .45)',  halo: 'rgba(17, 104, 60, .25)',  radius: '4px',  parts: ['', '', '', '', '█', '1\n0\n1\n1\n0\n1'] },
    gitgraph:  { name: 'gitgraph',  glow: 'rgba(247, 120, 186, .43)', halo: 'rgba(88, 166, 255, .25)', radius: '7px',  parts: ['', 'HEAD → main'] },
    ast:       { name: 'ast',       glow: 'rgba(217, 72, 15, .38)',   halo: 'rgba(200, 191, 172, .24)', radius: '8px', parts: ['', ''] },
    dashboard: { name: 'dashboard', glow: 'rgba(87, 148, 242, .45)',  halo: 'rgba(115, 191, 105, .25)', radius: '7px', parts: ['', '', '', '', ''] },
    pond:      { name: 'pond',      glow: 'rgba(74, 196, 170, .43)',  halo: 'rgba(29, 102, 118, .27)', radius: '13px', parts: ['', ''] },
    nightcity: { name: 'nightcity', glow: 'rgba(255, 61, 127, .48)',  halo: 'rgba(61, 224, 255, .30)', radius: '5px',  parts: ['OPEN 24H', '', '', ''] },
    'ascii-city':     { name: 'ascii-city',     glow: 'rgba(61, 223, 224, .58)',  halo: 'rgba(255, 95, 190, .25)', radius: '2px', parts: ['+--[ CITY ]--', 'o=o>', '<o=o', '▚▞ 88 ▚▞'] },
    'ascii-starship': { name: 'ascii-starship', glow: 'rgba(122, 167, 255, .55)', halo: 'rgba(194, 156, 255, .28)', radius: '3px', parts: ['◢ HULL 98% ◣', '[ SHIELDS ]', '', 'NAV ▸ 0.82c'] },
    'ascii-datacenter': { name: 'ascii-datacenter', glow: 'rgba(124, 216, 255, .5)', halo: 'rgba(92, 255, 157, .22)', radius: '3px', parts: ['', '', '', 'NODE-07'] },
    'ascii-dungeon':    { name: 'ascii-dungeon',    glow: 'rgba(255, 170, 80, .45)', halo: 'rgba(255, 122, 47, .22)', radius: '2px', parts: ['', '', '@', ''] }
  };
  let activeProfile = PROFILES[page.replace(/\.html$/, '')] || PROFILES.flat;
  const DEFAULTS = { windowFx: 1, windowFxIntensity: .65 };

  // Caranguejo: anda de lado, balançando a cada passo.
  const CRAB_KF = Array.from({ length: 13 }, (_, i) =>
    `${(i * 100 / 12).toFixed(2)}% { transform: translateX(calc(var(--w) * ${(i * 0.045).toFixed(3)})) rotate(${i % 2 ? 5 : -5}deg); }`).join(' ');

  const style = document.createElement('style');
  style.textContent = `
    #deskland-window-effects { position: fixed; inset: 0; pointer-events: none; z-index: 1; overflow: visible; }
    #deskland-window-effects > canvas { position: absolute; left: 0; top: 0; pointer-events: none; }
    /* :where() zera a especificidade do id: assim .fx-tema e .fx-tema > .pN sobrescrevem a base. */
    :where(#deskland-window-effects) > i {
      position: absolute; display: block; box-sizing: border-box; pointer-events: none;
      border-radius: var(--fx-radius);
      box-shadow: 0 0 7px 1px var(--fx-glow), 0 0 18px 2px var(--fx-halo);
    }
    :where(#deskland-window-effects) > i::before,
    :where(#deskland-window-effects) > i::after { content: ''; position: absolute; pointer-events: none; }
    :where(#deskland-window-effects) > i b {
      position: absolute; display: block; pointer-events: none; white-space: pre;
      font: 600 10px/1 Consolas, 'Cascadia Mono', 'Segoe UI Symbol', monospace; letter-spacing: .5px;
    }
    #deskland-window-effects.paused *, #deskland-window-effects.paused *::before,
    #deskland-window-effects.paused *::after { animation-play-state: paused; }

    /* ---------- Praia ---------- */
    .fx-beach { box-shadow: 0 0 8px 1px var(--fx-glow), 0 0 22px 3px var(--fx-halo); }
    .fx-beach::before {
      left: 6%; right: 6%; bottom: -15px; height: 6px; border-radius: 50%; filter: blur(1px);
      background: radial-gradient(ellipse at 15% 50%, rgba(255,255,255,.85) 0 8%, transparent 20%),
                  radial-gradient(ellipse at 45% 55%, rgba(224,255,249,.7) 0 9%, transparent 22%),
                  radial-gradient(ellipse at 78% 45%, rgba(255,255,255,.8) 0 7%, transparent 19%);
      animation: dwfx-foam 3.4s ease-in-out infinite;
    }
    .fx-beach::after {
      left: -14%; top: -3px; width: 28%; height: 3px; border-radius: 50%; filter: blur(.5px);
      background: linear-gradient(90deg, transparent, rgba(255,250,220,.95), transparent);
      animation: dwfx-shimmer 3.2s linear infinite;
    }
    .fx-beach > .p1 {
      left: 0; right: 0; bottom: -21px; height: 5px;
      background: radial-gradient(circle at 50% 0, transparent 3px, rgba(255,255,255,.85) 3.5px 4.5px, transparent 5px) 0 0 / 12px 6px repeat-x;
      animation: dwfx-drift 3s ease-in-out infinite alternate;
    }
    .fx-beach > .p2, .fx-beach > .p3 {
      width: 5px; height: 5px; border-radius: 50%; border: 1px solid rgba(224,255,249,.9);
      box-shadow: inset -1px -1px 0 rgba(255,255,255,.6); animation: dwfx-bubble 4.2s ease-out infinite;
    }
    .fx-beach > .p2 { right: -10px; bottom: 30%; }
    .fx-beach > .p3 { left: -10px; bottom: 45%; animation-delay: -1.9s; animation-duration: 5s; }
    .fx-beach > .p4 {
      left: 8%; bottom: -14px; width: 16px; height: 9px;
      background: radial-gradient(circle at 34% 18%, #111 0 1px, transparent 1.4px), radial-gradient(circle at 66% 18%, #111 0 1px, transparent 1.4px),
                  radial-gradient(circle at 6% 42%, #e8553a 0 2.2px, transparent 2.6px), radial-gradient(circle at 94% 42%, #e8553a 0 2.2px, transparent 2.6px),
                  radial-gradient(ellipse 5.5px 3.6px at 50% 62%, #e8553a 0 92%, transparent 100%),
                  linear-gradient(60deg, transparent 44%, #c43f28 45% 55%, transparent 56%) 20% 100% / 4px 3px no-repeat,
                  linear-gradient(-60deg, transparent 44%, #c43f28 45% 55%, transparent 56%) 80% 100% / 4px 3px no-repeat;
      filter: drop-shadow(0 1px 0 rgba(120,80,40,.35));
      animation: dwfx-crab 14s ease-in-out infinite alternate;
    }

    /* ---------- Prado ---------- */
    .fx-meadow { box-shadow: 0 5px 16px 2px rgba(54,126,56,.28), 0 0 18px 2px var(--fx-halo); }
    .fx-meadow::before { content: none; }
    .fx-meadow::after {
      left: 8%; right: 8%; top: -7px; height: 0; border-top: 1px dotted rgba(223,246,155,.6);
      animation: dwfx-pollen 5s ease-in-out infinite;
    }
    .fx-meadow > .p1, .fx-meadow > .p2 { top: -18px; width: 11px; height: 8px; animation: dwfx-butterfly 7s ease-in-out infinite; }
    .fx-meadow > .p1 { right: 16%;
      background: radial-gradient(ellipse at 25% 50%, rgba(255,214,102,.95) 0 2.8px, transparent 3.2px),
                  radial-gradient(ellipse at 75% 50%, rgba(255,160,80,.95) 0 2.8px, transparent 3.2px),
                  linear-gradient(#3a2a1a, #3a2a1a) 50% 50% / 1px 6px no-repeat; }
    .fx-meadow > .p2 { left: 24%; top: -26px; animation-duration: 9s; animation-delay: -3s;
      background: radial-gradient(ellipse at 25% 50%, rgba(140,200,255,.95) 0 2.8px, transparent 3.2px),
                  radial-gradient(ellipse at 75% 50%, rgba(190,160,255,.95) 0 2.8px, transparent 3.2px),
                  linear-gradient(#2a2a3a, #2a2a3a) 50% 50% / 1px 6px no-repeat; }
    .fx-meadow > .p3 {
      left: 5%; bottom: -10px; width: 8px; height: 5px; border-radius: 50%;
      background: repeating-linear-gradient(90deg, #ffcc33 0 1.6px, #2a2218 1.6px 2.8px);
      box-shadow: -1px -3px 0 -1px rgba(235,250,255,.9), 2px -3px 0 -1px rgba(235,250,255,.75);
      animation: dwfx-bee 3.2s ease-in-out infinite;
    }
    .fx-meadow > .p4 {
      left: 30%; top: -11px; width: 7px; height: 6px; border-radius: 50% 50% 45% 45%;
      background: radial-gradient(circle at 30% 45%, #111 0 .9px, transparent 1.3px), radial-gradient(circle at 70% 60%, #111 0 .9px, transparent 1.3px),
                  radial-gradient(circle at 62% 28%, #111 0 .8px, transparent 1.2px), linear-gradient(90deg, transparent 47%, #111 48% 52%, transparent 53%), #e0302a;
      box-shadow: -2.5px 0 0 -1px #1a1a1a;
      animation: dwfx-ladybug 16s linear infinite alternate;
    }

    /* ---------- Espaço ---------- */
    .fx-space { box-shadow: 0 0 7px 1px var(--fx-glow), 0 0 18px 2px var(--fx-halo), 0 0 34px 6px rgba(52,109,255,.1); }
    .fx-space::before {
      left: 4%; right: 4%; top: -14px; height: 12px; border-radius: 50%; filter: blur(1px);
      background: radial-gradient(ellipse at 50% 60%, rgba(139,92,246,.22), transparent 70%);
      animation: dwfx-stars 6s ease-in-out infinite;
    }
    .fx-space::after { content: none; }
    .fx-space > .p1 {
      left: 0; top: -4px; width: 64px; height: 2px; border-radius: 2px;
      background: linear-gradient(90deg, transparent, rgba(207,190,255,.55) 70%, #fff);
      box-shadow: 30px 0 6px rgba(207,190,255,.4); animation: dwfx-comet 7s linear infinite;
    }
    .fx-space > .p2, .fx-space > .p3 {
      width: 11px; height: 11px;
      background: linear-gradient(transparent 5px, #fff 5px 6px, transparent 6px), linear-gradient(90deg, transparent 5px, #fff 5px 6px, transparent 6px),
                  radial-gradient(circle, rgba(207,190,255,.9) 0 1.5px, transparent 4px);
      animation: dwfx-twinkle 2.6s ease-in-out infinite;
    }
    .fx-space > .p2 { right: -16px; bottom: 22%; }
    .fx-space > .p3 { left: 38%; bottom: -14px; animation-delay: -1.3s; animation-duration: 3.4s; }
    .fx-space > .p4 { left: 50%; top: 50%; width: 0; height: 0; animation: dwfx-ox 9s ease-in-out infinite alternate; }
    .fx-space > .p4 > b {
      left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #fff, #c4b5fd 55%, #4c1d95); box-shadow: 0 0 7px rgba(196,181,253,.9);
      animation: dwfx-oy 9s -4.5s ease-in-out infinite alternate;
    }

    /* ---------- Escrivaninha ---------- */
    .fx-desk { box-shadow: 5px 6px 0 -1px #f4ecdc, 9px 11px 0 -2px #e2d3b6, 10px 12px 0 -1px rgba(90,50,20,.22), 0 10px 22px 4px rgba(100,55,25,.32), 0 0 12px 1px var(--fx-glow); }
    .fx-desk::before { content: none; }
    .fx-desk::after {
      top: -4px; left: 30%; width: 30%; height: 3px; border-radius: 50%; filter: blur(1px);
      background: linear-gradient(90deg, transparent, rgba(255,221,157,.85), transparent);
      animation: dwfx-lamp 4s ease-in-out infinite;
    }
    .fx-desk > .p1, .fx-desk > .p2 {
      left: calc(100% + 18px); top: calc(68% - 34px); width: 6px; height: 18px; border-left: 2px solid rgba(255,248,235,.9);
      border-radius: 50%; filter: blur(.4px); animation: dwfx-steam 3.2s ease-out infinite;
    }
    .fx-desk > .p2 { left: calc(100% + 25px); animation-delay: -1.6s; }

    /* ---------- Editor ---------- */
    .fx-ide::before {
      left: -18%; width: 24%; top: -3px; height: 2px; border-radius: 2px; filter: blur(.5px);
      background: linear-gradient(90deg, transparent, rgba(192,176,255,.9), transparent);
      animation: dwfx-scan 2.6s linear infinite;
    }
    .fx-ide::after {
      top: 9%; bottom: 9%; left: -3px; width: 2px; background: var(--fx-glow); filter: blur(.5px);
      animation: dwfx-blink 1.8s steps(2, end) infinite;
    }
    .fx-ide > .p1 {
      left: calc(100% + 3px); top: 2px; width: 22px; height: 16%; box-sizing: border-box; border-radius: 2px;
      background: rgba(177,101,255,.18); border: 1px solid rgba(192,176,255,.55);
      animation: dwfx-scroll 5s ease-in-out infinite alternate;
    }
    .fx-ide > .p2 {
      left: 10px; top: -16px; padding: 2px 8px 4px; border-radius: 5px 5px 0 0; color: rgba(235,228,255,.95);
      background: linear-gradient(rgba(177,101,255,.45), rgba(177,101,255,.12)); border-top: 2px solid rgba(192,176,255,.9);
    }

    /* ---------- Terminal ---------- */
    .fx-terminal { box-shadow: 0 0 6px 1px var(--fx-glow), 0 0 15px 1px var(--fx-halo); }
    .fx-terminal::before {
      left: -18%; width: 24%; top: -6px; height: 2px; border-radius: 2px; filter: blur(.5px);
      background: linear-gradient(90deg, transparent, rgba(154,255,177,.9), transparent);
      animation: dwfx-scan 3.4s linear infinite;
    }
    .fx-terminal::after { content: none; }
    .fx-terminal > .p1, .fx-terminal > .p2, .fx-terminal > .p3, .fx-terminal > .p4 {
      width: 13px; height: 13px; border: 0 solid rgba(154,255,177,.9); filter: drop-shadow(0 0 2px rgba(43,220,104,.9));
    }
    .fx-terminal > .p1 { left: -12px; top: -12px; border-top-width: 2px; border-left-width: 2px; }
    .fx-terminal > .p2 { right: -12px; top: -12px; border-top-width: 2px; border-right-width: 2px; }
    .fx-terminal > .p3 { left: -12px; top: calc(100% - 1px); border-bottom-width: 2px; border-left-width: 2px; }
    .fx-terminal > .p4 { right: -12px; top: calc(100% - 1px); border-bottom-width: 2px; border-right-width: 2px; }
    .fx-terminal > .p5 {
      right: -6px; top: calc(100% + 13px); font-size: 10px; color: #c8ffd4;
      animation: dwfx-blink 1s steps(2, end) infinite;
    }
    .fx-terminal > .p6 {
      right: -24px; top: 14%; font-size: 8px; line-height: 1.15; color: rgba(154,255,177,.9);
      text-shadow: 0 0 4px rgba(43,220,104,.9); animation: dwfx-fall 2.6s linear infinite;
    }

    /* ---------- Git ---------- */
    .fx-gitgraph::before { content: none; }
    .fx-gitgraph::after { left: 30%; right: 30%; top: -3px; height: 2px; background: linear-gradient(90deg, #f778ba, #58a6ff, #7ee787); animation: dwfx-data 2.4s linear infinite; }
    .fx-gitgraph > .p1 {
      left: -13px; top: 6%; width: 6px; height: 6px; border-radius: 50%; background: #c9f7cf; box-shadow: 0 0 6px #7ee787, 0 0 2px #fff;
      animation: dwfx-down 3.6s linear infinite;
    }
    .fx-gitgraph > .p2 {
      left: 14px; top: -17px; padding: 2px 7px 3px; border-radius: 8px; color: #0d1117;
      background: linear-gradient(90deg, #7ee787, #58a6ff); box-shadow: 0 0 6px rgba(88,166,255,.5);
    }

    /* ---------- Árvore sintática ---------- */
    /* A janela vira um nó da árvore do wallpaper: as cores vêm da paleta atual (--acc / --soft), o ponto de
       parse desce pela curva que liga a janela ao nó acima (--path) e acende o título do bloco. */
    .fx-ast { box-shadow: 0 0 0 1px var(--fx-halo), 0 6px 18px rgba(0,0,0,.12), 0 0 12px 2px var(--fx-glow); }
    .fx-ast::before, .fx-ast::after { content: none; }
    .fx-ast > .p1 {
      display: var(--dot, none); left: 0; top: 0; width: 6px; height: 6px; border-radius: 50%;
      background: var(--acc); box-shadow: 0 0 0 4px var(--soft);
      offset-path: var(--path); offset-anchor: center; offset-rotate: 0deg;
      animation: dwfx-parse 5s ease-in-out infinite;
    }
    .fx-ast > .p2 {
      left: calc(50% - var(--hw) / 2); top: -19px; width: var(--hw); height: 22px; box-sizing: border-box; border-radius: 11px;
      border: 1.6px solid var(--acc); background: var(--soft); opacity: 0;
      animation: dwfx-parsehi 5s ease-out infinite;
    }

    /* ---------- Dashboard ---------- */
    .fx-dashboard::before, .fx-dashboard::after { content: none; }
    .fx-dashboard > .p1 {
      left: 23px; top: -21px; width: 2px; height: 13px; border-radius: 1px; background: #e6edf3; transform-origin: 50% 100%;
      box-shadow: 0 0 3px rgba(230,237,243,.7); animation: dwfx-needle 3.2s ease-in-out infinite alternate;
    }
    .fx-dashboard > .p2 {
      left: calc(var(--ax) - 3px); top: calc(var(--ay) - 3px); width: 6px; height: 6px; border-radius: 50%;
      background: #5794f2; box-shadow: 0 0 6px #5794f2; animation: dwfx-node 1.4s ease-in-out infinite;
    }
    .fx-dashboard > .p3, .fx-dashboard > .p4, .fx-dashboard > .p5 {
      top: -17px; width: 4px; height: 13px; border-radius: 1px; transform-origin: 50% 100%;
      animation: dwfx-bar 1.4s ease-in-out infinite alternate;
    }
    .fx-dashboard > .p3 { left: 48px; background: #73bf69; }
    .fx-dashboard > .p4 { left: 54px; background: #5794f2; animation-duration: 1.9s; }
    .fx-dashboard > .p5 { left: 60px; background: #fade2a; animation-duration: 1.1s; }

    /* ---------- Lago ---------- */
    .fx-pond::before, .fx-pond::after { left: 25%; right: 25%; bottom: -12px; height: 16px; border: 1px solid rgba(200,255,235,.55); border-radius: 50%; }
    .fx-pond::before { animation: dwfx-ripple 3.2s ease-out infinite; }
    .fx-pond::after { animation: dwfx-ripple 3.2s 1.1s ease-out infinite; }
    .fx-pond > .p1 {
      left: 0; top: calc(100% + 18px); width: 22px; height: 9px;
      background: radial-gradient(2.6px 1.9px at 13px 3.6px, #fff 0 90%, transparent 100%),
                  radial-gradient(1.6px 1.4px at 17px 5.4px, #fff 0 90%, transparent 100%),
                  radial-gradient(6px 3.6px at 14px 4.5px, #ff6a1f 0 94%, transparent 100%),
                  conic-gradient(from 240deg at 9px 4.5px, rgba(255,140,60,.9) 0 60deg, transparent 0);
      filter: drop-shadow(0 2px 1px rgba(0,40,40,.35));
      animation: dwfx-koi 12s linear infinite;
    }
    .fx-pond > .p2 {
      left: -30px; top: -24px; width: 18px; height: 11px;
      background: radial-gradient(1.6px 1.6px at 16px 5.5px, #1f6f6a 0 90%, transparent 100%),
                  linear-gradient(#2fb8b0, #2fb8b0) 2px 50% / 13px 1.8px no-repeat,
                  radial-gradient(4.5px 1.8px at 7px 2.6px, rgba(220,255,255,.75) 0 90%, transparent 100%), radial-gradient(4.5px 1.8px at 11px 2.6px, rgba(220,255,255,.75) 0 90%, transparent 100%),
                  radial-gradient(4.5px 1.8px at 7px 8.4px, rgba(220,255,255,.75) 0 90%, transparent 100%), radial-gradient(4.5px 1.8px at 11px 8.4px, rgba(220,255,255,.75) 0 90%, transparent 100%);
      animation: dwfx-hover 5s ease-in-out infinite;
    }

    /* ---------- Cidade noturna ---------- */
    .fx-nightcity { box-shadow: -3px 0 10px -2px rgba(61,224,255,.45), 3px 0 10px -2px rgba(255,61,127,.45), 0 0 18px 2px var(--fx-halo); }
    .fx-nightcity::before { left: 2%; right: 2%; top: -16px; height: 13px; background: repeating-linear-gradient(112deg, transparent 0 16px, rgba(61,224,255,.38) 17px 18px, transparent 19px 32px); opacity: .6; animation: dwfx-rain 1.6s linear infinite; }
    .fx-nightcity::after { left: 8%; right: 8%; bottom: -5px; height: 3px; background: linear-gradient(90deg, #ff3d7f, #ffd58a, #3de0ff); filter: blur(1px); animation: dwfx-neon 2.1s ease-in-out infinite; }
    .fx-nightcity > .p1 {
      right: 12px; top: -19px; padding: 2px 5px; border: 1.5px solid #ff6fae; border-radius: 3px;
      font-weight: 700; letter-spacing: 1.5px; color: #ffd6ec;
      text-shadow: 0 0 3px #ff3d7f, 0 0 8px #ff3d7f; box-shadow: 0 0 6px #ff3d7f, inset 0 0 4px rgba(255,61,127,.6);
      animation: dwfx-flicker 4.5s linear infinite;
    }
    .fx-nightcity > .p2, .fx-nightcity > .p3 { width: 2px; border-radius: 2px; }
    .fx-nightcity > .p2 { left: -7px; top: 34%; bottom: 14%; background: #3de0ff; box-shadow: 0 0 6px #3de0ff; }
    .fx-nightcity > .p3 { right: -7px; top: 32%; bottom: 40%; background: #ff3d7f; box-shadow: 0 0 6px #ff3d7f; animation: dwfx-flicker 6s 1.3s linear infinite; }
    .fx-nightcity > .p4 {
      left: calc(28% - 2px); top: -28px; width: 4px; height: 4px; border-radius: 50%; background: #ff2b2b;
      box-shadow: 0 0 6px 1px #ff2b2b; animation: dwfx-blink 1.6s steps(2, end) infinite;
    }

    /* ---------- ASCII City ---------- */
    .fx-ascii-city::before, .fx-ascii-city::after { content: none; }
    .fx-ascii-city > b { color: rgba(114,246,255,.95); text-shadow: 0 0 4px rgba(61,223,224,.85); }
    .fx-ascii-city > .p1 { left: -4px; top: -15px; }
    .fx-ascii-city > .p2 { left: 0; top: calc(100% + 11px); color: #ffd166; text-shadow: 0 0 4px rgba(255,209,102,.8); animation: dwfx-drive 8s linear infinite; }
    .fx-ascii-city > .p3 { right: 0; top: -54px; color: #ff5fbe; text-shadow: 0 0 4px rgba(255,95,190,.85); animation: dwfx-fly 11s linear infinite; }
    .fx-ascii-city > .p4 { right: 6px; top: -15px; color: #ff5fbe; text-shadow: 0 0 4px rgba(255,95,190,.8); animation: dwfx-blink 1.6s steps(2, end) infinite; }

    /* ---------- ASCII Starship Bridge ---------- */
    .fx-ascii-starship::before { content: none; }
    .fx-ascii-starship::after { left: 30%; right: 30%; top: -4px; height: 3px; background: linear-gradient(90deg, transparent, rgba(255,95,190,.85), rgba(169,240,255,.9), transparent); animation: dwfx-neon 1.9s ease-in-out infinite; }
    .fx-ascii-starship > b { color: rgba(169,240,255,.95); text-shadow: 0 0 4px rgba(122,167,255,.85); }
    .fx-ascii-starship > .p1 { left: 18px; top: -17px; }
    .fx-ascii-starship > .p2 { right: 12px; top: calc(100% + 12px); color: rgba(194,156,255,.95); animation: dwfx-glowtext 2.2s ease-in-out infinite; }
    .fx-ascii-starship > .p3 {
      left: calc(100% - 2px); top: -36px; width: 36px; height: 36px; border-radius: 50%;
      background: conic-gradient(from 0deg, rgba(169,240,255,.6), rgba(169,240,255,0) 24%, transparent);
      animation: dwfx-spin 2.6s linear infinite;
    }
    .fx-ascii-starship > .p4 { left: 14px; top: calc(100% + 12px); animation: dwfx-glowtext 3s ease-in-out infinite; }

    /* ---------- ASCII Data Center: LEDs na orelha do rack, pacote descendo pelo cabo, etiqueta do nó ---------- */
    .fx-ascii-datacenter::before, .fx-ascii-datacenter::after { content: none; }
    .fx-ascii-datacenter > .p1, .fx-ascii-datacenter > .p2 {
      left: calc(100% + 5px); width: 4px; height: 4px; border-radius: 50%; animation: dwfx-blink .9s steps(2, end) infinite;
    }
    .fx-ascii-datacenter > .p1 { top: 14px; background: #5cff9d; box-shadow: 0 0 5px #5cff9d; }
    .fx-ascii-datacenter > .p2 { top: 24px; background: #ffd166; box-shadow: 0 0 5px #ffd166; animation-duration: 1.7s; }
    .fx-ascii-datacenter > .p3 {
      left: calc(30% + 9.5px); top: 100%; width: 5px; height: 5px; border-radius: 50%;
      background: #e8f6ff; box-shadow: 0 0 6px #7cd8ff; animation: dwfx-cable 1.8s linear infinite;
    }
    .fx-ascii-datacenter > .p4 {
      left: 10px; top: -17px; padding: 2px 6px; border-radius: 2px; color: #7cd8ff;
      background: #16202e; border: 1px solid rgba(124,216,255,.6); text-shadow: 0 0 4px rgba(124,216,255,.7);
    }

    /* ---------- ASCII Dungeon: chamas das tochas, aventureiro andando e morcego ---------- */
    .fx-ascii-dungeon::before, .fx-ascii-dungeon::after { content: none; }
    .fx-ascii-dungeon > .p1, .fx-ascii-dungeon > .p2 {
      top: -5px; width: 6px; height: 9px; border-radius: 50% 50% 40% 40%; transform-origin: 50% 100%;
      background: radial-gradient(ellipse at 50% 70%, #fff3b0 0 25%, #ffb347 45%, #ff6a1f 70%, transparent 72%);
      box-shadow: 0 0 10px 3px rgba(255,140,50,.45); animation: dwfx-flame .5s ease-in-out infinite alternate;
    }
    .fx-ascii-dungeon > .p1 { left: -18px; }
    .fx-ascii-dungeon > .p2 { left: calc(100% + 12px); animation-delay: -.25s; }
    .fx-ascii-dungeon > .p3 {
      left: 0; top: calc(100% + 12px); font-size: 11px; color: #f2e6c8; text-shadow: 0 0 6px rgba(255,211,107,.9);
      animation: dwfx-drive 14s linear infinite;
    }
    .fx-ascii-dungeon > .p4 {
      left: 40%; top: -24px; width: 14px; height: 6px; animation: dwfx-butterfly 5s ease-in-out infinite;
      background: radial-gradient(4px 2.2px at 25% 40%, #b3a587 0 90%, transparent 100%), radial-gradient(4px 2.2px at 75% 40%, #b3a587 0 90%, transparent 100%),
                  radial-gradient(circle at 50% 55%, #8a7b66 0 2px, transparent 2.4px);
    }

    @keyframes dwfx-foam { 0%,100% { transform: scaleX(.86); opacity: .55; } 50% { transform: scaleX(1); opacity: .95; } }
    @keyframes dwfx-shimmer { from { transform: translateX(-20%); } to { transform: translateX(480%); } }
    @keyframes dwfx-drift { from { transform: translateX(-6px); opacity: .55; } to { transform: translateX(6px); opacity: .95; } }
    @keyframes dwfx-bubble { 0% { transform: translateY(6px) scale(.5); opacity: 0; } 20% { opacity: .9; } 100% { transform: translateY(-46px) scale(1); opacity: 0; } }
    @keyframes dwfx-crab { ${CRAB_KF} }
    @keyframes dwfx-pollen { 0%,100% { opacity: .25; transform: scaleX(.97); } 50% { opacity: .75; transform: scaleX(1.02); } }
    @keyframes dwfx-butterfly {
      0%,100% { transform: translate(0,0) scaleX(1); } 12% { transform: translate(-8px,-4px) scaleX(.35); }
      25% { transform: translate(-18px,-2px) scaleX(1); } 37% { transform: translate(-26px,3px) scaleX(.35); }
      50% { transform: translate(-32px,0) scaleX(1); } 62% { transform: translate(-22px,-5px) scaleX(.35); }
      75% { transform: translate(-12px,-1px) scaleX(1); } 87% { transform: translate(-4px,3px) scaleX(.35); }
    }
    @keyframes dwfx-bee {
      0%,100% { transform: translate(0,0); } 20% { transform: translate(9px,-6px); } 40% { transform: translate(18px,-1px); }
      60% { transform: translate(10px,4px); } 80% { transform: translate(2px,-3px); }
    }
    @keyframes dwfx-ladybug { from { transform: translateX(0); } to { transform: translateX(calc(var(--w) * .4)); } }
    @keyframes dwfx-stars { 0%,100% { opacity: .35; } 50% { opacity: .8; } }
    @keyframes dwfx-spin { to { transform: rotate(360deg); } }
    @keyframes dwfx-comet { 0% { transform: translateX(-64px); opacity: 0; } 8% { opacity: 1; } 55% { transform: translateX(var(--w)); opacity: 0; } 100% { transform: translateX(var(--w)); opacity: 0; } }
    @keyframes dwfx-twinkle { 0%,100% { transform: scale(.35) rotate(0); opacity: .2; } 50% { transform: scale(1) rotate(45deg); opacity: .95; } }
    @keyframes dwfx-ox { from { transform: translateX(calc(var(--rx) * -1)); } to { transform: translateX(var(--rx)); } }
    @keyframes dwfx-oy { from { transform: translateY(calc(var(--ry) * -1)); } to { transform: translateY(var(--ry)); } }
    @keyframes dwfx-lamp { 0%,100% { opacity: .35; transform: scaleX(.7); } 50% { opacity: .85; transform: scaleX(1); } }
    @keyframes dwfx-steam { 0% { transform: translateY(6px) scaleY(.5); opacity: 0; } 35% { opacity: .8; } 100% { transform: translateY(-14px) scaleY(1.1) skewX(12deg); opacity: 0; } }
    @keyframes dwfx-scan { from { transform: translateX(0); } to { transform: translateX(500%); } }
    @keyframes dwfx-blink { 0%,45% { opacity: .2; } 50%,100% { opacity: .9; } }
    @keyframes dwfx-scroll { from { transform: translateY(0); } to { transform: translateY(calc(var(--h) * .82)); } }
    @keyframes dwfx-fall { 0% { transform: translateY(-8px); opacity: 0; } 20% { opacity: .9; } 100% { transform: translateY(40px); opacity: 0; } }
    @keyframes dwfx-node { 0%,100% { transform: scale(.8); opacity: .45; } 50% { transform: scale(1.15); opacity: 1; } }
    @keyframes dwfx-data { from { transform: translateX(-8%); } to { transform: translateX(8%); } }
    @keyframes dwfx-down { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: 1; } 92% { opacity: 1; } 100% { transform: translateY(calc(var(--h) * .88 - 6px)); opacity: 0; } }
    @keyframes dwfx-parse { 0% { offset-distance: 0%; opacity: 0; } 5% { opacity: 1; } 38% { offset-distance: 100%; opacity: 1; } 44%, 100% { offset-distance: 100%; opacity: 0; } }
    @keyframes dwfx-parsehi { 0%, 36% { opacity: 0; } 42% { opacity: 1; } 75%, 100% { opacity: 0; } }
    @keyframes dwfx-glowtext { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes dwfx-needle { from { transform: rotate(-70deg); } to { transform: rotate(45deg); } }
    @keyframes dwfx-bar { from { transform: scaleY(.25); } to { transform: scaleY(1); } }
    @keyframes dwfx-ripple { 0% { transform: scaleX(.65); opacity: .7; } 100% { transform: scaleX(1.2) translateY(5px); opacity: 0; } }
    @keyframes dwfx-koi { 0% { transform: translateX(-24px); opacity: 0; } 6% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(var(--w)); opacity: 0; } }
    @keyframes dwfx-hover {
      0%,100% { transform: translate(0,0); } 18% { transform: translate(2px,-2px); } 30% { transform: translate(16px,3px); }
      48% { transform: translate(17px,1px); } 62% { transform: translate(6px,-4px); } 80% { transform: translate(7px,-3px); }
    }
    @keyframes dwfx-rain { from { transform: translateX(-8px); } to { transform: translateX(8px); } }
    @keyframes dwfx-neon { 0%,100% { opacity: .3; transform: scaleX(.7); } 50% { opacity: .95; transform: scaleX(1); } }
    @keyframes dwfx-flicker { 0%,40%,44%,47%,100% { opacity: 1; } 42%,45.5% { opacity: .25; } 70% { opacity: .85; } }
    @keyframes dwfx-drive { 0% { transform: translateX(-30px); opacity: 0; } 5% { opacity: 1; } 95% { opacity: 1; } 100% { transform: translateX(var(--w)); opacity: 0; } }
    @keyframes dwfx-fly { 0% { transform: translateX(30px); opacity: 0; } 5% { opacity: 1; } 95% { opacity: 1; } 100% { transform: translateX(calc(var(--w) * -1)); opacity: 0; } }
    @keyframes dwfx-cable { 0% { transform: translate(0, 0); opacity: 0; } 10% { opacity: 1; } 100% { transform: translate(-1px, 44px); opacity: 0; } }
    @keyframes dwfx-flame { from { transform: scale(.85, .9) skewX(-4deg); opacity: .85; } to { transform: scale(1.05, 1.15) skewX(5deg); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { #deskland-window-effects *, #deskland-window-effects *::before, #deskland-window-effects *::after { animation: none !important; } }
  `;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.id = 'deskland-window-effects';
  document.body.appendChild(layer);
  const artCanvas = document.createElement('canvas');
  const ghosts = document.getElementById('ghosts');
  if (ghosts) ghosts.style.zIndex = '2';

  // ---------------------------------------------------------------- ilustrações estáticas
  const MONO = "Consolas, 'Cascadia Mono', 'Segoe UI Symbol', monospace";
  const TAU = Math.PI * 2;
  function seeded(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rrPath(c, x, y, w, h, r) {
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); rrPath(c, x, y, w, h, r); }
  function dot(c, x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }
  function label(c, cx, cy, text, fill, stroke, color) {
    c.font = `9px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const tw = c.measureText(text).width + 10;
    rr(c, cx - tw / 2, cy - 7, tw, 14, 3); c.fillStyle = fill; c.fill();
    c.lineWidth = 1; c.strokeStyle = stroke; c.stroke();
    c.fillStyle = color; c.fillText(text, cx, cy + .5);
  }

  function shell(c, cx, cy, s, rot, col) {
    c.save(); c.translate(cx, cy); c.rotate(rot);
    c.beginPath(); c.moveTo(0, s * .55); c.arc(0, 0, s, Math.PI * 1.05, Math.PI * 1.95); c.closePath();
    c.fillStyle = col; c.fill(); c.lineWidth = .8; c.strokeStyle = 'rgba(170,110,90,.65)'; c.stroke();
    c.beginPath();
    for (let i = 1; i < 5; i++) { const a = Math.PI * (1.05 + .9 * i / 5); c.moveTo(0, s * .55); c.lineTo(Math.cos(a) * s, Math.sin(a) * s); }
    c.lineWidth = .6; c.stroke(); c.restore();
  }
  function starfish(c, cx, cy, r, rot, col) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot - Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .42 : r;
      c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    c.closePath(); c.fillStyle = col; c.fill(); c.lineWidth = .8; c.strokeStyle = 'rgba(170,70,30,.6)'; c.stroke();
    for (let i = 0; i < 5; i++) { const a = rot - Math.PI / 2 + i * TAU / 5; dot(c, cx + Math.cos(a) * r * .5, cy + Math.sin(a) * r * .5, .7, 'rgba(255,220,180,.9)'); }
  }
  function mushroom(c, cx, cy, s) {
    c.fillStyle = '#f3ead6'; c.fillRect(cx - s * .22, cy - s * .9, s * .44, s * .9);
    c.beginPath(); c.ellipse(cx, cy - s * .85, s * .85, s * .6, 0, Math.PI, TAU); c.closePath();
    c.fillStyle = '#d93a2f'; c.fill();
    dot(c, cx - s * .35, cy - s * 1.1, s * .12, '#fff'); dot(c, cx + s * .25, cy - s * 1.2, s * .1, '#fff'); dot(c, cx + s * .05, cy - s * .95, s * .09, '#fff');
  }
  function vine(c, sx, sy, len, side, R) {
    const pts = [];
    for (let t = 0; t <= len; t += 3) pts.push([sx + side * Math.abs(Math.sin(t * .09 + 1)) * 4, sy - t]);
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
    c.strokeStyle = '#3f8a2e'; c.lineWidth = 1.6; c.stroke();
    for (let i = 3; i < pts.length; i += 4) {
      const [px, py] = pts[i], s = 1 - i / pts.length * .5;
      c.save(); c.translate(px, py); c.rotate(side * (.7 + R() * .5) - Math.PI / 2 * (i % 8 < 4 ? 1 : 1.25));
      c.beginPath(); c.ellipse(5 * s, 0, 5 * s, 2.3 * s, 0, 0, TAU); c.fillStyle = i % 8 < 4 ? '#5fae3e' : '#4b9a35'; c.fill();
      c.beginPath(); c.moveTo(0, 0); c.lineTo(9 * s, 0); c.strokeStyle = 'rgba(200,240,160,.45)'; c.lineWidth = .5; c.stroke();
      c.restore();
    }
    const [tx, ty] = pts[pts.length - 1];
    c.beginPath(); c.arc(tx + side * 2.5, ty, 2.5, Math.PI, TAU * .95); c.strokeStyle = '#3f8a2e'; c.lineWidth = 1; c.stroke();
  }
  function lilyPad(c, cx, cy, r, rot) {
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, rot + .22, rot + TAU - .22); c.closePath();
    const g = c.createRadialGradient(cx - r * .3, cy - r * .3, 1, cx, cy, r);
    g.addColorStop(0, '#86d17c'); g.addColorStop(1, '#2f7d4a');
    c.fillStyle = g; c.fill(); c.lineWidth = .8; c.strokeStyle = 'rgba(20,70,40,.6)'; c.stroke();
    c.beginPath();
    for (let i = 0; i < 7; i++) { const a = rot + .22 + (TAU - .44) * i / 6; c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r * .85, cy + Math.sin(a) * r * .85); }
    c.strokeStyle = 'rgba(190,240,180,.35)'; c.lineWidth = .6; c.stroke();
  }
  function lotus(c, cx, cy) {
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      c.beginPath(); c.ellipse(cx + Math.cos(a) * 3.6, cy + Math.sin(a) * 2.4, 3.8, 1.9, a, 0, TAU);
      c.fillStyle = '#f7a8c8'; c.fill(); c.strokeStyle = 'rgba(229,122,166,.8)'; c.lineWidth = .5; c.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5 + .3;
      c.beginPath(); c.ellipse(cx + Math.cos(a) * 1.8, cy + Math.sin(a) * 1.3, 2.4, 1.2, a, 0, TAU); c.fillStyle = '#ffd6e7'; c.fill();
    }
    dot(c, cx, cy, 1.5, '#ffd34d');
  }

  const ART = {
    beach(c, x, y, w, h, R) {
      const L = x - 18, Rt = x + w + 18, b = y + h, n = Math.max(6, Math.round((Rt - L) / 16));
      const wave = [];
      for (let i = 0; i <= n; i++) {
        const px = L + (Rt - L) * i / n, env = Math.min(1, Math.min(px - L, Rt - px) / 26);   // afina nas pontas
        wave.push([px, b - 2 + (14 + Math.sin(i * 1.9 + R() * .7) * 3) * Math.sqrt(env)]);
      }
      // areia molhada saindo de baixo da janela
      c.beginPath(); c.moveTo(x + 8, b - 6); wave.forEach(p => c.lineTo(p[0], p[1])); c.lineTo(x + w - 8, b - 6); c.closePath();
      const g = c.createLinearGradient(0, b - 6, 0, b + 15);
      g.addColorStop(0, 'rgba(247,228,182,.97)'); g.addColorStop(1, 'rgba(222,188,128,.93)');
      c.fillStyle = g; c.fill();
      const line = (dy, color, lw) => { c.beginPath(); wave.forEach((p, i) => i ? c.lineTo(p[0], p[1] + dy) : c.moveTo(p[0], p[1] + dy)); c.strokeStyle = color; c.lineWidth = lw; c.stroke(); };
      line(-1.5, 'rgba(176,138,84,.5)', 2);
      line(1.5, 'rgba(255,255,255,.9)', 1.8);
      line(5, 'rgba(255,255,255,.4)', 1);
      for (let i = 0; i < 7; i++) {
        c.beginPath(); c.ellipse(x + w * (.25 + R() * .5), b + 4 + R() * 5, 1.4 + R() * 1.4, 1 + R(), R() * 3, 0, TAU);
        c.fillStyle = 'rgba(150,128,105,.75)'; c.fill();
      }
      if (w > 120) starfish(c, x + w * .16, b + 6, 7, R() * 1.2, '#f08a4b');
      shell(c, x + w * .74, b + 7, 6, -.3, '#fbe3d4');
      shell(c, x + w + 2, b + 5, 4.5, .6, '#f6c1c9');
      shell(c, x + 2, b + 6, 4, -.5, '#fff1e0');
    },

    meadow(c, x, y, w, h, R) {
      const b = y + h;
      c.beginPath(); c.ellipse(x + w / 2, b + 7, w / 2 + 12, 7, 0, 0, TAU); c.fillStyle = 'rgba(40,90,30,.28)'; c.fill();
      vine(c, x - 3, b + 6, Math.min(h * .55, 170), -1, R);
      vine(c, x + w + 3, b + 6, Math.min(h * .35, 120), 1, R);
      const greens = ['#2f7a2a', '#4a9a35', '#69b642', '#93cf5e'];
      for (let px = x - 16; px <= x + w + 16; px += 1.8 + R() * 2) {
        const edge = Math.min(px - (x - 16), x + w + 16 - px), tall = edge < 34 ? 1.6 : 1;
        const hh = (7 + R() * 11) * tall, lean = (R() - .5) * 9;
        c.beginPath(); c.moveTo(px, b + 10); c.quadraticCurveTo(px + lean * .3, b + 10 - hh * .6, px + lean, b + 10 - hh);
        c.strokeStyle = greens[(R() * 4) | 0]; c.lineWidth = 1 + R() * .9; c.stroke();
      }
      const count = Math.max(3, Math.round(w / 80));
      for (let i = 0; i < count; i++) {
        const fx = x - 8 + R() * (w + 16), fy = b + 3 - R() * 7;
        if (R() < .6) {
          for (let p = 0; p < 8; p++) { const a = p * TAU / 8; c.beginPath(); c.ellipse(fx + Math.cos(a) * 2.8, fy + Math.sin(a) * 2.8, 2.6, 1.2, a, 0, TAU); c.fillStyle = '#fff'; c.fill(); }
          dot(c, fx, fy, 1.6, '#ffcf33');
        } else {
          for (let p = 0; p < 5; p++) { const a = p * TAU / 5; dot(c, fx + Math.cos(a) * 1.7, fy + Math.sin(a) * 1.7, 2.3, '#e8433a'); }
          dot(c, fx, fy, 1.1, '#2a1a1a');
        }
      }
      mushroom(c, x + w + 7, b + 9, 8); mushroom(c, x + w + 17, b + 10, 5);
    },

    space(c, x, y, w, h, R) {
      const cx = x + w / 2, cy = y + h / 2, rx = w / 2 + 36, ry = Math.max(18, h * .18);
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.lineWidth = 8; c.strokeStyle = 'rgba(139,92,246,.1)'; c.stroke();
      const g = c.createLinearGradient(cx - rx, 0, cx + rx, 0);
      g.addColorStop(0, 'rgba(147,197,253,.85)'); g.addColorStop(.5, 'rgba(207,190,255,.25)'); g.addColorStop(1, 'rgba(196,181,253,.85)');
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.lineWidth = 1.5; c.strokeStyle = g; c.stroke();
      c.beginPath(); c.ellipse(cx, cy, rx - 7, ry - 3, 0, 0, TAU); c.lineWidth = .7; c.globalAlpha = .55; c.stroke(); c.globalAlpha = 1;
      // planeta com anel no canto superior esquerdo
      const px = x - 14, py = y - 14, pr = 10;
      c.beginPath(); c.ellipse(px, py, 20, 5, -.35, Math.PI, TAU); c.strokeStyle = 'rgba(233,213,255,.8)'; c.lineWidth = 1.6; c.stroke();
      const pg = c.createRadialGradient(px - 3, py - 3, 1, px, py, pr);
      pg.addColorStop(0, '#f5f3ff'); pg.addColorStop(.45, '#a78bfa'); pg.addColorStop(1, '#2e1065');
      dot(c, px, py, pr, pg);
      c.beginPath(); c.ellipse(px, py, 20, 5, -.35, 0, Math.PI); c.strokeStyle = 'rgba(233,213,255,.8)'; c.stroke();
      // constelação no canto superior direito
      if (w > 160) {
        const pts = []; let sx = x + w - 90, sy = y - 16;
        for (let i = 0; i < 5; i++) { pts.push([sx, sy]); sx += 12 + R() * 9; sy = Math.max(y - 36, Math.min(y - 6, sy + (R() - .5) * 20)); }
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
        c.strokeStyle = 'rgba(207,190,255,.5)'; c.lineWidth = .8; c.stroke();
        pts.forEach(p => { dot(c, p[0], p[1], 3, 'rgba(196,181,253,.3)'); dot(c, p[0], p[1], 1.3, '#fff'); });
      }
      // poeira estelar em volta
      for (let i = 0; i < 46; i++) {
        const side = R(), d = 4 + R() * 24;
        let sx, sy;
        if (side < .3) { sx = x + R() * w; sy = y - d; } else if (side < .6) { sx = x + R() * w; sy = y + h + d; }
        else if (side < .8) { sx = x - d; sy = y + R() * h; } else { sx = x + w + d; sy = y + R() * h; }
        c.globalAlpha = .3 + R() * .7; dot(c, sx, sy, .5 + R() * .8, R() < .5 ? '#fff' : '#c4b5fd');
      }
      c.globalAlpha = 1;
    },

    desk(c, x, y, w, h, R) {
      // fita adesiva no canto
      c.save(); c.translate(x + 8, y + 4); c.rotate(-.7);
      c.fillStyle = 'rgba(255,252,232,.62)'; c.fillRect(-17, -5, 34, 10);
      c.strokeStyle = 'rgba(190,175,140,.45)'; c.lineWidth = .6; c.strokeRect(-17, -5, 34, 10); c.restore();
      // post-it
      if (w > 120) {
        c.save(); c.translate(x + w - 36, y - 13); c.rotate(.08);
        c.fillStyle = 'rgba(70,35,10,.28)'; c.fillRect(-14, -12, 32, 32);
        c.fillStyle = '#ffe66d'; c.fillRect(-16, -16, 32, 32);
        c.beginPath(); c.moveTo(16, -16); c.lineTo(16, -8); c.lineTo(8, -16); c.closePath(); c.fillStyle = '#efcc3c'; c.fill();
        c.strokeStyle = 'rgba(50,70,160,.6)'; c.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          c.beginPath(); c.moveTo(-11, -9 + i * 5);
          for (let t = 0; t <= 18; t += 3) c.lineTo(-11 + t, -9 + i * 5 + Math.sin(t * .9 + i) * 1.1);
          c.stroke();
        }
        c.restore();
      }
      // lápis embaixo
      const L = Math.min(110, w * .4);
      c.save(); c.translate(x + 22, y + h + 14); c.rotate(-.05);
      c.fillStyle = 'rgba(70,35,10,.25)'; c.fillRect(-11, -1, L + 22, 6);
      c.fillStyle = '#f4c430'; c.fillRect(0, -3, L, 6); c.fillStyle = '#d9a514'; c.fillRect(0, .4, L, 1.3);
      c.fillStyle = '#b9bcc4'; c.fillRect(-6, -3, 6, 6); c.fillStyle = 'rgba(120,120,130,.6)'; c.fillRect(-4, -3, .8, 6); c.fillRect(-2, -3, .8, 6);
      rr(c, -12, -3, 7, 6, 2); c.fillStyle = '#f28b9b'; c.fill();
      c.beginPath(); c.moveTo(L, -3); c.lineTo(L + 11, 0); c.lineTo(L, 3); c.closePath(); c.fillStyle = '#edc9a0'; c.fill();
      c.beginPath(); c.moveTo(L + 7, -1.1); c.lineTo(L + 11, 0); c.lineTo(L + 7, 1.1); c.closePath(); c.fillStyle = '#333'; c.fill();
      c.restore();
      // caneca de café à direita (o vapor animado sai daqui: 68% da altura)
      const mx = x + w + 22, my = y + h * .68;
      c.beginPath(); c.arc(mx + 6, my + 8, 15, 0, TAU); c.strokeStyle = 'rgba(110,60,25,.3)'; c.lineWidth = 2; c.stroke();
      dot(c, mx + 2, my + 3, 14, 'rgba(60,30,10,.3)');
      rr(c, mx + 9, my - 4, 10, 8, 4); c.strokeStyle = '#ece6da'; c.lineWidth = 3; c.stroke();
      dot(c, mx, my, 13, '#f6f2ea'); c.beginPath(); c.arc(mx, my, 13, 0, TAU); c.strokeStyle = '#d8d0c2'; c.lineWidth = 1; c.stroke();
      const cg = c.createRadialGradient(mx - 2, my - 2, 1, mx, my, 10);
      cg.addColorStop(0, '#8a5a30'); cg.addColorStop(1, '#3e220e');
      dot(c, mx, my, 10, cg); dot(c, mx - 3, my - 3, 3, 'rgba(255,230,190,.28)');
    },

    ide(c, x, y, w, h, R) {
      c.font = `9px ${MONO}`; c.textAlign = 'right'; c.textBaseline = 'middle';
      for (let i = 0, ly = y + 30; ly < y + h - 6; i++, ly += 15) {
        c.fillStyle = i === 3 ? 'rgba(235,228,255,.95)' : 'rgba(150,140,190,.6)'; c.fillText(String(i + 1), x - 7, ly);
      }
      // minimapa
      const mx = x + w + 4;
      c.fillStyle = 'rgba(30,27,46,.6)'; c.fillRect(mx, y + 2, 20, h - 4);
      const cols = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#676e95'];
      c.globalAlpha = .8;
      for (let ly = y + 5; ly < y + h - 5; ly += 3) {
        if (R() < .18) continue;
        const lx = mx + 2 + ((R() * 3) | 0) * 2, len = 3 + R() * 12;
        c.fillStyle = cols[(R() * 6) | 0]; c.fillRect(lx, ly, Math.min(len, mx + 19 - lx), 1.6);
      }
      c.globalAlpha = 1;
      // breadcrumb ao lado da aba
      if (w > 260) {
        c.textAlign = 'left'; let bx = x + 114;
        for (const [t, col] of [['src', '#a59fc8'], [' › ', '#77709a'], ['ui', '#a59fc8'], [' › ', '#77709a'], ['Window.tsx', '#ebe4ff']]) {
          c.fillStyle = col; c.fillText(t, bx, y - 8); bx += c.measureText(t).width;
        }
      }
      // barra de status
      const sy = y + h + 3;
      rr(c, x, sy, w, 14, 3); c.fillStyle = 'rgba(124,58,237,.92)'; c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText('⎇ main   ✓ 0  ⚠ 2', x + 6, sy + 7.5);
      if (w > 300) { c.textAlign = 'right'; c.fillText('Ln 42, Col 7   UTF-8   TypeScript', x + w - 6, sy + 7.5); }
    },

    terminal(c, x, y, w, h, R) {
      const o = 9;
      c.save(); c.beginPath(); rrPath(c, x - o, y - o, w + 2 * o, h + 2 * o, 8); c.rect(x, y, w, h); c.clip('evenodd');
      c.fillStyle = 'rgba(6,26,12,.7)'; c.fillRect(x - o, y - o, w + 2 * o, h + 2 * o);
      c.fillStyle = 'rgba(154,255,177,.09)';
      for (let ly = y - o; ly < y + h + o; ly += 3) c.fillRect(x - o, ly, w + 2 * o, 1);
      c.restore();
      rr(c, x - o, y - o, w + 2 * o, h + 2 * o, 8); c.strokeStyle = 'rgba(154,255,177,.45)'; c.lineWidth = 1; c.stroke();
      c.font = `10px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(43,220,104,.9)'; c.shadowBlur = 5;
      c.fillStyle = 'rgba(170,255,190,.85)'; c.fillText('user@deskland: ~', x + w / 2, y - o - 8);
      c.shadowBlur = 0;
      const ty = y + h + o + 3;
      c.fillStyle = 'rgba(22,100,50,.9)'; c.fillRect(x - o, ty, w + 2 * o, 13);
      c.font = `9px ${MONO}`; c.textAlign = 'left'; c.fillStyle = '#d6ffe0';
      c.fillText('[0] 0:bash* 1:vim 2:htop', x - o + 5, ty + 7);
      if (w > 240) { c.textAlign = 'right'; c.fillText('"deskland"', x + w + o - 16, ty + 7); }
    },

    gitgraph(c, x, y, w, h, R) {
      const X0 = x - 10, X1 = x - 22, X2 = x - 34, Y = t => y + h * t;
      c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X0, Y(.06)); c.lineTo(X0, Y(.94)); c.strokeStyle = '#7ee787'; c.stroke();
      if (h > 90) {
        c.beginPath(); c.moveTo(X0, Y(.14)); c.bezierCurveTo(X0, Y(.2), X1, Y(.18), X1, Y(.25)); c.lineTo(X1, Y(.56));
        c.bezierCurveTo(X1, Y(.63), X0, Y(.62), X0, Y(.7)); c.strokeStyle = '#f778ba'; c.stroke();
        c.beginPath(); c.moveTo(X1, Y(.32)); c.bezierCurveTo(X1, Y(.37), X2, Y(.36), X2, Y(.41)); c.lineTo(X2, Y(.45));
        c.bezierCurveTo(X2, Y(.5), X1, Y(.49), X1, Y(.53)); c.strokeStyle = '#58a6ff'; c.stroke();
      }
      const commit = (cx, t, col, big) => { dot(c, cx, Y(t), big ? 4.2 : 3.2, col); dot(c, cx, Y(t), big ? 1.8 : 1.3, '#0d1117'); };
      [.08, .3, .5, .88].forEach(t => commit(X0, t, '#7ee787'));
      if (h > 90) { commit(X0, .7, '#7ee787', true); [.3, .42].forEach(t => commit(X1, t, '#f778ba')); commit(X2, .43, '#58a6ff'); }
      c.font = `8px ${MONO}`; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(201,209,217,.55)';
      if (h > 90) { c.fillText('feat', X1 - 6, Y(.25) - 5); c.fillText('fix', X2 - 6, Y(.41) - 5); }
      if (w > 140) label(c, x + w - 30, y - 11, 'v0.1.3', 'rgba(88,166,255,.18)', '#58a6ff', '#9ecbff');
    },

    // A janela vira um bloco da árvore do wallpaper (mesmo desenho dos blocos de ícones do ast.html):
    // moldura tracejada, título "Block nome" no meio da borda de cima, "}" na de baixo, e uma curva até o
    // nó mais próximo acima na árvore real. Fora do ast.html (sem o gancho) usa a paleta "papel".
    ast(c, x, y, w, h, R, hook) {
      const pal = hook && hook.pal || { bg: '#f6f3ec', edge: '#c8bfac', node: '#fffdf8', nodeEdge: '#d6ccb8', text: '#3b3630',
        muted: '#9a907e', val: '#b4532a', accent: '#d9480f', soft: 'rgba(217,72,15,0.14)' };
      const NH = 22, f = { x: x - 8, y: y - 8, w: w + 16, h: h + 16 }, hx = x + w / 2, hy = f.y, vars = {};
      const words = ['frame', 'view', 'panel', 'layout', 'render', 'scene', 'state', 'window', 'pane', 'modal'];
      const curve = (x0, y0, x1, y1) => {
        const dy = y1 - y0;
        c.beginPath(); c.moveTo(x0, y0); c.bezierCurveTo(x0, y0 + dy * .55, x1, y1 - dy * .55, x1, y1);
        c.strokeStyle = pal.edge; c.lineWidth = 1.3; c.lineCap = 'round'; c.stroke();
        return `M ${x0 - x} ${y0 - y} C ${x0 - x} ${y0 + dy * .55 - y}, ${x1 - x} ${y1 - dy * .55 - y}, ${x1 - x} ${y1 - y}`;
      };
      const pill = (cx, cy, type, val) => {
        c.font = `11px ${MONO}`; c.textAlign = 'left'; c.textBaseline = 'middle';
        const tw = c.measureText(type).width, vw = val ? c.measureText(' ' + val).width : 0, pw = Math.ceil(tw + vw + 18);
        rr(c, cx - pw / 2, cy - NH / 2, pw, NH, NH / 2); c.fillStyle = pal.node; c.fill();
        c.lineWidth = 1; c.strokeStyle = pal.nodeEdge; c.stroke();
        c.fillStyle = pal.text; c.fillText(type, cx - pw / 2 + 9, cy + .5);
        if (val) { c.fillStyle = pal.val; c.fillText(' ' + val, cx - pw / 2 + 9 + tw, cy + .5); }
        return pw;
      };
      // curva até o nó mais próximo acima (o título de um bloco também serve); escondido sob a janela não vale
      let par = null, best = 1e9;
      for (const n of (hook && hook.nodes) || []) {
        if (n.ic || n.w == null || n.y + NH / 2 > hy - NH / 2 - 10) continue;
        if (n.x > x && n.x < x + w && n.y > y && n.y < y + h) continue;
        const cost = Math.abs(n.x - hx) + .6 * (hy - n.y);
        if (cost < best) { best = cost; par = n; }
      }
      if (par) { vars['--path'] = `path('${curve(par.x, par.y + NH / 2, hx, hy - NH / 2)}')`; vars['--dot'] = 'block'; }
      // moldura tracejada do bloco
      rr(c, f.x, f.y, f.w, f.h, 14); c.setLineDash([6, 5]); c.strokeStyle = pal.edge; c.lineWidth = 1.3; c.stroke(); c.setLineDash([]);
      // folhas embaixo, se houver espaço
      const bottom = f.y + f.h;
      if (w > 220 && bottom + 60 < innerHeight - 40) {
        [[x + w * .3, 'Identifier', words[(R() * words.length) | 0]], [x + w * .7, 'Return', '']].forEach(([lx, t, v]) => {
          curve(hx, bottom + 8, lx, bottom + 40 - NH / 2); pill(lx, bottom + 40, t, v);
        });
      }
      // "}" na borda de baixo e o título na de cima
      c.font = `11px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      rr(c, hx - 9, bottom - 8, 18, 16, 6); c.fillStyle = pal.bg; c.fill();
      c.fillStyle = pal.muted; c.fillText('}', hx, bottom + .5);
      const hw = pill(hx, hy, 'Block', words[(R() * words.length) | 0]);
      vars['--hw'] = hw + 'px'; vars['--acc'] = pal.accent; vars['--soft'] = pal.soft;
      return vars;
    },

    dashboard(c, x, y, w, h, R) {
      const vars = {};
      // medidor semicircular
      const gx = x + 24, gy = y - 8, r = 15;
      c.lineCap = 'butt'; c.lineWidth = 4;
      c.beginPath(); c.arc(gx, gy, r, Math.PI, TAU); c.strokeStyle = 'rgba(173,231,255,.18)'; c.stroke();
      c.beginPath(); c.arc(gx, gy, r, Math.PI, Math.PI * 1.45); c.strokeStyle = '#73bf69'; c.stroke();
      c.beginPath(); c.arc(gx, gy, r, Math.PI * 1.45, Math.PI * 1.7); c.strokeStyle = '#fade2a'; c.stroke();
      c.beginPath(); c.arc(gx, gy, r, Math.PI * 1.7, Math.PI * 1.85); c.strokeStyle = '#f2495c'; c.stroke();
      c.lineWidth = 1; c.strokeStyle = 'rgba(230,237,243,.6)'; c.beginPath();
      for (let i = 0; i <= 6; i++) { const a = Math.PI + Math.PI * i / 6; c.moveTo(gx + Math.cos(a) * (r + 3), gy + Math.sin(a) * (r + 3)); c.lineTo(gx + Math.cos(a) * (r + 6), gy + Math.sin(a) * (r + 6)); }
      c.stroke();
      // painel com sparkline
      if (w >= 220) {
        const pw = 124, ph = 36, px = x + w - pw - 8, py = y - ph - 8;
        rr(c, px, py, pw, ph, 4); c.fillStyle = 'rgba(13,18,30,.9)'; c.fill(); c.strokeStyle = 'rgba(87,148,242,.6)'; c.stroke();
        c.font = `8px ${MONO}`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#8ab4f8'; c.fillText('CPU', px + 6, py + 8);
        c.font = `bold 10px ${MONO}`; c.textAlign = 'right'; c.fillStyle = '#e6edf3'; c.fillText('42%', px + pw - 6, py + 9);
        const pts = [];
        for (let i = 0; i < 22; i++) {
          const v = Math.max(0, Math.min(1, .5 + .3 * Math.sin(i * .7 + R() * 1.5) + (R() - .5) * .3));
          pts.push([px + 6 + (pw - 12) * i / 21, py + ph - 5 - v * (ph - 21)]);
        }
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
        c.lineTo(px + pw - 6, py + ph - 4); c.lineTo(px + 6, py + ph - 4); c.closePath();
        const ag = c.createLinearGradient(0, py + 14, 0, py + ph);
        ag.addColorStop(0, 'rgba(87,148,242,.5)'); ag.addColorStop(1, 'rgba(87,148,242,0)');
        c.fillStyle = ag; c.fill();
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.strokeStyle = '#5794f2'; c.lineWidth = 1.3; c.stroke();
        const lp = pts[pts.length - 1];
        vars['--ax'] = (lp[0] - x) + 'px'; vars['--ay'] = (lp[1] - y) + 'px';
      } else { vars['--ax'] = '-999px'; vars['--ay'] = '0px'; }
      // histograma embaixo
      for (let bx = x + 8, i = 0; bx < x + w - 10; bx += 5, i++) {
        const v = 2 + (Math.sin(i * .35) * .5 + .5) * 7 + R() * 3;
        c.fillStyle = i % 9 === 0 ? 'rgba(115,191,105,.75)' : 'rgba(87,148,242,.6)'; c.fillRect(bx, y + h + 3, 3, v);
      }
      return vars;
    },

    pond(c, x, y, w, h, R) {
      // pedras
      [[x - 14, y + h * .6, 6], [x - 20, y + h * .6 + 9, 4], [x - 9, y + h * .6 + 13, 3.5]].forEach(([sx, sy, s]) => {
        c.beginPath(); c.ellipse(sx + 1, sy + 2, s, s * .7, 0, 0, TAU); c.fillStyle = 'rgba(0,30,30,.3)'; c.fill();
        c.beginPath(); c.ellipse(sx, sy, s, s * .7, 0, 0, TAU); c.fillStyle = '#8a9a94'; c.fill();
        c.beginPath(); c.ellipse(sx - s * .3, sy - s * .25, s * .45, s * .25, 0, 0, TAU); c.fillStyle = '#b8c6c0'; c.fill();
      });
      // vitórias-régias
      c.beginPath(); c.ellipse(x + w * .35, y + h + 10, 15, 6, 0, 0, TAU); c.strokeStyle = 'rgba(200,255,235,.3)'; c.lineWidth = 1; c.stroke();
      lilyPad(c, x - 10, y + h + 5, 14, R() * TAU);
      lilyPad(c, x + w * .35, y + h + 10, 9, R() * TAU);
      lilyPad(c, x + w + 13, y + h * .35, 11, R() * TAU);
      lilyPad(c, x + w + 6, y + h * .35 + 15, 6, R() * TAU);
      if (w > 120) lilyPad(c, x + w - 24, y - 9, 8, R() * TAU);
      lotus(c, x - 10, y + h + 3);
      // juncos no canto inferior direito
      for (let i = 0; i < 6; i++) {
        const sx = x + w + 2 + i * 3.6, top = y + h - 8 - R() * 30, bend = (R() - .3) * 6;
        c.beginPath(); c.moveTo(sx, y + h + 16); c.quadraticCurveTo(sx + bend * .3, (top + y + h + 16) / 2, sx + bend, top);
        c.strokeStyle = i % 2 ? '#5b7a35' : '#6f9440'; c.lineWidth = 1.4; c.stroke();
        if (i % 2 === 0) { rr(c, sx + bend - 1.8, top, 3.6, 10, 1.8); c.fillStyle = '#7a4b2a'; c.fill(); }
      }
    },

    nightcity(c, x, y, w, h, R) {
      // reflexo molhado do neon embaixo da janela
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x, y + h + 1, w, 1);
      const cols = ['255,61,127', '61,224,255', '255,213,138', '194,120,255'];
      for (let i = 0, n = Math.max(8, w / 8); i < n; i++) {
        const sx = x + R() * w, sw = 1 + R() * 2.5, len = 12 + R() * 34, col = cols[(R() * 4) | 0];
        const g = c.createLinearGradient(0, y + h + 2, 0, y + h + 2 + len);
        g.addColorStop(0, `rgba(${col},.5)`); g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.fillRect(sx, y + h + 2, sw, len);
      }
      // tubos de neon nos cantos
      const tube = (pts, color, glow) => {
        c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.shadowColor = glow; c.shadowBlur = 9;
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
        c.strokeStyle = color; c.lineWidth = 2.4; c.stroke(); c.shadowBlur = 0;
        c.strokeStyle = 'rgba(255,240,250,.9)'; c.lineWidth = .8; c.stroke(); c.restore();
      };
      tube([[x - 7, y + 30], [x - 7, y - 7], [x + 42, y - 7]], '#ff4f9a', '#ff3d7f');
      tube([[x + w + 7, y + h - 30], [x + w + 7, y + h + 7], [x + w - 42, y + h + 7]], '#3de0ff', '#3de0ff');
      // antena no teto (a luz vermelha piscando é animada)
      const ax = x + w * .28;
      c.beginPath(); c.moveTo(ax, y); c.lineTo(ax, y - 24); c.moveTo(ax - 6, y - 10); c.lineTo(ax + 6, y - 10); c.moveTo(ax - 4, y - 17); c.lineTo(ax + 4, y - 17);
      c.strokeStyle = 'rgba(150,140,190,.85)'; c.lineWidth = 1.3; c.stroke();
    },

    'ascii-city'(c, x, y, w, h, R) {
      c.font = `9px ${MONO}`; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
      const cw = c.measureText('M').width, lh = 9;
      let bx = x + 84;
      while (bx < x + w - 66) {
        const bw = 3 + ((R() * 4) | 0), bh = 2 + ((R() * 3) | 0);
        for (let j = 0; j < bh; j++) {
          const by = y - 3 - (bh - 1 - j) * lh;
          for (let k = 0; k < bw; k++) {
            let ch, col = 'rgba(114,246,255,.85)';
            if (j === 0) ch = k === 0 || k === bw - 1 ? '.' : '-';
            else if (k === 0 || k === bw - 1) ch = '|';
            else { const r = R(); ch = r < .45 ? '#' : r < .7 ? '·' : ' '; col = ch === '#' ? (R() < .5 ? '#ffd166' : '#ff5fbe') : 'rgba(114,246,255,.5)'; }
            c.fillStyle = col; c.fillText(ch, bx + k * cw, by);
          }
        }
        if (R() < .3) { c.fillStyle = 'rgba(114,246,255,.85)'; c.fillText('|', bx + Math.floor(bw / 2) * cw, y - 3 - bh * lh); }
        bx += (bw + 1) * cw;
      }
      const n = Math.floor((w + 16) / cw);
      c.fillStyle = 'rgba(114,246,255,.75)';
      c.fillText('='.repeat(n), x - 8, y + h + 9);
      c.fillText('='.repeat(n), x - 8, y + h + 28);
      c.fillStyle = 'rgba(114,246,255,.3)'; c.fillText('- '.repeat(Math.floor(n / 2)), x - 8, y + h + 19);
    },

    'ascii-starship'(c, x, y, w, h, R) {
      c.strokeStyle = 'rgba(169,240,255,.6)'; c.fillStyle = 'rgba(169,240,255,.7)'; c.lineWidth = 1;
      c.font = `8px ${MONO}`; c.textAlign = 'right'; c.textBaseline = 'middle';
      c.beginPath();
      for (let ly = y + 10, i = 0; ly < y + h - 8; ly += 8, i++) {
        const big = i % 5 === 0; c.moveTo(x - 6, ly); c.lineTo(x - (big ? 13 : 9), ly);
        if (big) c.fillText(String(i * 10).padStart(3, '0'), x - 15, ly);
      }
      for (let lx = x + 90, i = 0; lx < x + w - 90; lx += 8, i++) { c.moveTo(lx, y + h + 5); c.lineTo(lx, y + h + (i % 5 ? 8 : 12)); }
      c.stroke();
      // cantoneiras
      c.lineWidth = 1.6; c.beginPath();
      [[x - 5, y - 5, 1, 1], [x + w + 5, y - 5, -1, 1], [x - 5, y + h + 5, 1, -1], [x + w + 5, y + h + 5, -1, -1]].forEach(([cx, cy, sx, sy]) => {
        c.moveTo(cx + sx * 14, cy); c.lineTo(cx, cy); c.lineTo(cx, cy + sy * 14);
      });
      c.stroke();
      // radar no canto superior direito (a varredura é animada)
      const rx = x + w + 16, ry = y - 18, r = 18;
      dot(c, rx, ry, r, 'rgba(8,18,36,.75)');
      c.lineWidth = .8; c.beginPath(); c.arc(rx, ry, r, 0, TAU); c.moveTo(rx + r * .6, ry); c.arc(rx, ry, r * .6, 0, TAU);
      c.moveTo(rx - r, ry); c.lineTo(rx + r, ry); c.moveTo(rx, ry - r); c.lineTo(rx, ry + r); c.stroke();
      dot(c, rx + 6, ry - 8, 1.5, '#ff5fbe'); dot(c, rx - 9, ry + 4, 1.2, '#ff5fbe'); dot(c, rx + 3, ry + 11, 1.2, '#ffd166');
    },

    'ascii-datacenter'(c, x, y, w, h, R) {
      // orelhas de rack dos dois lados, com furos de parafuso
      [x - 13, x + w + 2].forEach(ex => {
        rr(c, ex, y + 2, 11, h - 4, 2); c.fillStyle = '#16202e'; c.fill();
        c.strokeStyle = 'rgba(124,216,255,.45)'; c.lineWidth = 1; c.stroke();
        for (let sy = y + 40; sy < y + h - 6; sy += 18) {
          dot(c, ex + 5.5, sy, 2.2, '#05080d');
          c.beginPath(); c.arc(ex + 5.5, sy, 2.2, 0, TAU); c.strokeStyle = 'rgba(160,180,200,.6)'; c.stroke();
        }
      });
      [y + 16, y + 26].forEach(ly => dot(c, x + w + 7, ly, 2, 'rgba(40,60,50,.9)'));   // LEDs apagados (os acesos são animados)
      // feixe de cabos coloridos saindo por baixo, preso por uma abraçadeira
      ['#ffd166', '#5cff9d', '#7cd8ff', '#ff5f6d', '#c29cff'].forEach((col, i) => {
        const sx = x + w * .3 + i * 6;
        c.beginPath(); c.moveTo(sx, y + h); c.bezierCurveTo(sx, y + h + 18, sx - 6 + i * 2, y + h + 26, sx - 4 + i * 1.5, y + h + 46);
        c.strokeStyle = col; c.globalAlpha = .8; c.lineWidth = 2; c.stroke(); c.globalAlpha = 1;
      });
      c.fillStyle = '#2a3546'; c.fillRect(x + w * .3 - 3, y + h + 12, 32, 4);
    },

    'ascii-dungeon'(c, x, y, w, h, R) {
      // moldura de tijolos de pedra em volta da janela
      const b = 9;
      c.save(); c.beginPath(); c.rect(x - b, y - b, w + 2 * b, h + 2 * b); c.rect(x, y, w, h); c.clip('evenodd');
      c.fillStyle = '#3b332a'; c.fillRect(x - b, y - b, w + 2 * b, h + 2 * b);
      c.strokeStyle = 'rgba(15,10,6,.85)'; c.lineWidth = 1;
      for (let row = 0, by = y - b; by < y + h + b; by += 6, row++) {
        for (let bx = x - b + (row % 2 ? 7 : 0) - 7; bx < x + w + b; bx += 14) {
          c.fillStyle = `rgba(255,230,190,${(R() * .1).toFixed(3)})`; c.fillRect(bx + 1, by + 1, 12, 4);
          c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, by + 6); c.stroke();
        }
        c.beginPath(); c.moveTo(x - b, by); c.lineTo(x + w + b, by); c.stroke();
      }
      c.restore();
      c.strokeStyle = 'rgba(255,200,140,.25)'; c.lineWidth = 1; c.strokeRect(x - b + .5, y - b + .5, w + 2 * b - 1, h + 2 * b - 1);
      // suportes das tochas (as chamas são animadas)
      [x - b - 6, x + w + b + 6].forEach(tx => { c.fillStyle = '#5a4632'; c.fillRect(tx - 1.5, y + 6, 3, 12); c.fillStyle = '#7a6040'; c.fillRect(tx - 4, y + 4, 8, 3); });
      // chão da masmorra onde o aventureiro anda
      c.font = `10px ${MONO}`; c.fillStyle = 'rgba(216,195,154,.5)'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText('. '.repeat(Math.max(0, Math.floor((w + 2 * b) / 11))), x - b, y + h + b + 8);
    }
  };

  const api = {
    profile: activeProfile.name,
    enabled: true,
    intensity: DEFAULTS.windowFxIntensity,
    rects: [],
    configure(options) {
      options = options || {};
      if (typeof options.profile === 'string' && PROFILES[options.profile]) {
        activeProfile = PROFILES[options.profile];
        this.profile = activeProfile.name;
      }
      if (typeof options.enabled === 'boolean') this.enabled = options.enabled;
      if (typeof options.intensity === 'number' && Number.isFinite(options.intensity)) this.intensity = Math.max(0, Math.min(1, options.intensity));
      render();
    },
    applySettings(values) {
      values = values || {};
      this.configure({
        enabled: values.windowFx == null ? this.enabled : values.windowFx !== 0,
        intensity: values.windowFxIntensity == null ? this.intensity : Number(values.windowFxIntensity)
      });
    },
    setWindows(rects) { this.rects = Array.isArray(rects) ? rects : []; render(); }
  };
  window.DesklandWindowEffects = api;

  // EnumWindows vem de cima para baixo na ordem Z: as primeiras são as janelas mais à frente.
  const MAX_WINDOWS = 12;
  let last = null;
  function render() {
    layer.innerHTML = '';
    layer.hidden = !api.enabled || api.intensity <= 0 || !api.rects.length;
    if (layer.hidden) { artCanvas.width = artCanvas.height = 0; return; }
    const k = Math.max(1, window.devicePixelRatio || 1);
    layer.style.opacity = String(api.intensity);
    // O tema pode oferecer um gancho (window.DesklandFxHook) com cores da paleta atual e dados da cena.
    let hook = null;
    try { hook = typeof window.DesklandFxHook === 'function' ? window.DesklandFxHook() : null; } catch (e) { hook = null; }
    layer.style.setProperty('--fx-glow', hook && hook.glow || activeProfile.glow);
    layer.style.setProperty('--fx-halo', hook && hook.halo || activeProfile.halo);
    layer.style.setProperty('--fx-radius', activeProfile.radius);
    // Canvas da ilustração: tamanho em pixels reais, exibido no tamanho CSS (pode ser fracionário).
    const dpr = window.devicePixelRatio || 1, cssW = innerWidth, cssH = innerHeight;
    const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
    if (artCanvas.width !== pw || artCanvas.height !== ph) { artCanvas.width = pw; artCanvas.height = ph; }
    artCanvas.style.width = cssW + 'px'; artCanvas.style.height = cssH + 'px';
    const ctx = artCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(pw / cssW, 0, 0, ph / cssH, 0, 0);
    layer.appendChild(artCanvas);
    const draw = ART[activeProfile.name];
    // Desenha de trás para a frente, para a ilustração da janela da frente ficar por cima.
    const shown = [];
    for (let i = 0; i < Math.min(api.rects.length, MAX_WINDOWS); i++) {
      const r = api.rects[i];
      if (!Array.isArray(r) || r.length < 4) continue;
      const x = Number(r[0]) / k, y = Number(r[1]) / k;
      const w = Number(r[2] - r[0]) / k, h = Number(r[3] - r[1]) / k;
      if (![x, y, w, h].every(Number.isFinite) || w < 8 || h < 8) continue;
      shown.push([x, y, w, h]);
    }
    const vars = shown.map(() => null);
    for (let i = shown.length - 1; i >= 0; i--) {
      const [x, y, w, h] = shown[i];
      if (!draw) continue;
      ctx.save();
      try { vars[i] = draw(ctx, x, y, w, h, seeded((Math.round(w) * 73856093) ^ (Math.round(h) * 19349663)), hook) || null; }
      catch (e) { /* uma ilustração com erro não pode derrubar o wallpaper */ }
      ctx.restore();
    }
    shown.forEach(([x, y, w, h], i) => {
      const edge = document.createElement('i');
      edge.className = 'fx-' + activeProfile.name;
      edge.style.left = x + 'px'; edge.style.top = y + 'px';
      edge.style.width = w + 'px'; edge.style.height = h + 'px';
      edge.style.setProperty('--w', w + 'px');            // cometa, carpa, carros etc. percorrem a borda inteira
      edge.style.setProperty('--h', h + 'px');
      edge.style.setProperty('--rx', (w / 2 + 36) + 'px'); // órbita (mesma elipse desenhada no canvas do espaço)
      edge.style.setProperty('--ry', Math.max(18, h * .18) + 'px');
      if (vars[i]) for (const key in vars[i]) edge.style.setProperty(key, vars[i][key]);
      (activeProfile.parts || []).forEach((part, j) => {
        const b = document.createElement('b');
        b.className = 'p' + (j + 1);
        if (part && typeof part === 'object') { if (part.nest) b.appendChild(document.createElement('b')); }
        else if (part) b.textContent = part;
        edge.appendChild(b);
      });
      layer.appendChild(edge);
    });
  }
  function receive(data) {
    let m; try { m = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { return; }
    if (!m) return;
    if (m.t === 'windows') { last = m; api.setWindows(m.r); }
    else if (m.t === 'settings') api.applySettings(m.v);
    // Wallpaper pausado (janela maximizada / tela cheia / pausa manual): congela as animações para o
    // compositor parar de trabalhar. No preview o tema ignora a pausa, então aqui também.
    else if (m.t === 'pause' && wall) layer.classList.toggle('paused', !!m.v);
    else if (m.t === 'reset') api.applySettings(DEFAULTS);
  }
    if (wall && window.chrome && window.chrome.webview) {
      window.chrome.webview.addEventListener('message', ev => receive(ev.data));
      window.chrome.webview.postMessage('windows|ready');
    }
    if (preview) {
      addEventListener('message', ev => { if (ev.source === parent) receive(ev.data); });
      parent.postMessage(JSON.stringify({ t: 'windowEffectsReady' }), '*');
    }
    addEventListener('resize', () => { if (last) render(last); });
})();

(function () {
  // 固定的随机数：同一个位置的图标每次编出来的样子一样
  function rnd(x, y, k) {
    let h = Math.imul(Math.round(x) | 0, 374761393) ^ Math.imul(Math.round(y) | 0, 668265263) ^ Math.imul(k + 7, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); addRoundRect(ctx, x, y, w, h, r); }
  function addRoundRect(ctx, x, y, w, h, r) {               // 不另起路径：几块拼成一个形状时用
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const BADGES = ['#2b6cd4', '#1d7d45', '#c8372c', '#d86f2a', '#7a3fc4'];
  const APPS = [['#29a3e8', '#1474c4'], ['#9b5de5', '#6a35c2'], ['#20c08f', '#0f8f68'], ['#ff7a59', '#e0452c']];
  // 一个示例图标（g：图标边长，物理像素）：文件夹、文档、图片、应用；阴影用错开一点的半透明色块（模糊阴影太慢）
  function sampleGlyph(ctx, x, y, g, u) {
    const kind = u(1), sh = Math.max(1, g * 0.03);
    const shape = (fill, f) => { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.save(); ctx.translate(0, sh); f(); ctx.fill(); ctx.restore(); ctx.fillStyle = fill; f(); ctx.fill(); };
    if (kind < 0.36) {                                       // 文件夹：后面一片带耳朵的，前面一片亮一点
      shape('#e3a32f', () => { ctx.beginPath(); addRoundRect(ctx, x + g * 0.06, y + g * 0.2, g * 0.88, g * 0.64, g * 0.07);
        addRoundRect(ctx, x + g * 0.06, y + g * 0.14, g * 0.38, g * 0.2, g * 0.06); });
      ctx.fillStyle = '#fcd25c'; roundRect(ctx, x + g * 0.06, y + g * 0.32, g * 0.88, g * 0.52, g * 0.07); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + g * 0.12, y + g * 0.36, g * 0.76, g * 0.03);
    } else if (kind < 0.76) {                                // 文档：折了一个角的白纸，几行灰线，左下一块彩色的角标
      const px = x + g * 0.2, py = y + g * 0.06, pw = g * 0.6, ph = g * 0.84, c = g * 0.16;
      shape('#f7f9fc', () => { ctx.beginPath(); ctx.moveTo(px, py + g * 0.04); ctx.arcTo(px, py, px + g * 0.04, py, g * 0.04);
        ctx.lineTo(px + pw - c, py); ctx.lineTo(px + pw, py + c); ctx.lineTo(px + pw, py + ph - g * 0.04);
        ctx.arcTo(px + pw, py + ph, px + pw - g * 0.04, py + ph, g * 0.04); ctx.lineTo(px + g * 0.04, py + ph);
        ctx.arcTo(px, py + ph, px, py + ph - g * 0.04, g * 0.04); ctx.closePath(); });
      ctx.fillStyle = '#d9dfe7'; ctx.beginPath(); ctx.moveTo(px + pw - c, py); ctx.lineTo(px + pw - c, py + c); ctx.lineTo(px + pw, py + c); ctx.fill();
      ctx.fillStyle = '#cfd6df';
      for (let i = 0; i < 4; i++) ctx.fillRect(px + pw * 0.38, py + ph * (0.3 + i * 0.13), pw * 0.48, g * 0.035);
      const badge = BADGES[Math.floor(u(2) * BADGES.length)];
      shape(badge, () => { ctx.beginPath(); roundRect(ctx, x + g * 0.08, y + g * 0.44, g * 0.42, g * 0.38, g * 0.06); });
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(ctx, x + g * 0.17, y + g * 0.56, g * 0.24, g * 0.14, g * 0.03); ctx.fill();
    } else if (kind < 0.9) {                                 // 图片：白框里一片蓝天、一个太阳、两座绿山
      const fx = x + g * 0.1, fy = y + g * 0.16, fw = g * 0.8, fh = g * 0.66, m = g * 0.06;
      shape('#f7f9fc', () => { ctx.beginPath(); roundRect(ctx, fx, fy, fw, fh, g * 0.05); });
      ctx.save(); ctx.beginPath(); ctx.rect(fx + m, fy + m, fw - 2 * m, fh - 2 * m); ctx.clip();
      ctx.fillStyle = '#8fd0f2'; ctx.fillRect(fx + m, fy + m, fw - 2 * m, fh - 2 * m);
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(fx + fw * 0.72, fy + fh * 0.32, g * 0.07, 0, 7); ctx.fill();
      ctx.fillStyle = '#5cbf6c'; ctx.beginPath(); ctx.moveTo(fx, fy + fh); ctx.lineTo(fx + fw * 0.36, fy + fh * 0.44); ctx.lineTo(fx + fw * 0.66, fy + fh); ctx.fill();
      ctx.fillStyle = '#3e9f58'; ctx.beginPath(); ctx.moveTo(fx + fw * 0.4, fy + fh); ctx.lineTo(fx + fw * 0.7, fy + fh * 0.58); ctx.lineTo(fx + fw, fy + fh * 0.9); ctx.lineTo(fx + fw, fy + fh); ctx.fill();
      ctx.restore();
    } else {                                                 // 应用：一块上亮下暗的纯色圆角方块
      const [a, b] = APPS[Math.floor(u(3) * APPS.length)];
      const grad = ctx.createLinearGradient(0, y + g * 0.12, 0, y + g * 0.88);
      grad.addColorStop(0, a); grad.addColorStop(1, b);
      shape(grad, () => { ctx.beginPath(); roundRect(ctx, x + g * 0.12, y + g * 0.12, g * 0.76, g * 0.76, g * 0.18); });
    }
  }
  // 名字：一两行白色的圆角色块（代替文字），下面垫一层错开一点的半透明黑，像桌面图标文字的阴影
  function sampleLabel(ctx, cx, y, w, lh) {
    const h = lh * 0.56, r = h / 2, o = Math.max(1, lh * 0.07);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, cx - w / 2 + o, y + (lh - h) / 2 + o, w, h, r); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; roundRect(ctx, cx - w / 2, y + (lh - h) / 2, w, h, r); ctx.fill();
  }
  // 一个图标（示例图标 + 名字的色块）画在 (px, py)（逻辑像素）；样子按图标第一次出现的位置定，拖动时不会变样
  // lift：拖起来的程度（0..1）：稍微放大、半透明，像拖动时的样子
  function drawIcon(ctx, ic, s, px, py, lift) {
    if (!ic._seed) ic._seed = [ic.x, ic.y];
    const u = k => rnd(ic._seed[0], ic._seed[1], k);
    lift = lift || 0;
    ctx.save();
    if (lift > 0) {
      const sc = 1 + 0.06 * lift, cx = (px + ic.w / 2) * s, cy = (py + ic.h / 2) * s;
      ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      ctx.globalAlpha = 1 - 0.25 * lift;
    }
    const x = px * s, y = py * s, w = ic.w * s, h = ic.h * s;
    const g = Math.min(48 * s, w - 8 * s, h * 0.62);         // 图标：上面居中的一个方块
    sampleGlyph(ctx, x + (w - g) / 2, y + 3 * s, g, u);
    const lh = 15 * s, ly = y + 3 * s + g + 4 * s, lines = u(9) < 0.45 ? 2 : 1;   // 名字：下面一两行
    if (ly + lh <= y + h + 6 * s)
      for (let i = 0; i < lines; i++) sampleLabel(ctx, x + w / 2, ly + i * lh, w * (i ? 0.3 + 0.35 * u(11) : 0.5 + 0.42 * u(10)), lh);
    ctx.restore();
  }
  // 主题有 2D 画布画的东西、而且已经画过了（主题静态图层）
  function labelsReady() {
    return typeof renderLabels === 'function' && ((typeof city !== 'undefined' && city) || (typeof world !== 'undefined' && world));
  }
  function drawSampleIcons(ctx, s) { for (const ic of icons) drawIcon(ctx, ic, s, ic.x, ic.y, 0); }
  // 按 scale（默认是屏幕的实际像素）画一张，画上示例图标，返回一张 2D 画布
  function snapshot(scale) {
    scale = scale || window.devicePixelRatio || 1;
    const old = { w: cv.width, h: cv.height, s: cv._scale };
    const hasLabels = labelsReady();
    const hasCache = typeof cacheOK !== 'undefined';
    const box = cv.getBoundingClientRect();                  // 和主题的 resize() 一样按画布实际占的大小（带小数）算，图正好是屏幕的像素
    cv.width = Math.round((box.width || W) * scale); cv.height = Math.round((box.height || H) * scale); cv._scale = scale;
    if (hasLabels) renderLabels();
    if (hasCache) cacheOK = false;
    draw(performance.now());
    const out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(cv, 0, 0);                                  // 同一个任务里画完马上取，不需要 preserveDrawingBuffer
    cv.width = old.w; cv.height = old.h; cv._scale = old.s;   // 画回原来的大小（同一个任务里，屏幕上不会闪）
    if (hasLabels) renderLabels();
    if (hasCache) cacheOK = false;
    draw(performance.now());
    drawSampleIcons(ctx, scale);
    return out;
  }
  function thumbOf(canvas, maxW) {
    const t = document.createElement('canvas');
    t.width = maxW; t.height = Math.round(canvas.height * maxW / canvas.width);
    const c = t.getContext('2d'); c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.86);
  }
  window.desklandSnapshot = function (scale) { const c = snapshot(scale); return { canvas: c, thumb: thumbOf(c, 520) }; };
  window.desklandSnapshot.parts = { snapshot, drawSampleIcons, sampleGlyph, sampleLabel, thumbOf };   // 调试、测时间用

  /* ---- 分享动画：按当前桌面布局录制12秒主题动画，图标与文件名仍用示例图形保护隐私 ----
     不模拟拖动、不添加临时图标、不重算图标场。暂停着就先放开，录完恢复暂停状态。
     只有网站离线演示工具显式指定 __recDemoStyle 时，才保留拖动演示编排。 */
  // 挑要拖的图标和放下的位置：从图标扎堆的地方拖出来，放到离别的图标最远的格子上（不贴画面边、拖的距离适中）
  function planMoves(list, n, only) {
    const H2 = H - TASKBAR, cells = [];
    for (let c = 0; GRID_X0 + (c + 1) * CELL_W <= W; c++)
      for (let r = 0; GRID_Y0 + (r + 1) * CELL_H <= H2; r++) cells.push([GRID_X0 + c * CELL_W, GRID_Y0 + r * CELL_H]);
    const pos = new Map(list.map(ic => [ic, [ic.x, ic.y]]));
    const ctr = ic => { const p = pos.get(ic); return [p[0] + ic.w / 2, p[1] + ic.h / 2]; };
    const moves = [];
    for (let k = 0; k < n; k++) {
      let best = null;
      for (const ic of list) {
        if (only && ic !== only) continue;   // 只考虑指定图标（避让/落点仍按全体算）
        const [cx, cy] = ctr(ic);
        let nb = 0;
        for (const o of list) if (o !== ic) { const [ox, oy] = ctr(o); if (Math.hypot(ox - cx, oy - cy) < 170) nb++; }
        for (const [x, y] of cells) {
          const dx = x + ic.w / 2, dy = y + ic.h / 2, d = Math.hypot(dx - cx, dy - cy);
          if (d < 260 || d > 900 || Math.min(dx, dy, W - dx, H2 - dy) < 90) continue;
          let md = 1e9;
          for (const o of list) if (o !== ic) { const [ox, oy] = ctr(o); md = Math.min(md, Math.hypot(ox - dx, oy - dy)); }
          const score = Math.min(md, 420) + Math.min(nb, 6) * 25 + rnd(x, y, 3 + (window.__recSeed || 0)) * 30;
          if (!best || score > best.score) best = { ic, from: pos.get(ic).slice(), to: [x, y], score };
        }
      }
      if (!best) break;
      moves.push(best);
      pos.set(best.ic, best.to);
    }
    return moves;
  }
  // 挑一批图标一起拖：从图标最密的地方框一块（K 个最近的图标的外框，框里的都算），整批平移到离别的图标最远、放得下的地方；
  // 找不到地方就少框几个再试。pos：前面几次拖完以后的位置；fixed：直接指定要框的这一批（网页演示用）
  function planGroup(list, pos, fixed) {
    if (list.length < 4) return null;
    const H2 = H - TASKBAR, ctr = ic => { const p = pos.get(ic); return [p[0] + ic.w / 2, p[1] + ic.h / 2]; };
    let cand = [];                                       // 依次尝试的几批（外框由每批图标撑出来）
    if (fixed) cand = [fixed];
    else {
      let seed = null, bn = -1;
      for (const ic of list) {
        const [cx, cy] = ctr(ic); let nb = 0;
        for (const o of list) if (o !== ic) { const [ox, oy] = ctr(o); if (Math.hypot(ox - cx, oy - cy) < 220) nb++; }
        if (nb > bn) { bn = nb; seed = ic; }
      }
      const [sx, sy] = ctr(seed);
      const byDist = list.slice().sort((a, b) => { const [ax, ay] = ctr(a), [bx, by] = ctr(b); return Math.hypot(ax - sx, ay - sy) - Math.hypot(bx - sx, by - sy); });
      for (let K = window.__recGroupCount || Math.max(5, Math.min(16, Math.round(list.length * 0.45))); K >= 4; K -= 2) cand.push(byDist.slice(0, K));   // 网页演示用 __recGroupCount 固定框几个；平时一次拖一大批：图标数的四成多，最多 16 个
    }
    for (const batch of cand) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const ic of batch) { const p = pos.get(ic); x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0] + ic.w); y1 = Math.max(y1, p[1] + ic.h); }
      const group = list.filter(ic => { const p = pos.get(ic); return p[0] >= x0 - 1 && p[1] >= y0 - 1 && p[0] + ic.w <= x1 + 1 && p[1] + ic.h <= y1 + 1; });
      const rest = list.filter(ic => !group.includes(ic)).map(ctr);
      const gw = x1 - x0, gh = y1 - y0;
      let best = null;
      for (let ty = 24; ty + gh <= H2 - 24; ty += 24) for (let tx = 24; tx + gw <= W - 24; tx += 24) {
        const dx = tx - x0, dy = ty - y0, d = Math.hypot(dx, dy);
        if (d < 300) continue;
        let md = 1e9;
        for (const [ox, oy] of rest) md = Math.min(md, Math.hypot(Math.max(tx - ox, 0, ox - tx - gw), Math.max(ty - oy, 0, oy - ty - gh)));
        const score = Math.min(md, 300) - d * 0.05 + rnd(tx, ty, 5 + (window.__recSeed || 0)) * 70;
        if (md >= 24 && (!best || score > best.score)) best = { dx, dy, score };   // 落下的地方不能挨着别的图标（至少空出 24px）
      }
      if (best)
        return { kind: 'group', group, from: group.map(ic => pos.get(ic).slice()), delta: [best.dx, best.dy], seed: batch[0], box: [x0, y0, x1, y1] };
    }
    return null;
  }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp01 = t => Math.min(1, Math.max(0, t));
  // 选中的图标：一块淡蓝的圆角底（像桌面上选中图标的样子）
  function drawSelected(ctx, ic, x, y, s, a) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    roundRect(ctx, x * s, y * s, ic.w * s, ic.h * s, 4 * s);
    ctx.fillStyle = 'rgba(170, 210, 255, 0.38)'; ctx.fill();
    ctx.lineWidth = Math.max(1, s); ctx.strokeStyle = 'rgba(200, 230, 255, 0.9)'; ctx.stroke();
    ctx.restore();
  }
  // 鼠标指针（经典的箭头：白色、黑边）
  function drawCursor(ctx, x, y, s, alpha) {
    if (alpha <= 0) return;
    const k = 1.6 * s, pts = [[0, 0], [0, 16], [4, 12.5], [6.8, 18.6], [9.3, 17.5], [6.6, 11.6], [11.5, 11.6]];
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(k, k);
    ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.save(); ctx.translate(0.8, 1.2); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.1; ctx.strokeStyle = '#111'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  function pickMime() {
    for (const t of ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'])
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    return null;
  }
  let busy = false;
  // 颜色范围：浏览器录 H.264 时把画面按"全范围"（0~255）编码，只在 MP4 的 colr 里注明，码流里没写；
  // 很多播放器（还有聊天软件转码）只看码流，当成"有限范围"（16~235）来放，结果白的发白、整体变亮。
  // 所以录之前先把颜色压进 16~235（SVG 滤镜，在 sRGB 里直接算），录完再把 colr 里的"全范围"标记改成"有限范围"：
  // 码流、容器、画面三者一致，按哪种规矩放都对
  function limitedRangeFilter() {
    if (document.getElementById('deskland-limited-range')) return 'url(#deskland-limited-range)';
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    const fl = document.createElementNS(ns, 'filter');
    fl.id = 'deskland-limited-range';
    fl.setAttribute('color-interpolation-filters', 'sRGB');
    const ct = document.createElementNS(ns, 'feComponentTransfer');
    for (const c of ['R', 'G', 'B']) {
      const fn = document.createElementNS(ns, 'feFunc' + c);
      fn.setAttribute('type', 'linear'); fn.setAttribute('slope', String(219 / 255)); fn.setAttribute('intercept', String(16 / 255));
      ct.appendChild(fn);
    }
    fl.appendChild(ct); svg.appendChild(fl); document.body.appendChild(svg);
    return 'url(#deskland-limited-range)';
  }
  // 把 MP4 里 colr（nclx）的"全范围"标记清掉（只在开头的 moov 里）
  async function markLimitedRange(blob) {
    const head = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());
    for (let i = 0; i + 15 < head.length; i++) {
      if (head[i] === 0x63 && head[i + 1] === 0x6f && head[i + 2] === 0x6c && head[i + 3] === 0x72 &&       // 'colr'
          head[i + 4] === 0x6e && head[i + 5] === 0x63 && head[i + 6] === 0x6c && head[i + 7] === 0x78) {  // 'nclx'
        head[i + 14] &= 0x7f;                                // 原色(2) 传递(2) 矩阵(2) 之后那个字节的最高位 = 全范围
        return new Blob([head, blob.slice(8192)], { type: blob.type });
      }
    }
    return blob;
  }
  // 录一段：返回 Promise<{ blob, mime, poster }>；onProgress(0..1)
  // 先等画面稳定：壁纸暂停着（比如设置窗口最大化了）就先放开跑一会儿，开场的树、房子没长好就等它长好（最多 6 秒）
  function record(onProgress) {
    const mime = pickMime();
    if (!mime) return Promise.reject(new Error('这台电脑不支持录视频'));
    if (busy) return Promise.reject(new Error('上一段还在录'));
    busy = true;
    const wasPaused = typeof paused !== 'undefined' && paused;
    if (wasPaused) paused = false;
    return new Promise(ok => {
      const t0 = performance.now(), f0 = frameN;
      const tick = () => {
        const dt = performance.now() - t0, ran = frameN - f0;
        if ((ran >= 10 && settled()) || dt > 6000 || (dt > 1000 && ran < 2)) ok(); else setTimeout(tick, 100);
      };
      if (!wasPaused && settled()) ok(); else tick();
    }).then(() => recordNow(onProgress, mime, wasPaused));
  }
  function recordNow(onProgress, mime, wasPaused) {
    // 画面大小：按屏幕比例，大约 200 万像素（宽高取偶数，H.264 要求）；网页视频可以用 window.__recMaxPixels 放宽
    const rs = Math.min(window.devicePixelRatio || 1, Math.sqrt((window.__recMaxPixels || 2.0e6) / (W * H)));
    const outW = Math.round(W * rs / 2) * 2, outH = Math.round(H * rs / 2) * 2;
    const old = { w: cv.width, h: cv.height, s: cv._scale };
    const hasLabels = typeof renderLabels === 'function';
    const hasCache = typeof cacheOK !== 'undefined';
    const demo = !WALL && !!window.__recDemoStyle;
    const saved = demo ? icons.map(ic => [ic, ic.x, ic.y]) : [];
    // 仅离线演示允许添加临时图标；普通分享保持空桌面。
    const temp = demo && !icons.length ? { x: W * 0.28, y: (H - TASKBAR) * 0.3, w: 76, h: 92 } : null;
    if (temp) { icons.push(temp); commit(); }
    // 网页演示的编排（__recDemoStyle）：先单独拖"离屏幕中心最近的图标"（演示布局中间那个主角），
    // 再框选拖走左边一整片（演示布局两排共 5 个）——正好是"移动 1 个 / 移动多个"两种方式
    let moves = [];
    if (demo && !temp) {
      const cx = W / 2, cy = (H - TASKBAR) / 2;
      const hero = icons.reduce((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) <= Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) ? a : b);
      moves = planMoves(icons, 1, hero);
    } else if (demo) moves = planMoves(icons, temp ? 1 : 2);
    const HOLD0 = 0.8, DRAG = 1.5, ADAPT = 2.6, HOLD1 = 0.6;
    // 框选一批：0.3~1.1 秒拉选框，1.1~1.5 秒指针移到其中一个图标上，1.6~2.8 秒拖过去，松手后画面变 2.9 秒
    const GSEL = 1.1, GDROP = 2.8, GADAPT = 2.9;
    const after = new Map(icons.map(ic => [ic, [ic.x, ic.y]]));
    for (const m of moves) after.set(m.ic, m.to);
    let grp = demo && !temp ? planGroup(icons, after) : null;
    if (demo && !temp) {
      // 网页演示：多选固定框"右侧那两小排"（演示布局里列 2、3 的前 3 行那 6 个）
      const bx0 = GRID_X0 + 2 * CELL_W - 2, bx1 = GRID_X0 + 4 * CELL_W - 2, by1 = GRID_Y0 + 3 * CELL_H - 2;
      const block = icons.filter(ic => ic.x >= bx0 && ic.x < bx1 && ic.y < by1);
      if (block.length) grp = planGroup(icons, after, block);
    }
    if (grp) moves.push(grp);
    let tt = HOLD0;
    for (const m of moves) { m.t0 = tt; m.done = false; tt += m.kind === 'group' ? GDROP + GADAPT : DRAG + ADAPT; }
    const total = demo ? tt + HOLD1 : 12;

    cv.width = outW; cv.height = outH; cv._scale = rs;
    if (hasLabels && labelsReady()) renderLabels();
    if (hasCache) cacheOK = false;
    if (typeof paused !== 'undefined') paused = false;
    const comp = document.createElement('canvas');             // 先在这上面拼好一帧（画面 + 图标 + 指针）
    comp.width = outW; comp.height = outH;
    const ctx = comp.getContext('2d');
    const rec = document.createElement('canvas');               // 再把颜色压进 16~235 画到这上面，录的是这张
    rec.width = outW; rec.height = outH;
    const rctx = rec.getContext('2d');
    const mp4 = mime.indexOf('mp4') >= 0 && !window.__recFullRange;
    if (mp4) rctx.filter = limitedRangeFilter();
    const stream = rec.captureStream(0), track = stream.getVideoTracks()[0];
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: window.__recBitrate || 8e6 });
    // 网页演示视频用全范围（window.__recFullRange）：颜色不压进 16~235，明艳不发灰；分享出去的仍压（聊天软件兼容）
    const chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    return new Promise((resolve, reject) => {
      const origDraw = draw;
      let t0 = null, lastProg = -1, finished = false, poster = null;
      const finish = err => {
        if (finished) return;
        finished = true;
        draw = origDraw;
        for (const [ic, x, y] of saved) { ic.x = x; ic.y = y; }
        if (temp) icons.splice(icons.indexOf(temp), 1);
        cv.width = old.w; cv.height = old.h; cv._scale = old.s;
        if (hasLabels && labelsReady()) renderLabels();
        if (hasCache) cacheOK = false;
        if (demo) commit();                                  // 仅演示编排需要恢复图标场
        if (typeof paused !== 'undefined') paused = hostPause === null ? wasPaused : hostPause;
        busy = false;
        if (err) { try { mr.stop(); } catch (e) { } reject(err); return; }
        mr.onstop = () => {
          const blob = new Blob(chunks, { type: mime.split(';')[0] });
          (mp4 ? markLimitedRange(blob) : Promise.resolve(blob)).then(b => resolve({ blob: b, mime: mime.split(';')[0], poster }));
        };
        mr.stop();
      };
      // 主题每画好一帧（同一个任务里，画布还没被清掉）：拷过来，画上图标、指针，交给录像
      draw = function (now) {
        origDraw(now);
        if (finished) return;
        if (t0 === null) { t0 = now; mr.start(); }
        const t = (now - t0) / 1000;
        ctx.drawImage(cv, 0, 0, outW, outH);
        const disp = new Map();                              // 这一帧位置、样子和平时不一样的图标
        let cursor = null, selRect = null;
        for (const m of moves) {
          const dt = t - m.t0;
          if (m.kind === 'group') {
            if (dt >= GDROP && !m.done) {                    // 松手：一批图标一起落下，画面开始变
              m.done = true;
              m.group.forEach((ic, i) => { ic.x = m.from[i][0] + m.delta[0]; ic.y = m.from[i][1] + m.delta[1]; });
              commit();
            }
            if (dt < 0 || dt > GDROP + 0.8) continue;
            const [bx0, by0, bx1, by1] = m.box, A = [bx0 - 16, by0 - 16], B = [bx1 + 16, by1 + 16];
            const si = m.group.indexOf(m.seed), grab = [m.from[si][0] + m.seed.w * 0.55, m.from[si][1] + m.seed.h * 0.32];
            let cx, cy, off = [0, 0], lift = 0;
            if (dt < GSEL) {                                 // 拉选框
              const p = ease(clamp01((dt - 0.3) / (GSEL - 0.3)));
              cx = A[0] + (B[0] - A[0]) * p; cy = A[1] + (B[1] - A[1]) * p;
              if (dt > 0.3) selRect = [A[0], A[1], cx, cy];
            } else if (dt < 1.5) {                           // 指针移到其中一个图标上
              const p = ease((dt - GSEL) / (1.5 - GSEL));
              cx = B[0] + (grab[0] - B[0]) * p; cy = B[1] + (grab[1] - B[1]) * p;
            } else {                                         // 按住，整批拖过去
              const p = ease(clamp01((dt - 1.6) / (GDROP - 1.6)));
              off = [m.delta[0] * p, m.delta[1] * p - Math.sin(Math.PI * p) * 30];
              lift = dt < GDROP ? Math.min(1, (dt - 1.5) / 0.12) : 0;
              cx = grab[0] + off[0]; cy = grab[1] + off[1];
            }
            m.group.forEach((ic, i) => {
              const x = dt < GDROP ? m.from[i][0] + off[0] : ic.x, y = dt < GDROP ? m.from[i][1] + off[1] : ic.y;
              let sel;
              if (dt < GSEL) {                               // 选框碰到的才选中
                sel = selRect && x < Math.max(selRect[0], selRect[2]) && x + ic.w > Math.min(selRect[0], selRect[2]) &&
                  y < Math.max(selRect[1], selRect[3]) && y + ic.h > Math.min(selRect[1], selRect[3]) ? 1 : 0;
              } else sel = dt < GDROP + 0.2 ? 1 : Math.max(0, 1 - (dt - GDROP - 0.2) / 0.4);
              disp.set(ic, { x, y, lift, sel });
            });
            const alpha = Math.min(1, dt / 0.25) * (dt > GDROP + 0.3 ? Math.max(0, 1 - (dt - GDROP - 0.3) / 0.3) : 1);
            cursor = [cx * rs, cy * rs, alpha];
            continue;
          }
          if (dt >= DRAG && !m.done) { m.done = true; m.ic.x = m.to[0]; m.ic.y = m.to[1]; commit(); }   // 松手：图标落下，画面开始变
          if (dt < 0 || dt > DRAG + 0.6) continue;
          const p = ease(clamp01((dt - 0.4) / (DRAG - 0.4)));
          const x = m.from[0] + (m.to[0] - m.from[0]) * p, y = m.from[1] + (m.to[1] - m.from[1]) * p - Math.sin(Math.PI * p) * 24;
          const lift = dt < 0.35 ? 0 : dt < DRAG ? Math.min(1, (dt - 0.35) / 0.12) : 0;
          if (dt < DRAG) disp.set(m.ic, { x, y, lift, sel: 0 });
          const alpha = Math.min(1, dt / 0.25) * (dt > DRAG + 0.3 ? Math.max(0, 1 - (dt - DRAG - 0.3) / 0.3) : 1);
          cursor = [(x + m.ic.w * 0.55) * rs, (y + m.ic.h * 0.32) * rs, alpha];
        }
        for (const ic of icons) if (!disp.has(ic)) drawIcon(ctx, ic, rs, ic.x, ic.y, 0);
        for (const [ic, d] of disp) { drawSelected(ctx, ic, d.x, d.y, rs, d.sel * (1 - 0.4 * d.lift)); drawIcon(ctx, ic, rs, d.x, d.y, d.lift); }
        if (selRect) {                                       // 选框：淡蓝的半透明方框
          const [ax, ay, bx, by] = selRect.map(v => v * rs);
          ctx.fillStyle = 'rgba(0, 120, 215, 0.2)'; ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
          ctx.lineWidth = Math.max(1, rs); ctx.strokeStyle = 'rgba(0, 120, 215, 0.9)';
          ctx.strokeRect(Math.min(ax, bx) + 0.5, Math.min(ay, by) + 0.5, Math.abs(bx - ax), Math.abs(by - ay));
        }
        if (cursor) drawCursor(ctx, cursor[0], cursor[1], rs, cursor[2]);
        rctx.drawImage(comp, 0, 0);
        track.requestFrame();
        const prog = Math.min(1, t / total);
        if (onProgress && prog - lastProg >= 0.05) { lastProg = prog; onProgress(prog); }
        if (t >= total) { poster = thumbOf(comp, 520); finish(null); }
      };
      setTimeout(() => finish(new Error('画面没有动起来（壁纸可能被完全挡住了）')), (total + 8) * 1000);
    });
  }
  window.desklandRecord = record;
  window.desklandRecord.parts = { planMoves, planGroup };   // 调试用


  // 壁纸模式：宿主发来 snapshot → 画好以后发回去（"snapshot|缩略图|整张 PNG"，整张图很大，不走 JSON）；
  // 发来 record → 录一段动画，途中发 "recprogress|0..1"，录完发 "record|格式|封面|整段视频"（都是 data URL）
  // 壁纸暂停着的时候（比如设置窗口最大化了）：先放开跑一会儿，等画面稳定（树、房子长好）再画，画完按宿主最近一次的意思恢复暂停
  const host = WALL && window.chrome && window.chrome.webview;
  let hostPause = null;
  function settled() {
    return typeof trees === 'undefined' || !trees.length || trees.every(t => t.grow === t.want);
  }
  function send() {
    try {
      const r = window.desklandSnapshot();
      host.postMessage('snapshot|' + r.thumb + '|' + r.canvas.toDataURL('image/png'));
    } catch (e) { host.postMessage('snapshot|error|' + (e && e.message || e)); }
  }
  if (host) host.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m) return;
    if (m.t === 'pause') { hostPause = !!m.v; return; }
    if (m.t === 'record') {
      record(p => host.postMessage('recprogress|' + p.toFixed(2))).then(r => {
        const fr = new FileReader();
        fr.onload = () => host.postMessage('record|' + r.mime + '|' + r.poster + '|' + fr.result);
        fr.onerror = () => host.postMessage('record|error|读不出录好的视频');
        fr.readAsDataURL(r.blob);
      }, e => host.postMessage('record|error|' + (e && e.message || e)));
      return;
    }
    if (m.t !== 'snapshot') return;
    if (busy) { host.postMessage('snapshot|error|正在录动画，等录完再试'); return; }
    if (typeof paused === 'undefined' || !paused) { send(); return; }
    paused = false;
    const t0 = performance.now(), f0 = frameN;
    const wait = () => {
      const dt = performance.now() - t0, ran = frameN - f0;
      // 至少跑 10 帧；树、房子都长好了就画；最多等 6 秒；动画根本没在跑（窗口被挡得太死）就别等了
      if ((ran >= 10 && settled()) || dt > 6000 || (dt > 1000 && ran < 2)) {
        send();
        paused = hostPause === null ? true : hostPause;
      } else setTimeout(wait, 100);
    };
    setTimeout(wait, 100);
  });
})();
