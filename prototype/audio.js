// 声音响应：壁纸页面引入本文件后，先 DesklandAudio.subscribe(fn) 打开（返回的函数用来关闭），
// 再在自己的每一帧里调用 DesklandAudio.read(now) 取当前的值。
// 在宿主里：宿主采集系统正在播放的声音（WASAPI 回环，不碰麦克风），每秒 60 帧发来频谱。
// 在浏览器 / 设置窗口的预览里：没有宿主，用一段合成的 120 BPM 节奏代替，方便调画面。
//
// 为什么要 read(now)：消息和页面的画面是两个不同的节拍，直接用收到的值，画面会"一帧动、一帧不动"地发顿。
// read(now) 按真实经过的时间把显示值平滑地追向最新收到的值，每一帧都在动，和消息什么时候到无关。
//
// read(now) 返回的 state（同一个对象）：
//   on    是否有声音（静音 1 秒后变 false，主题应回到平常的样子）
//   lv    整体响度 0–1（自动增益，跟系统音量无关）
//   bass / mid / high   低（<250Hz）/ 中 / 高（>2kHz）三档 0–1
//   bands Float32Array(32)，30Hz–16kHz 对数分布 0–1
//   beat  上次 read 之后来了节拍（只在一次 read 里是 true）；beatAge 距上一拍的秒数
//   real  true = 来自宿主的真实声音，false = 合成演示
// subscribe 的 fn(state) 仍会在每条消息到达时调用（可以不用，传一个空函数只为打开声音）
(function () {
  'use strict';
  const BANDS = 32;
  const state = { on: false, lv: 0, bass: 0, mid: 0, high: 0, bands: new Float32Array(BANDS), beat: false, beatAge: 99, real: false };
  const target = { lv: 0, bass: 0, mid: 0, high: 0, bands: new Float32Array(BANDS) };
  const subs = new Set();
  let started = false, lastBeats = -1, lastBeatAt = -1e9, demoTimer = 0, pendingBeat = false, lastRead = 0;
  // 上升快、回落稍慢（宿主那边已经平滑过一次，这里只负责把两条消息之间补平）
  const ATTACK = 0.03, RELEASE = 0.085;

  function emit() {
    for (const fn of subs) { try { fn(state); } catch (e) { console.error(e); } }
  }

  function take(m) {
    state.real = true;
    state.on = !!m.on;
    if (!m.on) {
      target.lv = target.bass = target.mid = target.high = 0;
      target.bands.fill(0);
      lastBeats = -1;
      emit();
      return;
    }
    target.lv = m.lv; target.bass = m.bass; target.mid = m.mid; target.high = m.high;
    if (Array.isArray(m.b)) for (let i = 0; i < BANDS && i < m.b.length; i++) target.bands[i] = m.b[i];
    // 宿主发的是累计拍数：漏掉一帧也不会丢拍
    if (lastBeats >= 0 && m.beats > lastBeats) { pendingBeat = true; lastBeatAt = performance.now(); }
    lastBeats = m.beats;
    emit();
  }

  function read(now) {
    now = now || performance.now();
    const dt = lastRead ? Math.min(0.1, Math.max(0, (now - lastRead) / 1000)) : 0.016;
    lastRead = now;
    const ka = 1 - Math.exp(-dt / ATTACK), kr = 1 - Math.exp(-dt / RELEASE);
    const f = (cur, t) => cur + (t - cur) * (t > cur ? ka : kr);
    state.lv = f(state.lv, target.lv); state.bass = f(state.bass, target.bass);
    state.mid = f(state.mid, target.mid); state.high = f(state.high, target.high);
    for (let i = 0; i < BANDS; i++) state.bands[i] = f(state.bands[i], target.bands[i]);
    state.beat = pendingBeat; pendingBeat = false;
    state.beatAge = (now - lastBeatAt) / 1000;
    return state;
  }

  // 合成演示：底鼓 120 BPM，军鼓在 2、4 拍，加一点慢慢起伏的中高频
  function demo() {
    const t = performance.now() / 1000, beatLen = 0.5;
    const ph = t % beatLen, n = Math.floor(t / beatLen);
    const kick = Math.exp(-ph * 9), snare = (n % 2 ? Math.exp(-ph * 12) : 0);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.4);
    if (ph < 0.02 && performance.now() - lastBeatAt > 300) { pendingBeat = true; lastBeatAt = performance.now(); }
    for (let i = 0; i < BANDS; i++) {
      const x = i / (BANDS - 1);
      const v = kick * Math.max(0, 1 - x * 4) + snare * 0.7 * Math.exp(-((x - 0.55) ** 2) / 0.02)
        + swell * 0.45 * Math.exp(-((x - 0.4) ** 2) / 0.05) * (0.7 + 0.3 * Math.sin(t * 3 + i))
        + 0.25 * (1 - x) * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.6));
      target.bands[i] = Math.min(1, v);
    }
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += target.bands[i]; return s / (b - a); };
    target.bass = avg(0, 7); target.mid = avg(7, 19); target.high = avg(19, BANDS);
    target.lv = Math.min(1, 0.35 + kick * 0.5 + swell * 0.15);
    state.on = true;
    emit();
  }

  const preview = new URLSearchParams(location.search).has('preview');
  const host = !preview && window.chrome && window.chrome.webview;
  let listening = false;

  function start() {
    if (started) return;
    started = true;
    if (host) {
      if (!listening) {
        listening = true;
        host.addEventListener('message', ev => {
          if (!started || typeof ev.data !== 'string' || ev.data.indexOf('"t":"audio"') < 0) return;
          try { take(JSON.parse(ev.data)); } catch (e) { }
        });
      }
      host.postMessage('audio|on');
    } else {
      demoTimer = setInterval(demo, 16);
    }
  }

  // 没有订阅者了：让宿主关掉声卡回环（或停掉演示）
  function stop() {
    if (!started) return;
    started = false;
    if (host) host.postMessage('audio|off');
    else { clearInterval(demoTimer); demoTimer = 0; }
    state.on = false; pendingBeat = false; lastBeats = -1;
    target.lv = target.bass = target.mid = target.high = 0; target.bands.fill(0);
    state.lv = state.bass = state.mid = state.high = 0; state.bands.fill(0);
  }

  window.DesklandAudio = {
    state,
    read,
    subscribe(fn) {
      subs.add(fn); start();
      return () => { if (subs.delete(fn) && subs.size === 0) stop(); };
    },
  };
})();
