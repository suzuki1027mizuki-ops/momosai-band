/* 設定の保存・読み込み（localStorage + JSON ファイル書き出し/取り込み）。 */
(function (/** @type {VJNamespace} */ VJ) {
  'use strict';

  const KEY = 'momosai-vj/v1';
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

  /** 既定値に、保存されていた値を重ねる。型・範囲・選択肢・文字数は schema.js の決まりで直す（壊れた設定ファイル・
   *  手で書き換えた設定・ちがう版の設定でも動くように）。既定値のオブジェクトは共有しない（複製する） */
  function merge(base, src) {
    if (!isObj(src)) src = null;
    const out = VJ.settingsSchema.apply(base, src);
    if (src) {
      // YouTube・ニコニコの埋め込みはやめた：使っていた設定なら、パネルで一度だけ知らせる（メディアは画像に、一覧からは外れる）
      if ((isObj(src.overlay) && src.overlay.mediaKind === 'web') || (Array.isArray(src.mediaLib) && src.mediaLib.some((x) => isObj(x) && x.kind === 'web'))) notes.add('web-removed');
      // 古い設定：オーバーレイの ON/OFF が 1 つだったときは、シーンのオーバーレイもそれに合わせる
      if (!('ovSceneOn' in src) && typeof src.overlayOn === 'boolean') out.ovSceneOn = src.overlayOn;
    }
    // 出演バンドの一覧と、いまのバンドの番号（bands.js）
    if (VJ.bands) VJ.bands.ensure(out);
    return out;
  }

  const TRANSITIONS = VJ.settingsSchema.schema.transition.oneOf;

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
