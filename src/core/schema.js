/* 設定の形（項目ごとの型・範囲・選択肢・文字数）。読み込み（storage.js）は、これに合わせて値を直す。
 * どの項目も、まず既定値（config.js）と同じ型か（数は有限か）を確かめ、違えば既定値にする。そのうえで次の決まりで直す：
 *   int        整数に丸める（範囲より先）
 *   min / max  範囲。外れたら端に寄せる（outside: 'default' なら既定値にする）
 *   oneOf      選択肢。無ければ既定値（or があればその値）
 *   re         文字列の形。合わなければ or の値（無ければ既定値）
 *   trim       前後の空白を除く（空白だけなら既定値）。maxLen 文字数の上限（trim のときは、超えたら既定値。そうでなければ切り詰める）
 *   fix(v, D)  上のどれでもない直し方
 *   ui         パネルの部品の id（範囲がパネルと同じかを単体テストで確かめる）
 * 入れ子（output・net・osc・dmx・overlay）は fields に、項目ごとに同じ形で書く（無い項目・型の違う項目は既定値）。
 * 長さの決まった配列は array（長さが違えば既定値。item で 1 つずつ直す）。形の自由なもの（出演バンド・メディアの一覧・
 * キュー・シーンの調整値など）は list（配列）・map（オブジェクト）として、clean で中身を確かめる。 */
