/* 設定の保存・読み込み（localStorage + JSON ファイル書き出し/取り込み）。 */
(function (VJ) {
  'use strict';

  const KEY = 'momosai-vj/v1';
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  // 出演バンドの一覧（ロゴを含むので大きい）は別に保存し、変わったときだけ書く（キー操作のたびに数 MB を書かないように）
  const BANDS_KEY = KEY + '/bands';
  let savedBands = { ref: null, ver: -1 };
  // 大きい画像（ロゴ・メディアの画像。合わせて 1MB を超える）も別に保存し、変わったときだけ書く。
  // 設定と一緒に書くと、キー操作のたびに 1 フレーム分（十数 ms）描画が止まる
  const BIG = [
    { key: KEY + '/logo', get: (s) => (typeof s.logo === 'string' ? s.logo : ''), put: (o, v) => { if (!o.logo) o.logo = v; } },
    { key: KEY + '/ovimg', get: (s) => (isObj(s.overlay) && typeof s.overlay.image === 'string' ? s.overlay.image : ''), put: (o, v) => { if (isObj(o.overlay) && !o.overlay.image) o.overlay.image = v; } },
  ];
  let savedBig = BIG.map(() => null); // 最後に保存した中身（null = まだ分からない）
  // 読み込んだ設定について、利用者に一度だけ知らせること（'web-removed' など）。パネルが takeNotes で受け取る
  const notes = new Set();

  /** 既定値に、保存されていた値を型が合うものだけ重ねる。既定値のオブジェクトは共有しない（複製する） */
  function merge(base, src) {
    const out = clone(base);
    if (!isObj(src)) return out;
    for (const k of Object.keys(base)) {
      if (!(k in src)) continue;
      const bv = base[k], sv = src[k];
      if (Array.isArray(bv)) {
        // 出演バンドの一覧は長さが変わる（中身は sanitize で確かめる）
        if (Array.isArray(sv) && (sv.length === bv.length || k === 'bands' || k === 'mediaLib' || k === 'cues')) out[k] = clone(sv);
      } else if (isObj(bv)) {
        if (!isObj(sv)) continue;
        // 項目の決まっているもの（表示の調整・ブリッジ・OSC・照明）は、項目ごとに型を確かめ、無い項目は既定値のまま
        // （項目の欠けた設定ファイル・あとから項目が増える前の古い設定でも、欄が空にならないように）
        if (SHAPED.includes(k)) { for (const kk of Object.keys(bv)) if (typeOk(bv[kk], sv[kk])) out[k][kk] = sv[kk]; }
        else out[k] = clone(sv);
      } else if (typeOk(bv, sv)) {
        out[k] = sv;
      }
    }
    // YouTube・ニコニコの埋め込みはやめた：使っていた設定なら、パネルで一度だけ知らせる（メディアは画像に、一覧からは外れる）
    if ((isObj(src.overlay) && src.overlay.mediaKind === 'web') || (Array.isArray(src.mediaLib) && src.mediaLib.some((x) => isObj(x) && x.kind === 'web'))) notes.add('web-removed');
    // 古い設定：オーバーレイの ON/OFF が 1 つだったときは、シーンのオーバーレイもそれに合わせる
    if (!('ovSceneOn' in src) && typeof src.overlayOn === 'boolean') out.ovSceneOn = src.overlayOn;
    return sanitize(out);
  }

  const TRANSITIONS = ['fade', 'wipe', 'iris', 'blinds', 'zoom', 'slide', 'glitch', 'mosaic', 'random'];
  const SHAPED = ['output', 'net', 'osc', 'dmx'];
  const typeOk = (b, v) => typeof b === typeof v && (typeof v !== 'number' || isFinite(v));
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clampI = (v, lo, hi) => clampN(Math.round(v), lo, hi);

  /** 中身の形も確かめる（壊れた設定ファイルで動かなくならないように） */
  function sanitize(s) {
    const D = VJ.defaultSettings;
    // 数値は、パネルで選べる範囲に入れる。選ぶものは、選択肢に無ければ既定値に（手で書き換えた設定ファイル・ちがう版の設定など）
    s.master = clampN(s.master, 0.2, 1);
    s.sensitivity = clampI(s.sensitivity, -5, 5);
    s.maxScale = clampN(s.maxScale, 0.4, 1);
    s.react = clampN(s.react, 0.3, 1.5);
    s.gateDb = clampN(s.gateDb, -80, -20);
    s.fpsCap = s.fpsCap > 0 ? 30 : 0; // 制限なしか 30fps
    s.crossfade = s.crossfade < 0 ? -1 : Math.min(4, s.crossfade);
    const np = VJ.palettes ? VJ.palettes.length : 1;
    s.paletteIdx = clampI(s.paletteIdx, 0, np - 1);
    s.bandPalette = clampI(s.bandPalette, -1, np - 1);
    s.lang = pick(s.lang, ['auto', 'ja', 'en'], D.lang);
    s.channel = pick(s.channel, ['mix', 'left', 'right'], D.channel);
    s.logoMode = pick(s.logoMode, ['title', 'corner', 'both', 'off'], D.logoMode);
    s.logoCorner = pick(s.logoCorner, ['tl', 'tr', 'bl', 'br'], D.logoCorner);
    s.demoKind = pick(s.demoKind, ['band', 'sing', 'speech'], D.demoKind);
    s.lastSource = pick(s.lastSource, ['mic', 'display', 'demo', 'file'], D.lastSource);
    if (VJ.profileById) s.profile = VJ.profileById(s.profile).id;
    // 画像は、設定の中に入れた画像（data URL）だけ（ほかの場所の画像を読みに行かない）
    if (!/^data:image\//.test(s.logo)) s.logo = '';
    s.customPalette = s.customPalette.map((c, i) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : D.customPalette[i]));
    // 表示の調整・ブリッジ・OSC・照明
    const o = s.output;
    o.rotate = pick(o.rotate, [0, 90, 180, 270], 0);
    o.size = clampN(o.size, 0.3, 1);
    o.x = clampN(o.x, -0.5, 0.5);
    o.y = clampN(o.y, -0.5, 0.5);
    const host = (v, d) => (v.trim() && v.length <= 255 ? v.trim() : d);
    s.net.url = s.net.url.trim().slice(0, 300);
    if (s.net.url && !/^wss?:\/\//i.test(s.net.url)) s.net.url = D.net.url;
    s.osc.host = host(s.osc.host, D.osc.host);
    s.osc.port = s.osc.port >= 1 && s.osc.port <= 65535 ? Math.round(s.osc.port) : D.osc.port;
    s.osc.rate = clampI(s.osc.rate, 10, 60);
    const d = s.dmx;
    d.out = pick(d.out, ['artnet', 'enttec', 'opendmx'], D.dmx.out);
    d.type = pick(d.type, ['rgb', 'drgb', 'rgbw', 'drgbw', 'dim'], D.dmx.type);
    d.host = host(d.host, D.dmx.host);
    d.universe = clampI(d.universe, 0, 32767);
    d.count = clampI(d.count, 1, 128);
    d.start = clampI(d.start, 1, 512);
    d.max = clampN(d.max, 0, 1);
    d.pulse = clampN(d.pulse, 0, 1);
    const sp = {};
    for (const [id, v] of Object.entries(s.sceneParams || {})) {
      if (Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === 'number' && isFinite(x))) sp[id] = v;
    }
    s.sceneParams = sp;
    const mm = {};
    for (const [k, v] of Object.entries(s.midiMap || {})) if (/^[nc]\d{1,3}$/.test(k) && typeof v === 'string') mm[k] = v;
    s.midiMap = mm;
    const as = {};
    for (const [k, v] of Object.entries(s.autoScenes || {})) if (typeof v === 'boolean') as[k] = v;
    s.autoScenes = as;
    if (!s.messages.every((m) => typeof m === 'string')) s.messages = s.messages.map((m) => (typeof m === 'string' ? m : ''));
    const pf = {};
    for (const [k, v] of Object.entries(s.panelFold || {})) if (/^[1-9]$/.test(k) && v === true) pf[k] = true;
    s.panelFold = pf;
    if (!TRANSITIONS.includes(s.transition)) s.transition = 'fade';
    s.flashLimit = Math.max(0, Math.min(30, Math.round(s.flashLimit)));
    s.intensity = Math.max(-1, Math.min(3, Math.round(s.intensity))); // -1 = 自動
    // オーバーレイ：無い項目・型の違う項目は既定値に（あとから増えた項目が古い設定に無くても動くように）
    const od = VJ.defaultSettings.overlay, ov = {};
    for (const k of Object.keys(od)) ov[k] = isObj(s.overlay) && typeof s.overlay[k] === typeof od[k] && (typeof od[k] !== 'number' || isFinite(s.overlay[k])) ? s.overlay[k] : od[k];
    ov.imageFit = pick(ov.imageFit, ['contain', 'cover', 'stretch'], od.imageFit);
    ov.imageBlend = pick(ov.imageBlend, ['normal', 'add', 'screen'], od.imageBlend);
    ov.mediaKind = pick(ov.mediaKind, ['image', 'video', 'capture', 'camera', 'lib'], od.mediaKind);
    ov.libId = /^[\w-]{0,40}$/.test(ov.libId) ? ov.libId : '';
    ov.cameraId = ov.cameraId.slice(0, 200);
    ov.cameraLabel = ov.cameraLabel.slice(0, 200);
    ov.videoKey = /^[\w-]{1,64}$/.test(ov.videoKey) ? ov.videoKey : '';
    ov.videoName = ov.videoName.slice(0, 200);
    ov.sceneBlend = pick(ov.sceneBlend, ['screen', 'add'], od.sceneBlend);
    ov.corner = pick(ov.corner, ['tl', 'tr', 'bl', 'br'], od.corner);
    ov.imageOpacity = Math.max(0, Math.min(1, ov.imageOpacity));
    ov.sceneOpacity = Math.max(0, Math.min(1, ov.sceneOpacity));
    ov.textOpacity = Math.max(0, Math.min(1, ov.textOpacity));
    ov.textSize = Math.max(0.5, Math.min(2, ov.textSize));
    if (!/^data:image\//.test(ov.image)) ov.image = '';
    s.overlay = ov;
    // メディアの一覧・キュー
    if (VJ.mediaLib) {
      const seen = new Set();
      s.mediaLib = (Array.isArray(s.mediaLib) ? s.mediaLib : []).map(VJ.mediaLib.clean).filter((x) => x && !seen.has(x.id) && seen.add(x.id)).slice(0, VJ.mediaLib.MAX);
    }
    if (VJ.cues) s.cues = (Array.isArray(s.cues) ? s.cues : []).map(VJ.cues.clean).filter(Boolean).slice(0, VJ.cues.MAX);
    if (VJ.bands) VJ.bands.ensure(s);
    return s;
  }

  const storage = {
    KEY,
    TRANSITIONS,
    load() {
      try {
        const raw = globalThis.localStorage && localStorage.getItem(KEY);
        if (!raw) return merge(VJ.defaultSettings, null);
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj.bands)) {
          const b = localStorage.getItem(BANDS_KEY);
          if (b) { try { obj.bands = JSON.parse(b); } catch (e) { /* 壊れていたら一覧は無しで */ } }
        }
        // 別に保存した大きい画像を戻す（古い保存では設定の中に入っている：そのまま使い、次の保存で分ける）
        if (isObj(obj)) {
          BIG.forEach((b, i) => {
            const v = localStorage.getItem(b.key);
            if (v && !b.get(obj)) { b.put(obj, v); if (b.get(obj) === v) savedBig[i] = v; }
          });
        }
        return merge(VJ.defaultSettings, obj);
      } catch (e) {
        return merge(VJ.defaultSettings, null);
      }
    },
    /** まだ一度も保存していない（初めて開いた） */
    isFresh() {
      try { return !(globalThis.localStorage && localStorage.getItem(KEY)); } catch (e) { return true; }
    },
    save(settings) {
      try {
        if (!globalThis.localStorage) return true;
        const rest = Object.assign({}, settings);
        delete rest.bands;
        // 大きい画像は先に別の場所へ（変わったときだけ）。設定の方には入れない
        BIG.forEach((b, i) => {
          const v = b.get(settings);
          if (savedBig[i] === v) return;
          if (v) localStorage.setItem(b.key, v); else localStorage.removeItem(b.key);
          savedBig[i] = v;
        });
        rest.logo = '';
        if (isObj(settings.overlay)) rest.overlay = Object.assign({}, settings.overlay, { image: '' });
        localStorage.setItem(KEY, JSON.stringify(rest));
        const ver = VJ.bands ? VJ.bands.version : 0;
        if (settings.bands !== savedBands.ref || ver !== savedBands.ver) {
          localStorage.setItem(BANDS_KEY, JSON.stringify(settings.bands || []));
          savedBands = { ref: settings.bands, ver };
        }
        return true;
      } catch (e) {
        savedBands = { ref: null, ver: -1 };
        savedBig = BIG.map(() => null);
        return false;
      }
    },
    reset() {
      try {
        if (globalThis.localStorage) {
          localStorage.removeItem(KEY);
          localStorage.removeItem(BANDS_KEY);
          for (const b of BIG) localStorage.removeItem(b.key);
        }
      } catch (e) { /* noop */ }
      savedBands = { ref: null, ver: -1 };
      savedBig = BIG.map(() => null);
      return merge(VJ.defaultSettings, null);
    },
    /** JSON 文字列から読み込み（不正なキーは無視） */
    fromJSON(text) {
      return merge(VJ.defaultSettings, JSON.parse(text));
    },
    /** 「設定を読み込み」のファイル。このソフトの設定でないもの（ほかの JSON）は読まない（全部が初期値に戻らないように） */
    fromFile(text) {
      const o = JSON.parse(text);
      const known = isObj(o) ? Object.keys(VJ.defaultSettings).filter((k) => k in o).length : 0;
      if (!isObj(o) || (o.v !== 1 && known < 3)) throw new Error(VJ.t ? VJ.t('MOMOSAI VJ の設定ファイルではありません') : 'not a settings file');
      return merge(VJ.defaultSettings, o);
    },
    /** 読み込んだ設定について、利用者に知らせること（一度だけ）。['web-removed'] など */
    takeNotes() {
      const out = [...notes];
      notes.clear();
      return out;
    },
    toJSON(settings) {
      return JSON.stringify(settings, null, 2);
    },
    merge,
  };

  VJ.storage = storage;
})(globalThis.VJ = globalThis.VJ || {});
