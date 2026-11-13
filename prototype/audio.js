// 声音响应：壁纸页面引入本文件后调用 DesklandAudio.subscribe(fn)。
// 在宿主里：请宿主采集系统正在播放的声音（WASAPI 回环，不碰麦克风），约每秒 30 帧。
// 在浏览器 / 设置窗口的预览里：没有宿主，用一段合成的 120 BPM 节奏代替，方便调画面。
//
// fn(state) 每帧调用一次，state 是同一个对象（不要长期持有里面的数组引用以外的东西）：
//   on    是否有声音（静音 1 秒后变 false，主题应回到平常的样子）
//   lv    整体响度 0–1（自动增益，跟系统音量无关）
//   bass / mid / high   低（<250Hz）/ 中 / 高（>2kHz）三档 0–1
//   bands Float32Array(32)，30Hz–16kHz 对数分布 0–1
//   beat  这一帧是否是节拍（低频冲击）；beatAge 距上一拍的秒数
//   real  true = 来自宿主的真实声音，false = 合成演示
(function () {
  'use strict';
  const BANDS = 32;
  const state = { on: false, lv: 0, bass: 0, mid: 0, high: 0, bands: new Float32Array(BANDS), beat: false, beatAge: 99, real: false };
  const subs = new Set();
  let started = false, lastBeats = -1, lastBeatAt = -1e9, demoTimer = 0;

  function emit() {
    state.beatAge = (performance.now() - lastBeatAt) / 1000;
    for (const fn of subs) { try { fn(state); } catch (e) { console.error(e); } }
    state.beat = false;
  }

  function take(m) {
    state.real = true;
    state.on = !!m.on;
    if (!m.on) {
      state.lv = state.bass = state.mid = state.high = 0;
      state.bands.fill(0);
      lastBeats = -1;
      emit();
      return;
    }
    state.lv = m.lv; state.bass = m.bass; state.mid = m.mid; state.high = m.high;
    if (Array.isArray(m.b)) for (let i = 0; i < BANDS && i < m.b.length; i++) state.bands[i] = m.b[i];
    // 宿主发的是累计拍数：漏掉一帧也不会丢拍
    if (lastBeats >= 0 && m.beats > lastBeats) { state.beat = true; lastBeatAt = performance.now(); }
    lastBeats = m.beats;
    emit();
  }

  // 合成演示：底鼓 120 BPM，军鼓在 2、4 拍，加一点慢慢起伏的中高频
  function demo() {
    const t = performance.now() / 1000, beatLen = 0.5;
    const ph = t % beatLen, n = Math.floor(t / beatLen);
    const kick = Math.exp(-ph * 9), snare = (n % 2 ? Math.exp(-ph * 12) : 0);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.4);
    if (ph < 0.034 && performance.now() - lastBeatAt > 300) { state.beat = true; lastBeatAt = performance.now(); }
    for (let i = 0; i < BANDS; i++) {
      const x = i / (BANDS - 1);
      let v = kick * Math.max(0, 1 - x * 4) + snare * 0.7 * Math.exp(-((x - 0.55) ** 2) / 0.02)
        + swell * 0.45 * Math.exp(-((x - 0.4) ** 2) / 0.05) * (0.7 + 0.3 * Math.sin(t * 3 + i))
        + 0.25 * (1 - x) * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.6));
      state.bands[i] += (Math.min(1, v) - state.bands[i]) * 0.5;
    }
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += state.bands[i]; return s / (b - a); };
    state.bass = avg(0, 7); state.mid = avg(7, 19); state.high = avg(19, BANDS);
    state.lv = Math.min(1, 0.35 + kick * 0.5 + swell * 0.15);
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
      demoTimer = setInterval(demo, 33);
    }
  }

  // 没有订阅者了：让宿主关掉声卡回环（或停掉演示）
  function stop() {
    if (!started) return;
    started = false;
    if (host) host.postMessage('audio|off');
    else { clearInterval(demoTimer); demoTimer = 0; }
    state.on = false; state.lv = state.bass = state.mid = state.high = 0; state.bands.fill(0); lastBeats = -1;
  }

  window.DesklandAudio = {
    state,
    subscribe(fn) {
      subs.add(fn); start();
      return () => { if (subs.delete(fn) && subs.size === 0) stop(); };
    },
  };
})();
