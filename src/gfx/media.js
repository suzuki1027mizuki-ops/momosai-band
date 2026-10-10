/* メディアのオーバーレイ（描画しているウィンドウで動く：1 画面のとき・2 画面の出力ウィンドウ）。
 *   image   画像（設定の data URL）→ レンダラーのテクスチャ
 *   video   動画ファイル（mediastore.js から読む）→ <video> → 毎フレームテクスチャへ
 *   capture 画面・タブの取り込み（getDisplayMedia。YouTube・ニコニコなどを別のタブで再生して取り込む）→ 同上
 *   web     YouTube / ニコニコの埋め込み（<iframe> をキャンバスの上に重ねる。中身は別のサイトなので
 *           WebGL には取り込めない → 揺れ・フラッシュの演出は掛からず、CSS で濃さ・重ね方・明るさ・暗転だけ合わせる）
 * 動画の中の点滅は、このソフトでは制限できない（パネルと本番前チェックで注意を出す）。 */
(function (VJ) {
  'use strict';

  /** YouTube / ニコニコの URL → { provider, id, start, embed, origin }（読めなければ null） */
  function parseWebUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    const secs = (v) => {
      if (!v) return 0;
      const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(String(v));
      return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    };
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const p = u.pathname.split('/').filter(Boolean);
      if (p[0] === 'watch') id = u.searchParams.get('v') || '';
      else if (['embed', 'shorts', 'live', 'v'].includes(p[0])) id = p[1] || '';
    }
    if (id && /^[\w-]{11}$/.test(id)) {
      const start = secs(u.searchParams.get('t') || u.searchParams.get('start'));
      const q = new URLSearchParams({ autoplay: '1', mute: '1', loop: '1', playlist: id, controls: '0', playsinline: '1', rel: '0', enablejsapi: '1', iv_load_policy: '3', disablekb: '1', fs: '0' });
      if (start) q.set('start', String(start));
      return { provider: 'youtube', id, start, embed: `https://www.youtube-nocookie.com/embed/${id}?${q}`, origin: 'https://www.youtube-nocookie.com' };
    }
    if (host === 'nicovideo.jp' || host === 'nico.ms' || host === 'sp.nicovideo.jp' || host === 'embed.nicovideo.jp') {
      const m = /((?:sm|so|nm)\d+)/.exec(u.pathname);
      if (!m) return null;
      const start = secs(u.searchParams.get('from') || u.searchParams.get('t'));
      const q = new URLSearchParams({ jsapi: '1', playerId: '1' });
      if (start) q.set('from', String(start));
      return { provider: 'niconico', id: m[1], start, embed: `https://embed.nicovideo.jp/watch/${m[1]}?${q}`, origin: 'https://embed.nicovideo.jp' };
    }
    return null;
  }

  const media = {
    parseWebUrl,
    app: null,
    kind: '', // いま出しているもの
    status: '', // 表示用の状態（下の state()）
    error: '',
    video: null, // 動画ファイルの <video>
    videoKey: '',
    capVideo: null, // 取り込みの <video>
    stream: null,
    web: null, // { box, inner, iframe, info, url }
    webMuted: true,
    _loadSeq: 0,

    /** 設定に合わせて、メディアを用意する・片付ける（設定を反映するたびに呼ばれる） */
    sync(app) {
      media.app = app;
      const s = app.settings, o = s.overlay || {}, r = app.renderer;
      const on = !!s.overlayOn, kind = o.mediaKind || 'image';
      media._lastOn = on;
      if (kind !== 'capture' && media.stream) media.stopCapture(true);
      if (kind !== 'image') r.setOverlayImage('');
      if (kind !== 'video' && kind !== 'capture') r.setOverlayVideo(null);
      if (kind !== 'video') media._dropVideo();
      if (kind !== 'web') media._dropWeb();
      if (kind === 'image') {
        r.setOverlayImage(o.image || '');
        media.kind = o.image ? 'image' : '';
        media.status = o.image ? 'ready' : 'empty';
      } else if (kind === 'video') {
        if (o.videoKey !== media.videoKey) media._loadVideo(o.videoKey);
        const v = media.video;
        if (v) {
          v.loop = !!o.videoLoop;
          v.muted = !o.videoSound;
          if (on && v.paused && !v._userPaused && !(v.ended && !v.loop)) v.play().catch(() => {});
          if (!on && !v.paused) v.pause();
          r.setOverlayVideo(v);
        }
      } else if (kind === 'capture') {
        r.setOverlayVideo(media.capVideo);
        media.kind = media.capVideo ? 'capture' : '';
        if (!media.capVideo) media.status = 'stopped';
      } else if (kind === 'web') {
        media._syncWeb(o.webUrl, o.videoSound);
        if (media.web) media.web.box.hidden = !on;
      }
    },

    _hiddenVideo() {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      // 画面の外に置くと、ブラウザが絵を作らなくなることがあるので、見えないほど小さく置く
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(v);
      return v;
    },

    async _loadVideo(key) {
      const seq = ++media._loadSeq;
      media._dropVideo();
      media.videoKey = key || '';
      if (!key) { media.status = 'empty'; media.kind = ''; return; }
      media.status = 'loading';
      const blob = await VJ.mediaStore.get(key);
      if (seq !== media._loadSeq) return;
      if (!blob) { media.status = 'missing'; media.kind = ''; return; }
      const v = media._hiddenVideo();
      v._url = URL.createObjectURL(blob);
      v.src = v._url;
      v.addEventListener('error', () => { if (media.video === v) { media.status = 'error'; media.error = (v.error && v.error.message) || ''; } });
      v.addEventListener('playing', () => { if (media.video === v) media.status = 'playing'; });
      v.addEventListener('pause', () => { if (media.video === v && !v.ended) media.status = 'paused'; });
      v.addEventListener('ended', () => { if (media.video === v) media.status = 'ended'; });
      media.video = v;
      media.kind = 'video';
      if (media.app) media.sync(media.app);
    },

    _dropVideo() {
      const v = media.video;
      if (v) {
        if (media.app && media.app.renderer.ovVideo === v) media.app.renderer.setOverlayVideo(null);
        v.pause();
        v.removeAttribute('src');
        v.load();
        if (v._url) URL.revokeObjectURL(v._url);
        v.remove();
      }
      media.video = null;
      media.videoKey = '';
      if (media.kind === 'video') media.kind = '';
    },

    /** 画面・タブを取り込む（ユーザーの操作から呼ぶ。共有する画面を選ぶ画面が出る） */
    async startCapture() {
      const md = navigator.mediaDevices;
      if (!md || !md.getDisplayMedia) throw new Error(VJ.t('この環境では画面の取り込みができません'));
      const stream = await md.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } }, audio: false,
        selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false,
      });
      media.stopCapture(true);
      const v = media._hiddenVideo();
      v.srcObject = stream;
      media.stream = stream;
      media.capVideo = v;
      const track = stream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', () => { if (media.stream === stream) { media.stopCapture(true); media.status = 'stopped'; if (media.app) media.app.show._toast(VJ.t('画面の取り込みが終わりました'), 'warn'); } });
      await v.play().catch(() => {});
      media.status = 'playing';
      media.kind = 'capture';
      if (media.app) {
        const s = media.app.settings;
        s.overlay.mediaKind = 'capture';
        s.overlayOn = true;
        media.sync(media.app);
      }
      return { label: (track && track.label) || '' };
    },

    stopCapture(quiet) {
      const st = media.stream;
      if (st) for (const t of st.getTracks()) t.stop();
      const v = media.capVideo;
      if (v) {
        if (media.app && media.app.renderer.ovVideo === v) media.app.renderer.setOverlayVideo(null);
        v.srcObject = null;
        v.remove();
      }
      media.stream = null;
      media.capVideo = null;
      if (media.kind === 'capture') media.kind = '';
      if (!quiet) media.status = 'stopped';
      return true;
    },

    // ---------------------------------------------------------------- YouTube / ニコニコ
    _syncWeb(url, sound) {
      const info = parseWebUrl(url);
      if (!info) { media._dropWeb(); media.status = url ? 'badurl' : 'empty'; return; }
      if (media.web && media.web.url === info.embed) {
        if (media.webMuted === !!sound) media.webCmd(sound ? 'unmute' : 'mute');
        return;
      }
      media._dropWeb();
      const box = document.createElement('div');
      box.id = 'web-overlay';
      box.style.cssText = 'position:fixed;overflow:hidden;pointer-events:none;z-index:1;left:0;top:0;width:0;height:0';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:absolute;left:50%;top:50%;overflow:hidden';
      const ifr = document.createElement('iframe');
      ifr.src = info.embed;
      ifr.allow = 'autoplay; encrypted-media; picture-in-picture';
      ifr.referrerPolicy = 'strict-origin-when-cross-origin';
      ifr.setAttribute('frameborder', '0');
      ifr.style.cssText = 'position:absolute;border:0;pointer-events:none';
      ifr.title = info.provider;
      inner.appendChild(ifr);
      box.appendChild(inner);
      document.body.appendChild(box);
      media.web = { box, inner, iframe: ifr, info, url: info.embed, layout: '' };
      media.webMuted = true;
      media.kind = 'web';
      media.status = 'loading';
      ifr.addEventListener('load', () => {
        if (!media.web || media.web.iframe !== ifr) return;
        media.status = 'playing';
        // YouTube：命令を受けてもらうための合図。ニコニコ：読み込みが終わった通知（loadComplete）を待って再生する
        if (info.provider === 'youtube') media._post({ event: 'listening', id: 'momosai' });
        setTimeout(() => { if (media.web && media.web.iframe === ifr) { media.webCmd('play'); if (sound) media.webCmd('unmute'); } }, 800);
      });
    },

    _dropWeb() {
      if (media.web) media.web.box.remove();
      media.web = null;
      if (media.kind === 'web') media.kind = '';
    },

    _post(msg) {
      const w = media.web;
      if (!w || !w.iframe.contentWindow) return false;
      try {
        if (w.info.provider === 'youtube') w.iframe.contentWindow.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg), w.info.origin);
        else w.iframe.contentWindow.postMessage(msg, w.info.origin);
        return true;
      } catch (e) {
        return false;
      }
    },

    /** 再生の操作：play / pause / restart / mute / unmute（動画ファイル・YouTube・ニコニコ） */
    webCmd(name) {
      const w = media.web;
      if (w) {
        if (name === 'mute' || name === 'unmute') media.webMuted = name === 'mute';
        if (w.info.provider === 'youtube') {
          const yt = { play: ['playVideo'], pause: ['pauseVideo'], restart: ['seekTo', [w.info.start || 0, true]], mute: ['mute'], unmute: ['unMute'] }[name];
          if (!yt) return false;
          media._post({ event: 'command', func: yt[0], args: yt[1] || [] });
          if (name === 'restart') media._post({ event: 'command', func: 'playVideo', args: [] });
          return true;
        }
        const nico = { play: { eventName: 'play' }, pause: { eventName: 'pause' }, restart: { eventName: 'seek', data: { time: (w.info.start || 0) * 1000 } },
          mute: { eventName: 'mute', data: { mute: true } }, unmute: { eventName: 'mute', data: { mute: false } } }[name];
        if (!nico) return false;
        media._post(Object.assign({ sourceConnectorType: 1, playerId: '1' }, nico));
        if (name === 'restart') media._post({ eventName: 'play', sourceConnectorType: 1, playerId: '1' });
        return true;
      }
      const v = media.video;
      if (!v) return false;
      if (name === 'play') { v._userPaused = false; v.play().catch(() => {}); } else if (name === 'pause') { v._userPaused = true; v.pause(); } else if (name === 'restart') { v.currentTime = 0; v._userPaused = false; v.play().catch(() => {}); } else if (name === 'mute') v.muted = true;
      else if (name === 'unmute') v.muted = false;
      else return false;
      return true;
    },

    /** ニコニコの埋め込みからの通知（読み込み完了で再生・終わったら最初から＝ループ） */
    _onNico(d) {
      const w = media.web;
      if (!w || w.info.provider !== 'niconico' || !d || typeof d.eventName !== 'string') return;
      if (d.eventName === 'loadComplete') { media.webCmd(media.webMuted ? 'mute' : 'unmute'); media.webCmd('play'); }
      else if (d.eventName === 'playerStatusChange' && d.data && d.data.playerStatus === 4) media.webCmd('restart');
    },

    /** 毎フレーム（描画のあと）：O キーでの ON/OFF に合わせて動画を止める・動かす。埋め込みの位置・大きさ・濃さを映像に合わせる */
    frame(fr) {
      const app = media.app;
      if (!app || (VJ.link && VJ.link.role === 'control')) return;
      if (!!app.settings.overlayOn !== media._lastOn) media.sync(app);
      const w = media.web;
      if (!w) return;
      const r = app.renderer, c = r.canvas, s = app.settings, o = s.overlay;
      const show = !!s.overlayOn && !!fr && !!fr.ovWeb;
      if (!show) { if (!w.box.hidden) w.box.hidden = true; return; }
      const k = (c.clientWidth || c.width) / Math.max(1, c.width);
      const [cx, cy, aw, ah] = r.area;
      const out = r.output, rot = out.rotate || 0, rot90 = rot === 90 || rot === 270;
      const lw = rot90 ? ah : aw, lh = rot90 ? aw : ah;
      // 16:9 の動画を論理の画面に合わせる（stretch は枠いっぱい。黒い帯は埋め込み側が付ける）
      const A = lw / lh, a = 16 / 9;
      let vw = lw, vh = lh;
      if (o.imageFit !== 'stretch') {
        if ((o.imageFit === 'cover') === (a > A)) vw = lh * a; else vh = lw / a;
      }
      const left = (cx - aw / 2) * k, top = (c.height - cy - ah / 2) * k;
      const blend = o.imageBlend === 'add' ? 'plus-lighter' : o.imageBlend === 'screen' ? 'screen' : 'normal';
      const op = Math.max(0, Math.min(1, fr.ovWeb.alpha * (1 - (fr.black || 0))));
      const bri = Math.max(0, Math.min(1, fr.master === undefined ? 1 : fr.master));
      const sig = [left, top, aw * k, ah * k, lw * k, lh * k, vw * k, vh * k, rot, out.flipH, out.flipV, blend, op.toFixed(3), bri.toFixed(2)].join(',');
      if (w.box.hidden) w.box.hidden = false;
      if (sig === w.layout) return;
      w.layout = sig;
      const bs = w.box.style, is = w.inner.style, fs = w.iframe.style;
      bs.left = left + 'px'; bs.top = top + 'px'; bs.width = aw * k + 'px'; bs.height = ah * k + 'px';
      bs.opacity = String(op);
      bs.mixBlendMode = blend;
      bs.filter = bri < 0.999 ? `brightness(${bri})` : '';
      is.width = lw * k + 'px'; is.height = lh * k + 'px';
      is.transform = `translate(-50%, -50%) scale(${out.flipH ? -1 : 1}, ${out.flipV ? -1 : 1}) rotate(${rot}deg)`;
      fs.width = vw * k + 'px'; fs.height = vh * k + 'px';
      fs.left = (lw - vw) * k / 2 + 'px'; fs.top = (lh - vh) * k / 2 + 'px';
    },

    /** このウィンドウでは出さない（2 画面にしたとき：出力ウィンドウが受け持つ） */
    release() {
      media.stopCapture(true);
      media._dropVideo();
      media._dropWeb();
      if (media.app) { media.app.renderer.setOverlayVideo(null); media.app.renderer.setOverlayImage(''); }
      media._lastOn = undefined;
      media.status = '';
    },

    /** 操作ウィンドウへ返す状態 */
    state() {
      const s = media.app ? media.app.settings : null;
      const kind = s && s.overlay ? s.overlay.mediaKind : '';
      const v = kind === 'video' ? media.video : kind === 'capture' ? media.capVideo : null;
      return {
        kind, status: media.status, error: media.error,
        size: v && v.videoWidth ? [v.videoWidth, v.videoHeight] : null,
        capture: !!media.stream, label: media.stream && media.stream.getVideoTracks()[0] ? media.stream.getVideoTracks()[0].label : '',
      };
    },
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('message', (e) => {
      const w = media.web;
      if (!w || e.source !== w.iframe.contentWindow) return;
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
      if (w.info.provider === 'niconico') media._onNico(d);
    });
  }

  VJ.media = media;
})(globalThis.VJ = globalThis.VJ || {});