(function (/** @type {VJNamespace} */ VJ) {
  'use strict';

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const np = () => (VJ.palettes ? VJ.palettes.length : 1);
  const DATA_IMAGE = /^data:image\//;
  const CORNERS = ['tl', 'tr', 'bl', 'br'];

  /** @type {Record<string, SettingSpec>} */
  const schema = {
    v: {},
    bandName: {},
    endText: {},
    setlistText: {},
    deviceId: {},
    deviceLabel: {},
    channel: { oneOf: ['mix', 'left', 'right'] },
    auto: {},
    autoFlash: {},
    toast: {},
    sensitivity: { int: true, min: -5, max: 5, ui: 'opt-sens' },
    master: { min: 0.2, max: 1, ui: 'opt-master' },
    paletteIdx: { int: true, min: 0, max: () => np() - 1 },
    customPalette: { array: 4, item: (c, i, D) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : D.customPalette[i]) },
    desynchronized: {},
    latencySquare: {},
    monitor: {},
    maxScale: { min: 0.4, max: 1, ui: 'opt-scale' },
    profile: { fix: (v) => (VJ.profileById ? VJ.profileById(v).id : v) },
    gateDb: { min: -80, max: -20, ui: 'opt-gate' },
    noFlash: {},
    flashLimit: { int: true, min: 0, max: 30 }, // 0 = 制限なし
    intensity: { int: true, min: -1, max: 3 }, // -1 = 自動
    paletteAuto: {},
    react: { min: 0.3, max: 1.5, ui: 'opt-react' },
    autoScenes: { map: true, clean: (m) => { const o = {}; for (const [k, v] of Object.entries(m)) if (typeof v === 'boolean') o[k] = v; return o; } },
    fpsCap: { fix: (v) => (v > 0 ? 30 : 0) }, // 制限なしか 30fps
    messages: { array: 3, item: (m) => (typeof m === 'string' ? m : '') },
    countdownTo: {},
    logo: { re: DATA_IMAGE, or: '' }, // 設定の中に入れた画像（data URL）だけ（ほかの場所の画像を読みに行かない）
    logoMode: { oneOf: ['title', 'corner', 'both', 'off'] },
    logoCorner: { oneOf: CORNERS },
    output: {
      fields: {
        rotate: { oneOf: [0, 90, 180, 270], or: 0 },
        flipH: {},
        flipV: {},
        size: { min: 0.3, max: 1, ui: 'out-size' },
        x: { min: -0.5, max: 0.5, ui: 'out-x' },
        y: { min: -0.5, max: 0.5, ui: 'out-y' },
      },
    },
    autoStart: {},
    lastSource: { oneOf: ['mic', 'display', 'demo', 'file'] },
    sceneParams: { map: true, clean: (m) => { const o = {}; for (const [id, v] of Object.entries(m)) if (Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === 'number' && isFinite(x))) o[id] = v; return o; } },
    speechTitle: {},
    demoKind: { oneOf: ['band', 'sing', 'speech'] },
    lang: { oneOf: ['auto', 'ja', 'en'] },
    crossfade: { fix: (v) => (v < 0 ? -1 : Math.min(4, v)) }, // 秒。0 = カット / -1 = 音楽のタイプに合わせる
    transition: { oneOf: ['fade', 'wipe', 'iris', 'blinds', 'zoom', 'slide', 'glitch', 'mosaic', 'random'] },
    midiMap: { map: true, clean: (m) => { const o = {}; for (const [k, v] of Object.entries(m)) if (/^[nc]\d{1,3}$/.test(k) && typeof v === 'string') o[k] = v; return o; } },
    net: {
      fields: {
        enabled: {},
        // 空（つながない）か ws:// / wss:// のアドレス
        url: { fix: (v, D) => { const u = v.trim().slice(0, 300); return u && !/^wss?:\/\//i.test(u) ? D.url : u; } },
      },
    },
    osc: {
      fields: {
        enabled: {},
        host: { trim: true, maxLen: 255 },
        port: { int: true, min: 1, max: 65535, outside: 'default' },
        rate: { int: true, min: 10, max: 60 },
      },
    },
    dmx: {
      fields: {
        enabled: {},
        out: { oneOf: ['artnet', 'enttec', 'opendmx'] },
        host: { trim: true, maxLen: 255 },
        universe: { int: true, min: 0, max: 32767, ui: 'dmx-uni' },
        type: { oneOf: ['rgb', 'drgb', 'rgbw', 'drgbw', 'dim'] },
        count: { int: true, min: 1, max: 128, ui: 'dmx-count' },
        start: { int: true, min: 1, max: 512, ui: 'dmx-start' },
        max: { min: 0, max: 1, ui: 'dmx-max' },
        pulse: { min: 0, max: 1, ui: 'dmx-pulse' },
        flash: {},
      },
    },
    bands: { list: true }, // 中身は bands.js（ensure）
    bandIdx: {}, // 範囲は bands.js（ensure）
    bandPalette: { int: true, min: -1, max: () => np() - 1 },
    overlayOn: {},
    ovSceneOn: {},
    overlay: {
      fields: {
        mediaKind: { oneOf: ['image', 'video', 'capture', 'camera', 'lib'] },
        libId: { re: /^[\w-]{0,40}$/, or: '' },
        cameraId: { maxLen: 200 },
        cameraLabel: { maxLen: 200 },
        cameraMirror: {},
        image: { re: DATA_IMAGE, or: '' },
        imageFit: { oneOf: ['contain', 'cover', 'stretch'] },
        imageBlend: { oneOf: ['normal', 'add', 'screen'] },
        imageOpacity: { min: 0, max: 1, ui: 'ov-imgop' },
        videoKey: { re: /^[\w-]{1,64}$/, or: '' },
        videoName: { maxLen: 200 },
        videoLoop: {},
        videoSound: {},
        scene: {}, // 重ねるシーン（無いシーンは描画のときに無視する）
        sceneBlend: { oneOf: ['screen', 'add'] },
        sceneOpacity: { min: 0, max: 1, ui: 'ov-sceneop' },
        textOn: {},
        clock: {},
        band: {},
        song: {},
        text: {},
        corner: { oneOf: CORNERS },
        textSize: { min: 0.5, max: 2, ui: 'ov-textsize' },
        textOpacity: { min: 0, max: 1, ui: 'ov-textop' },
      },
    },
    mediaLib: { list: true, clean: (a) => { if (!VJ.mediaLib) return a; const seen = new Set(); return a.map(VJ.mediaLib.clean).filter((x) => x && !seen.has(x.id) && seen.add(x.id)).slice(0, VJ.mediaLib.MAX); } },
    cues: { list: true, clean: (a) => (VJ.cues ? a.map(VJ.cues.clean).filter(Boolean).slice(0, VJ.cues.MAX) : a) },
    guide: {},
    panelFold: { map: true, clean: (m) => { const o = {}; for (const [k, v] of Object.entries(m)) if (/^[1-9]$/.test(k) && v === true) o[k] = true; return o; } },
    panelHelp: {},
  };

  const typeOk = (d, v) => typeof d === typeof v && (typeof v !== 'number' || isFinite(v));
  const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  const bound = (b) => (typeof b === 'function' ? b() : b);

  /** 1 項目を直す。spec：上の決まり、v：読み込んだ値、d：既定値（D はその項目の入っている既定値のオブジェクト） */
  function fit(spec, v, d, D) {
    if (spec.fields) {
      const out = {};
      for (const k of Object.keys(d)) out[k] = fit(spec.fields[k] || {}, isObj(v) ? v[k] : undefined, d[k], d);
      return out;
    }
    if (spec.array) return Array.isArray(v) && v.length === spec.array ? v.map((x, i) => spec.item(x, i, D)) : clone(d);
    if (spec.list) return Array.isArray(v) ? (spec.clean ? spec.clean(clone(v)) : clone(v)) : clone(d);
    if (spec.map) return isObj(v) ? spec.clean(clone(v)) : clone(d);
    if (!typeOk(d, v)) return d;
    if (spec.fix) return spec.fix(v, D);
    if (typeof v === 'number') {
      const lo = bound(spec.min), hi = bound(spec.max);
      // 範囲の外を既定値にするものは、丸める前の値で比べる（0.6 は 1 に丸めず、範囲の外とみなす）
      if (spec.outside === 'default' && (v < lo || v > hi)) return d;
      if (spec.int) v = Math.round(v);
      if (lo !== undefined) v = Math.max(lo, v);
      if (hi !== undefined) v = Math.min(hi, v);
    }
    if (spec.oneOf && !spec.oneOf.includes(v)) return 'or' in spec ? spec.or : d;
    if (typeof v === 'string') {
      if (spec.re && !spec.re.test(v)) return 'or' in spec ? spec.or : d;
      // trim：空白だけ・長すぎる（空白を除く前の長さで比べる）ものは既定値
      if (spec.trim) { if (!v.trim() || (spec.maxLen && v.length > spec.maxLen)) return d; v = v.trim(); }
      else if (spec.maxLen) v = v.slice(0, spec.maxLen);
    }
    return v;
  }

  /** 読み込んだ値 src を、既定値 D の形に合わせて直した新しい設定を返す（D は変えない） */
  function apply(D, src) {
    const out = {};
    for (const k of Object.keys(D)) {
      const spec = schema[k] || {};
      out[k] = isObj(src) && k in src ? fit(spec, src[k], D[k], D) : fit(spec, clone(D[k]), D[k], D);
    }
    return out;
  }

  VJ.settingsSchema = { schema, fit, apply };
})(globalThis.VJ = globalThis.VJ || {});
