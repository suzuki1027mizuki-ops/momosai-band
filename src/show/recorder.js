/* 本番の記録：1 秒ごとの状態と、出来事（操作・シーン・曲・入力の切断と再接続・例外）。音・映像そのものは記録しない。
 * 解析しているウィンドウ（1 画面ならこの画面、2 画面なら出力ウィンドウ）で動く。毎フレームは数を足すだけで、
 * 1 秒ごとに 1 行にまとめる。保存（logStore）は 1 分ごとに、その 1 分の分だけを IndexedDB に足す（全体を毎回書くと、
 * 設定の保存と同じく描画が引っかかるため）。保存先はメディアとは別のデータベース（momosai-vj-log）。
 * 書き出しは CSV（表計算ソフトで開ける。出来事は同じ秒の行の最後の欄に）。曲名・バンド名・入力の名前は記録に入る。 */
(function (/** @type {VJNamespace} */ VJ) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  /** 時刻（ミリ秒）→ 'YYYY-MM-DD'（この PC の時刻で） */
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const timeOf = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const db = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : '');

  // 列（キー, 見出し）。見出しは書き出すときに訳す
  const COLS = [
    ['time', '時刻'], ['input', '入力'], ['levelL', '音量 L（dB）'], ['levelR', '音量 R（dB）'],
    ['kick', 'キック'], ['snare', 'スネア'], ['hat', 'ハイハット'], ['accent', 'キメ'],
    ['bpm', 'BPM'], ['beatConf', 'テンポの確度'], ['speech', '話し声'], ['melodic', 'ドラムの無い曲'],
    ['fps', '描画 fps'], ['maxFrame', '最長のフレーム（ms）'], ['scale', '描画の倍率'], ['denied', 'フラッシュの却下'],
    ['errors', '例外'], ['scene', 'シーン'], ['song', '曲'], ['media', 'メディア'], ['guard', '映像の点滅の見張り'], ['events', '出来事'],
  ];

  class Recorder {
    constructor(opts) {
      this.opts = Object.assign({ keepRows: 3 * 3600 }, opts || {});
      this.rows = []; // 1 秒ごとの行（メモリ。保存した分も、しばらくは持つ）
      this.saved = 0; // rows のうち保存した数
      this.cur = null; // いまの秒
      this.pendingEvents = [];
      this.errors = 0;
    }

    /** 毎フレーム。now：時刻（ミリ秒、Date.now()）、frameMs：前のフレームからの時間、s：いまの状態
     *  s = { input, meter: { l, r }, flags（onsetFlags）, bpm, beatConf, speech, melodic, scale, denied（フラッシュの却下の累計）, scene, song, media, guard } */
    frame(now, frameMs, s) {
      const sec = Math.floor(now / 1000);
      if (!this.cur || this.cur.sec !== sec) this._next(sec, s);
      const c = this.cur;
      c.frames++;
      if (frameMs > c.maxFrame) c.maxFrame = frameMs;
      const fl = s.flags | 0;
      if (fl & 1) c.kick++;
      if (fl & 2) c.snare++;
      if (fl & 4) c.hat++;
      if (fl & 8) c.accent++;
      c.last = s;
    }

    /** 出来事（操作・シーン・曲・入力の状態など）。いまの秒の行に入る */
    event(now, text) {
      const t = String(text || '').replace(/[\r\n,]+/g, ' ').trim().slice(0, 200);
      if (!t) return;
      if (this.cur && this.cur.sec === Math.floor(now / 1000)) this.cur.events.push(t);
      else this.pendingEvents.push([now, t]);
    }

    /** 例外（数と、出来事としてメッセージ） */
    error(now, msg) {
      this.errors++;
      if (this.cur) this.cur.errors++;
      this.event(now, VJ.t ? VJ.t('例外：{0}', String(msg || '')) : 'error: ' + msg);
    }

    _next(sec, s) {
      if (this.cur) this.rows.push(this._row(this.cur));
      this.cur = { sec, frames: 0, maxFrame: 0, kick: 0, snare: 0, hat: 0, accent: 0, errors: 0, events: [], denied0: s ? s.denied | 0 : 0, last: s };
      // 前の秒の終わりに来た出来事（フレームの合間）は、この秒に入れる
      for (const [, t] of this.pendingEvents) this.cur.events.push(t);
      this.pendingEvents.length = 0;
      // 古い行は捨てる（保存した分だけ）
      const over = this.rows.length - this.opts.keepRows;
      if (over > 0 && this.saved >= over) { this.rows.splice(0, over); this.saved -= over; }
    }

    _row(c) {
      const s = c.last || {};
      const m = s.meter || {};
      return {
        t: c.sec * 1000, input: s.input || '', levelL: db(m.l), levelR: db(m.r),
        kick: c.kick, snare: c.snare, hat: c.hat, accent: c.accent,
        bpm: s.bpm ? Math.round(s.bpm) : '', beatConf: typeof s.beatConf === 'number' ? Math.round(s.beatConf * 100) / 100 : '',
        speech: s.speech ? 1 : 0, melodic: s.melodic ? 1 : 0,
        fps: c.frames, maxFrame: Math.round(c.maxFrame), scale: typeof s.scale === 'number' ? Math.round(s.scale * 100) / 100 : '',
        denied: Math.max(0, (s.denied | 0) - c.denied0), errors: c.errors,
        scene: s.scene || '', song: s.song || '', media: s.media || '', guard: s.guard || '', events: c.events.join(' / '),
      };
    }

    /** まだ保存していない行（いまの秒は含めない）を取り出して、保存したことにする */
    takeUnsaved() {
      const out = this.rows.slice(this.saved);
      this.saved = this.rows.length;
      return out;
    }

    /** いま持っている行（いまの秒も、途中までの行として） */
    snapshot() { return this.cur ? this.rows.concat([this._row(this.cur)]) : this.rows.slice(); }
  }

  /** 行 → CSV（BOM 付き UTF-8：Excel で日本語が化けないように）。見出しは今の言語で */
  function toCSV(rows) {
    const t = VJ.t || ((x) => x);
    const cell = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [COLS.map(([, h]) => cell(t(h))).join(',')];
    for (const r of rows) lines.push(COLS.map(([k]) => cell(k === 'time' ? `${dayOf(r.t)} ${timeOf(r.t)}` : r[k])).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** 保存（IndexedDB）。使えない環境では何もしない（記録はメモリだけ） */
  const logStore = {
    DB: 'momosai-vj-log',
    STORE: 'minutes',
    KEEP_DAYS: 7,
    _db: null,
    ok: true,
    open() {
      if (logStore._db) return logStore._db;
      logStore._db = new Promise((resolve) => {
        try {
          if (!globalThis.indexedDB) { logStore.ok = false; resolve(null); return; }
          const rq = indexedDB.open(logStore.DB, 1);
          rq.onupgradeneeded = () => { rq.result.createObjectStore(logStore.STORE); };
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => { logStore.ok = false; resolve(null); };
          rq.onblocked = () => { logStore.ok = false; resolve(null); };
        } catch (e) { logStore.ok = false; resolve(null); }
      });
      return logStore._db;
    },
    async _tx(mode, fn) {
      const d = await logStore.open();
      if (!d) return undefined;
      return new Promise((resolve) => {
        try {
          const tx = d.transaction(logStore.STORE, mode);
          const out = fn(tx.objectStore(logStore.STORE));
          tx.oncomplete = () => resolve(out && 'result' in out ? out.result : true);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
      });
    },
    /** 行を足す（日付ごと。キーは 'YYYY-MM-DD|最初の行の時刻'） */
    async append(rows) {
      if (!rows.length) return true;
      const byDay = new Map();
      for (const r of rows) { const d = dayOf(r.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
      let ok = true;
      for (const [d, list] of byDay) {
        const r = await logStore._tx('readwrite', (st) => st.put(list, `${d}|${String(list[0].t).padStart(15, '0')}`));
        if (r === undefined) ok = false;
      }
      return ok;
    },
    /** その日の行（時刻の順） */
    async readDay(day) {
      const r = await logStore._tx('readonly', (st) => st.getAll(IDBKeyRange.bound(day + '|', day + '|~')));
      return Array.isArray(r) ? r.flat() : [];
    },
    /** 記録のある日（新しい順） */
    async days() {
      const keys = await logStore._tx('readonly', (st) => st.getAllKeys());
      return Array.isArray(keys) ? [...new Set(keys.map((k) => String(k).split('|')[0]))].sort().reverse() : [];
    },
    /** 古い日の記録を消す（KEEP_DAYS 日分を残す） */
    async prune(now) {
      const keep = new Set();
      for (let i = 0; i < logStore.KEEP_DAYS; i++) keep.add(dayOf(now - i * 86400000));
      const keys = await logStore._tx('readonly', (st) => st.getAllKeys());
      if (!Array.isArray(keys)) return;
      const old = keys.filter((k) => !keep.has(String(k).split('|')[0]));
      if (old.length) await logStore._tx('readwrite', (st) => { for (const k of old) st.delete(k); });
    },
  };

  VJ.Recorder = Recorder;
  VJ.recorder = { Recorder, toCSV, logStore, dayOf, timeOf, COLS };
})(globalThis.VJ = globalThis.VJ || {});
