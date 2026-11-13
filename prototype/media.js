// 正在播放：壁纸页面引入本文件后调用 DesklandMedia.subscribe(fn)。
// 在宿主里：宿主读 Windows 系统媒体控件（Spotify、浏览器、播放器……），曲目或播放状态变了才发一次。
// 在浏览器 / 设置窗口的预览里：没有宿主，每 12 秒换一首虚构的示例曲目，方便调染色效果。
//
// fn(state)：
//   on       有没有媒体会话（false 时主题回到自己的配色）
//   playing  是否正在播放（暂停时 on 仍是 true）
//   title / artist / album / app   文本（曲名属于隐私：只在用户打开相关选项时显示）
//   colors   封面主色 ['#rrggbb', …]（最多 3 个，按占比排序；没有封面时是空数组）
//   art      96px 封面的 data URI，或 ''
//   real     true = 来自宿主
(function () {
  'use strict';
  const state = { on: false, playing: false, title: '', artist: '', album: '', app: '', colors: [], art: '', real: false };
  const subs = new Set();
  let started = false, demoTimer = 0, demoI = 0, listening = false;
  const preview = new URLSearchParams(location.search).has('preview');
  const host = !preview && window.chrome && window.chrome.webview;

  function emit() { for (const fn of subs) { try { fn(state); } catch (e) { console.error(e); } } }

  function take(m) {
    state.real = true;
    state.on = !!m.on;
    state.playing = !!m.playing;
    state.title = m.title || ''; state.artist = m.artist || ''; state.album = m.album || ''; state.app = m.app || '';
    state.colors = Array.isArray(m.colors) ? m.colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)) : [];
    state.art = typeof m.art === 'string' && m.art.startsWith('data:image/') ? m.art : '';
    emit();
  }

  const DEMO = [
    { title: 'Neon Harbor', artist: 'Deskland Demo', colors: ['#e0407a', '#3a2a8c', '#f2b33d'] },
    { title: 'Moss and Rain', artist: 'Deskland Demo', colors: ['#3f8f6b', '#c9d77a', '#21384a'] },
    { title: 'Copper Sunset', artist: 'Deskland Demo', colors: ['#e86e28', '#1e8c96', '#2a1c3a'] },
  ];
  function demo() {
    const d = DEMO[demoI++ % DEMO.length];
    take({ on: true, playing: true, title: d.title, artist: d.artist, album: '', app: 'Demo', colors: d.colors });
    state.real = false;
    emit();
  }

  function start() {
    if (started) return;
    started = true;
    if (host) {
      if (!listening) {
        listening = true;
        host.addEventListener('message', ev => {
          if (!started || typeof ev.data !== 'string' || ev.data.indexOf('"t":"media"') < 0) return;
          try { take(JSON.parse(ev.data)); } catch (e) { }
        });
      }
      host.postMessage('media|on');
    } else {
      demo();
      demoTimer = setInterval(demo, 12000);
    }
  }

  function stop() {
    if (!started) return;
    started = false;
    if (host) host.postMessage('media|off');
    else { clearInterval(demoTimer); demoTimer = 0; }
    Object.assign(state, { on: false, playing: false, title: '', artist: '', album: '', app: '', colors: [], art: '' });
  }

  window.DesklandMedia = {
    state,
    subscribe(fn) {
      subs.add(fn); start();
      if (state.on) fn(state);
      return () => { if (subs.delete(fn) && subs.size === 0) stop(); };
    },
  };
})();
