/* 設定の保存・読み込み（localStorage + JSON ファイル書き出し/取り込み）。 */
(function (VJ) {
  'use strict';

  const KEY = 'momosai-vj/v1';

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /** 既定値に、保存されていた値を型が合うものだけ重ねる。既定値のオブジェクトは共有しない（複製する） */
  function merge(base, src) {
    const out = clone(base);
    if (!isObj(src)) return out;
    for (const k of Object.keys(base)) {
      if (!(k in src)) continue;
      const bv = base[k], sv = src[k];
      if (Array.isArray(bv)) {
        if (Array.isArray(sv) && sv.length === bv.length) out[k] = clone(sv);
      } else if (isObj(bv)) {
        if (isObj(sv)) out[k] = clone(sv);
      } else if (typeof bv === typeof sv && (typeof sv !== 'number' || isFinite(sv))) {
        out[k] = sv;
      }
    }
    return sanitize(out);
  }

  /** 中身の形も確かめる（壊れた設定ファイルで動かなくならないように） */
  function sanitize(s) {
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
    return s;
  }

  const storage = {
    KEY,
    load() {
      try {
        const raw = globalThis.localStorage && localStorage.getItem(KEY);
        if (!raw) return merge(VJ.defaultSettings, null);
        return merge(VJ.defaultSettings, JSON.parse(raw));
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
        if (globalThis.localStorage) localStorage.setItem(KEY, JSON.stringify(settings));
        return true;
      } catch (e) {
        return false;
      }
    },
    reset() {
      try { if (globalThis.localStorage) localStorage.removeItem(KEY); } catch (e) { /* noop */ }
      return merge(VJ.defaultSettings, null);
    },
    /** JSON 文字列から読み込み（不正なキーは無視） */
    fromJSON(text) {
      return merge(VJ.defaultSettings, JSON.parse(text));
    },
    toJSON(settings) {
      return JSON.stringify(settings, null, 2);
    },
    merge,
  };

  VJ.storage = storage;
})(globalThis.VJ = globalThis.VJ || {});
