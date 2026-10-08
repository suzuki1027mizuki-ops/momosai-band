/* 出演バンド（タイムテーブル）。バンドごとに「名前・セットリスト・ロゴ・音楽のタイプ・色・開演時刻・テロップ」を持ち、
 * 1 回の操作で切り替える。いま出ているバンドの値は設定の上の階層（bandName・setlistText など）にあり、
 * パネルの入力欄はそれを直接編集する。bands[bandIdx] は空の印（{}）で、ほかのバンドに切り替えるときに中身を移す
 * （ロゴ画像を 2 重に保存しないため）。DOM は使わない（単体テストから呼べる）。 */
(function (VJ) {
  'use strict';

  // bandPalette：そのバンドの色（パネルで選んだもの。曲ごとの色・C キーで変わる paletteIdx とは別）
  const KEYS = ['bandName', 'setlistText', 'logo', 'logoMode', 'profile', 'bandPalette', 'countdownTo', 'messages'];
  const MAX = 40;
  const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
  const checked = new WeakSet(); // 形を確かめた bands 配列（毎回作り直さない：保存の要・不要を参照で見分けるため）

  /** 1 バンド分の値の形を確かめる（壊れた設定ファイル・古い版でも動くように） */
  function cleanBand(b) {
    const D = VJ.defaultSettings, out = {};
    if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
    for (const k of KEYS) {
      const v = b[k];
      if (v === undefined) continue;
      if (k === 'messages') {
        if (Array.isArray(v)) out.messages = [0, 1, 2].map((i) => (typeof v[i] === 'string' ? v[i] : ''));
      } else if (k === 'logo') {
        if (typeof v === 'string' && (v === '' || /^data:image\//.test(v))) out.logo = v;
      } else if (k === 'bandPalette') {
        if (typeof v === 'number' && isFinite(v)) out.bandPalette = Math.max(-1, Math.round(v));
      } else if (typeof v === typeof D[k]) {
        out[k] = v;
      }
    }
    return out;
  }

  const bands = {
    KEYS,
    MAX,
    cleanBand,
    version: 0, // 一覧を変えるたびに増える（保存するかどうかの目印）
    touch() { bands.version++; },

    /** bands / bandIdx を使える形にする（無ければ、いまの設定を 1 組目にする） */
    ensure(s) {
      if (!Array.isArray(s.bands) || !checked.has(s.bands)) {
        s.bands = (Array.isArray(s.bands) ? s.bands : []).slice(0, MAX).map(cleanBand);
        checked.add(s.bands);
      }
      if (!s.bands.length) s.bands.push({});
      s.bandIdx = Math.max(0, Math.min(s.bands.length - 1, Math.round(+s.bandIdx || 0)));
      if (Object.keys(s.bands[s.bandIdx]).length) s.bands[s.bandIdx] = {};
      return s;
    },

    /** i 番目のバンドの値を読むだけ（複製しない。ロゴなど大きい値を毎回写さないように） */
    peek(s, i, k) {
      if (i === s.bandIdx) return s[k];
      const b = s.bands[i];
      if (!b) return undefined;
      return b[k] === undefined ? (k === 'setlistText' || k === 'bandName' ? '' : VJ.defaultSettings[k]) : b[k];
    },

    /** いまの設定から、バンドの値だけを取り出す */
    snapshot(s) {
      const out = {};
      for (const k of KEYS) out[k] = clone(s[k] === undefined ? VJ.defaultSettings[k] : s[k]);
      return out;
    },

    /** i 番目のバンドの値（いま出ているバンドは設定の上の階層から） */
    get(s, i) {
      bands.ensure(s);
      if (i === s.bandIdx) return bands.snapshot(s);
      const b = s.bands[i];
      if (!b) return null;
      const D = VJ.defaultSettings, out = {};
      for (const k of KEYS) out[k] = clone(b[k] === undefined ? (k === 'setlistText' ? '' : k === 'bandName' ? '' : D[k]) : b[k]);
      return out;
    },

    /** 表示用の名前（セットリストの @band が優先） */
    nameOf(s, i) {
      bands.ensure(s);
      if (!s.bands[i]) return '';
      const p = VJ.setlist.parse(bands.peek(s, i, 'setlistText'));
      return p.band || bands.peek(s, i, 'bandName') || '';
    },

    /** 一覧（パネル・スマホ用） */
    list(s) {
      bands.ensure(s);
      return s.bands.map((_, i) => {
        const p = VJ.setlist.parse(bands.peek(s, i, 'setlistText'));
        return { i, name: p.band || bands.peek(s, i, 'bandName') || '', start: bands.peek(s, i, 'countdownTo') || '', songs: p.songs.length, current: i === s.bandIdx, logo: !!bands.peek(s, i, 'logo') };
      });
    },

    /** i 番目のバンドに切り替える（いまのバンドの値は保存する）。変わったら true */
    select(s, i) {
      bands.ensure(s);
      i = Math.round(+i);
      if (!(i >= 0 && i < s.bands.length) || i === s.bandIdx) return false;
      s.bands[s.bandIdx] = bands.snapshot(s);
      const b = s.bands[i];
      const D = VJ.defaultSettings;
      for (const k of KEYS) s[k] = clone(b[k] === undefined ? (k === 'setlistText' || k === 'bandName' ? '' : D[k]) : b[k]);
      if (!Array.isArray(s.messages) || s.messages.length !== 3) s.messages = ['', '', ''];
      // そのバンドの色（選んであれば）
      if (s.bandPalette >= 0 && s.bandPalette < VJ.palettes.length) s.paletteIdx = s.bandPalette;
      s.bands[i] = {};
      s.bandIdx = i;
      bands.touch();
      return true;
    },

    /** バンドを追加（音楽のタイプなどはいまのバンドに合わせ、名前・セットリスト・ロゴ・テロップは空）。追加した番号 */
    add(s, name) {
      bands.ensure(s);
      if (s.bands.length >= MAX) return -1;
      const cur = bands.snapshot(s);
      s.bands.push({
        bandName: String(name || ''), setlistText: '', logo: '', logoMode: cur.logoMode, profile: cur.profile,
        bandPalette: cur.bandPalette, countdownTo: '', messages: ['', '', ''],
      });
      bands.touch();
      return s.bands.length - 1;
    },

    /** i 番目を消す（最後の 1 組は消さない）。いま出ているバンドを消すときは隣に切り替える */
    remove(s, i) {
      bands.ensure(s);
      if (s.bands.length <= 1 || !(i >= 0 && i < s.bands.length)) return false;
      if (i === s.bandIdx) bands.select(s, i > 0 ? i - 1 : 1);
      s.bands.splice(i, 1);
      if (s.bandIdx > i) s.bandIdx--;
      bands.touch();
      return true;
    },

    /** i 番目を d（-1 / +1）だけ動かす（いま出ているバンドの番号もずらす） */
    move(s, i, d) {
      bands.ensure(s);
      const j = i + d;
      if (!(i >= 0 && i < s.bands.length && j >= 0 && j < s.bands.length)) return false;
      const a = s.bands[i];
      s.bands[i] = s.bands[j];
      s.bands[j] = a;
      if (s.bandIdx === i) s.bandIdx = j;
      else if (s.bandIdx === j) s.bandIdx = i;
      bands.touch();
      return true;
    },
  };

  VJ.bands = bands;
})(globalThis.VJ = globalThis.VJ || {});
