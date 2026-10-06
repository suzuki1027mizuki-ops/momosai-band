/* 設定の保存・読み込み（localStorage + JSON ファイル書き出し/取り込み）。 */
(function (VJ) {
  'use strict';

  const KEY = 'momosai-vj/v1';

  function merge(base, src) {
    const out = Object.assign({}, base);
    if (!src || typeof src !== 'object') return out;
    for (const k of Object.keys(base)) {
      if (!(k in src)) continue;
      const bv = base[k], sv = src[k];
      if (Array.isArray(bv)) {
        if (Array.isArray(sv) && sv.length === bv.length) out[k] = sv.slice();
      } else if (typeof bv === typeof sv) {
        out[k] = sv;
      }
    }
    return out;
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
