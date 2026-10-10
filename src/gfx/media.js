/* メディアのオーバーレイ（描画しているウィンドウで動く：1 画面のとき・2 画面の出力ウィンドウ）。
 *   image   画像（設定の data URL）→ レンダラーのテクスチャ
 *   video   動画ファイル（mediastore.js から読む）→ <video> → 毎フレームテクスチャへ
 *   capture 画面・タブの取り込み（getDisplayMedia。YouTube・ニコニコなどを別のタブで再生して取り込む）→ 同上
 *   camera  カメラ（Web カメラ・キャプチャーボード。getUserMedia）→ 同上
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

    /** いま出すメディア（ShowController.effectiveMedia：曲の指定 → 一覧から選んだもの → 設定のメディア） */
    _eff(app) {
      if (app.show && app.show.effectiveMedia) return app.show.effectiveMedia();
      const o = app.settings.overlay || {};
      return { kind: o.mediaKind || 'image', image: o.image || '', key: o.videoKey || '', url: o.webUrl || '', cameraId: o.cameraId || '', mirror: !!o.cameraMirror };
    },
    _sig(e) { return [e.kind, e.key, e.url, e.cameraId, e.image ? e.image.length + ':' + e.image.slice(-24) : ''].join('|'); },

    /** 設定・曲に合わせて、メディアを用意する・片付ける（設定を反映するたび・出すメディアが変わったときに呼ばれる） */
    sync(app) {
      media.app = app;
      const s = app.settings, o = s.overlay || {}, r = app.renderer;
      const eff = media._eff(app);
      media._effSig = media._sig(eff);
      const on = !!s.overlayOn, kind = eff.kind;
      // 「止める」で止めたカメラは、ほかのメディアに替えた・O で出し直したら、また開いてよい
      if (kind !== 'camera' || (on && media._lastOn === false)) media._camHold = false;
      media._lastOn = on;
      media.effKind = kind;
      if (kind !== 'capture' && media.stream) media.stopCapture(true);
      if (kind !== 'camera' && media.cam) media.stopCamera(true);
      if (kind !== 'image') { r.setOverlayImage(''); media._imgSeq++; }
      if (kind !== 'video' && kind !== 'capture' && kind !== 'camera') r.setOverlayVideo(null);
      if (kind !== 'video') media._dropVideo();
      if (kind !== 'web') media._dropWeb();
      if (kind === 'image') {
        if (eff.image) { media._imgSeq++; r.setOverlayImage(eff.image); } else if (eff.key) media._imageFromKey(eff.key);
        else r.setOverlayImage('');
        media.kind = eff.image || eff.key ? 'image' : '';
        if (eff.image || !eff.key) media.status = eff.image ? 'ready' : 'empty';
      } else if (kind === 'video') {
        if (eff.key !== media.videoKey) media._loadVideo(eff.key);
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
      } else if (kind === 'camera') {
        // カメラは出すときに開く（開いたあとは O で消しても開いたまま：すぐ出せるように）
        if (on || media.cam) media._syncCamera(eff);
        else { media.kind = ''; media.status = 'stopped'; }
      } else if (kind === 'web') {
        media._syncWeb(eff.url, o.videoSound);
        if (media.web) media.web.box.hidden = !on;
      } else {
        media.kind = '';
        media.status = 'empty';
      }
    },

    // ---------------------------------------------------------------- 一覧の画像（保存場所から読む）
    _imgSeq: 0,
    _img: null, // { key, url }
    async _imageFromKey(key) {
      const r = media.app.renderer;
      // 読み込み中のほかの画像があれば、その結果は使わない（番号を進める）
      if (media._img && media._img.key === key) { media._imgSeq++; r.setOverlayImage(media._img.url); media.status = 'ready'; return; }
      const seq = ++media._imgSeq;
      media.status = 'loading';
      const blob = await VJ.mediaStore.get(key);
      if (seq !== media._imgSeq) return;
      if (!blob) { media.status = 'missing'; media.kind = ''; return; }
      if (media._img) URL.revokeObjectURL(media._img.url);
      media._img = { key, url: URL.createObjectURL(blob) };
      r.setOverlayImage(media._img.url);
      media.status = 'ready';
    },

    // ---------------------------------------------------------------- カメラ（Web カメラ・キャプチャーボード）
    cam: null, // { id, stream, video, label }
    _camSeq: 0,
    _camRetryAt: 0,
    _camHold: false, // 「止める」で止めた（もう一度「カメラを開く」か O で出すまで開かない）
    _syncCamera(eff) {
      const r = media.app.renderer, want = eff.cameraId || '';
      const c = media.cam;
      if (c && c.id === want) { r.setOverlayVideo(c.video); media.kind = 'camera'; return; }
      if (media._camHold) { media.kind = ''; media.status = 'stopped'; return; }
      if (media._camStarting === want) return;
      media.startCamera(want, true).catch(() => {});
    },

    /** カメラを開く（id が空なら既定のカメラ）。開いている途中なら、その結果を待つ。
     *  auto = メディアを出すとき・外れたあとに自動で：選んだカメラが無くても、ほかのカメラ（操作者を映す PC のカメラなど）は開かない。
     *  「カメラを開く」（auto でない）だけ、選んだカメラが無ければほかのカメラで開いて知らせ、選んだカメラがつながったら戻す */
    startCamera(id, auto) {
      id = typeof id === 'string' ? id : '';
      if (!auto) { media._camHold = false; media._camRetryAt = 0; }
      if (media.cam && media.cam.id === id) return Promise.resolve({ label: media.cam.label, fallback: !!media.cam.fallback });
      if (media._camStarting === id && media._camPromise) return media._camPromise;
      return (media._camPromise = media._openCamera(id, { fallback: !auto }));
    },

    /** opts.fallback：選んだカメラが無ければほかのカメラで。opts.upgrade：ほかのカメラで出している間に、選んだカメラに戻せるか試す（失敗しても表示は変えない） */
    async _openCamera(id, opts) {
      opts = opts || {};
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) { media.status = 'camerror'; media.error = VJ.t('この環境ではカメラを使えません'); throw new Error(media.error); }
      const seq = ++media._camSeq;
      media._camStarting = id || '';
      if (!opts.upgrade) media.status = 'loading';
      const want = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      let stream, fallback = false;
      try {
        try {
          stream = await md.getUserMedia({ video: Object.assign({}, want, id ? { deviceId: { exact: id } } : {}), audio: false });
        } catch (e) {
          if (!opts.fallback || !id || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
          stream = await md.getUserMedia({ video: want, audio: false });
          fallback = true;
        }
      } catch (e) {
        if (seq === media._camSeq) {
          media._camStarting = null;
          if (!opts.upgrade) {
            const missing = id && e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError');
            media.status = 'camerror';
            media.error = e && e.name === 'NotAllowedError' ? VJ.t('カメラの使用が許可されていません（アドレスバー左のアイコンから許可）')
              : missing ? VJ.t('選んだカメラが見つかりません（つないでから「↻」、またはほかのカメラを選んで「カメラを開く」）') : (e && e.message) || String(e);
            // 許可されなかったときは聞き直さない。見つからない・使用中のときは少し待って開き直す
            media._camRetryAt = e && e.name === 'NotAllowedError' ? Infinity : performance.now() + 3000;
          }
        }
        throw e;
      }
      const s = media.app && media.app.settings;
      const stillWanted = seq === media._camSeq && media.effKind === 'camera';
      if (!stillWanted) {
        for (const t of stream.getTracks()) t.stop();
        if (seq === media._camSeq) media._camStarting = null; // 開いている途中で別のメディアに替わった：次に出すときにまた開けるように
        return null;
      }
      media.stopCamera(true);
      const v = media._hiddenVideo();
      v.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      const cam = (media.cam = { id: id || '', stream, video: v, label: (track && track.label) || '', fallback });
      media._camStarting = null;
      media._camUpgradeAt = performance.now() + 5000;
      media.error = fallback ? VJ.t('選んだカメラが見つからないので、ほかのカメラを使っています') : '';
      if (track) {
        track.addEventListener('ended', () => {
          if (media.cam !== cam) return;
          media.stopCamera(true);
          media.status = 'lost';
          media._camRetryAt = performance.now() + 2000; // 抜けたら 2 秒ごとに開き直す
          if (media.app) media.app.show._toast(VJ.t('カメラが外れました。つなぎ直すと戻ります'), 'warn');
        });
      }
      await v.play().catch(() => {});
      if (media.cam !== cam) return null; // 再生を待つ間に止めた・替えた
      media.status = 'playing';
      media.kind = 'camera';
      if (media.app) { media.app.renderer.setOverlayVideo(v); if (s) media.sync(media.app); }
      if (opts.upgrade && media.app) media.app.show._toast(VJ.t('選んだカメラに戻しました'));
      return { label: cam.label, fallback };
    },

    stopCamera(quiet) {
      const c = media.cam;
      media._camSeq++;
      media._camStarting = null;
      if (c) {
        for (const t of c.stream.getTracks()) t.stop();
        if (media.app && media.app.renderer.ovVideo === c.video) media.app.renderer.setOverlayVideo(null);
        c.video.srcObject = null;
        c.video.remove();
      }
      media.cam = null;
      if (media.kind === 'camera') media.kind = '';
      if (!quiet) { media.status = 'stopped'; media._camHold = true; }
      return true;
    },

    /** カメラの一覧 [{ id, label }]（許可する前は名前が空のことがある） */
    async listCameras() {
      const md = navigator.mediaDevices;
      if (!md || !md.enumerateDevices) return [];
      const list = await md.enumerateDevices();
      return list.filter((d) => d.kind === 'videoinput').map((d) => ({ id: d.deviceId || '', label: d.label || '' }));
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
      // O キーでの ON/OFF・曲が変わってメディアが変わった（m:…）ときは用意し直す
      if (!!app.settings.overlayOn !== media._lastOn || media._sig(media._eff(app)) !== media._effSig) media.sync(app);
      // カメラが外れた・見つからなかったときは、少し待って開き直す
      if (media.effKind === 'camera' && app.settings.overlayOn && !media.cam && !media._camHold && media._camStarting == null && performance.now() > media._camRetryAt) { media._camRetryAt = performance.now() + 3000; media.sync(app); }
      // 選んだカメラが無くてほかのカメラで出しているときは、5 秒ごとに選んだカメラがつながったか試す
      const c0 = media.cam;
      if (c0 && c0.fallback && c0.id && media._camStarting == null && performance.now() > (media._camUpgradeAt || 0)) {
        media._camUpgradeAt = performance.now() + 5000;
        media._openCamera(c0.id, { upgrade: true }).catch(() => {});
      }
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
      media.stopCamera(true);
      media._dropVideo();
      media._dropWeb();
      if (media.app) { media.app.renderer.setOverlayVideo(null); media.app.renderer.setOverlayImage(''); }
      media._lastOn = undefined;
      media.status = '';
    },

    /** 操作ウィンドウへ返す状態 */
    state() {
      const app = media.app;
      const eff = app && app.show && app.show.effectiveMedia ? app.show.effectiveMedia() : { kind: '' };
      const kind = eff.kind;
      const v = kind === 'video' ? media.video : kind === 'capture' ? media.capVideo : kind === 'camera' && media.cam ? media.cam.video : null;
      return {
        kind, status: media.status, error: media.error, name: eff.name || '', song: !!eff.song,
        size: v && v.videoWidth ? [v.videoWidth, v.videoHeight] : null,
        capture: !!media.stream, label: media.stream && media.stream.getVideoTracks()[0] ? media.stream.getVideoTracks()[0].label : '',
        camera: !!media.cam, cameraLabel: media.cam ? media.cam.label : '',
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
