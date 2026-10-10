/* メディアの一覧（曲ごとのメディア・キューで使う）。DOM は使わない（単体テストから呼べる）。
 * 1 件 = { id, name, kind: image / video / web / camera, key（画像・動画の中身。mediastore.js の鍵）, url（YouTube / ニコニコ）,
 *          cameraId（カメラ）, mirror（カメラの左右反転） }。中身（画像・動画）は大きいので設定には入れず、鍵だけを持つ。
 * セットリストでは「m:名前」「m:3」（一覧の 3 番目）「m:off」（その曲はメディアを出さない）で指定する。 */
(function (VJ) {
  'use strict';

  const KINDS = ['image', 'video', 'web', 'camera'];
  const MAX = 40;

  /** 1 件の形を確かめる（壊れた設定ファイル・古い版でも動くように）。使えなければ null */
  function clean(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const kind = KINDS.includes(x.kind) ? x.kind : null;
    const id = typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id) ? x.id : null;
    if (!kind || !id) return null;
    const out = { id, name: String(typeof x.name === 'string' ? x.name : '').slice(0, 60), kind };
    if (kind === 'image' || kind === 'video') {
      if (typeof x.key !== 'string' || !/^[\w-]{1,64}$/.test(x.key)) return null;
      out.key = x.key;
    }
    if (kind === 'web') {
      if (typeof x.url !== 'string' || !/^https:\/\//.test(x.url)) return null;
      out.url = x.url.slice(0, 500);
    }
    if (kind === 'camera') {
      out.cameraId = typeof x.cameraId === 'string' ? x.cameraId.slice(0, 200) : '';
      out.mirror = !!x.mirror;
    }
    return out;
  }

  const mediaLib = {
    KINDS,
    MAX,
    clean,
    newId() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    list(s) { return Array.isArray(s && s.mediaLib) ? s.mediaLib : []; },
    byId(s, id) { return id ? mediaLib.list(s).find((x) => x.id === id) || null : null; },
    /** セットリストの「m:…」の指定 → 一覧の 1 件。番号（1 から）・名前（大文字小文字・前後の空白は無視）・id。'off' は { off: true } */
    find(s, token) {
      const t = String(token || '').trim();
      if (!t) return null;
      if (/^(off|none|なし)$/i.test(t)) return { off: true };
      const list = mediaLib.list(s);
      if (/^\d{1,3}$/.test(t)) return list[+t - 1] || null;
      const low = t.toLowerCase();
      return list.find((x) => x.name.trim().toLowerCase() === low) || list.find((x) => x.id === t) || null;
    },
    /** 表示用の番号（m1, m2 …） */
    label(s, id) {
      const i = mediaLib.list(s).findIndex((x) => x.id === id);
      return i < 0 ? '' : 'm' + (i + 1);
    },
    /** 画像・動画の中身の鍵（保存場所の掃除で残すもの） */
    keys(s) { return mediaLib.list(s).map((x) => x.key).filter(Boolean); },
    /** セットリストに書く指定。ふつうは名前。名前が空・数字だけ・off・ほかと同じ・「|」入りのときは番号 */
    token(s, id) {
      const list = mediaLib.list(s), i = list.findIndex((x) => x.id === id);
      if (i < 0) return '';
      const n = list[i].name.trim(), low = n.toLowerCase();
      const ok = n && !/^\d{1,3}$/.test(n) && !/^(off|none|なし)$/i.test(n) && !/[|｜￨│\r\n]/.test(n)
        && list.filter((x) => x.name.trim().toLowerCase() === low).length === 1;
      return ok ? n : String(i + 1);
    },
    /** ほかと重ならない名前（「画像」がもうあれば「画像 2」） */
    uniqueName(s, base, exceptId) {
      const b = String(base || '').trim().slice(0, 56) || 'media';
      const used = new Set(mediaLib.list(s).filter((x) => x.id !== exceptId).map((x) => x.name.trim().toLowerCase()));
      if (!used.has(b.toLowerCase())) return b;
      for (let k = 2; ; k++) if (!used.has(`${b} ${k}`.toLowerCase())) return `${b} ${k}`;
    },
    /** セットリストの文字の中の「m:古い名前」を「m:新しい名前」に（名前を変えたとき。ほかの行・指定はそのまま） */
    renameRefs(text, from, to) {
      const f = String(from || '').trim().toLowerCase();
      if (!f || !to) return text;
      return String(text || '').replace(/([|｜￨│][ \t　]*(?:m|media|メディア)[ \t　]*[:：][ \t　]*)([^|｜￨│\r\n]*?)(?=[ \t　]*(?:[|｜￨│]|\r?$))/gim,
        (all, head, name) => (name.trim().toLowerCase() === f ? head + to : all));
    },
  };

  VJ.mediaLib = mediaLib;
})(globalThis.VJ = globalThis.VJ || {});
