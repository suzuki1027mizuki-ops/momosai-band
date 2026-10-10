/* メディアの保存（オーバーレイの動画ファイルなど、設定に入れるには大きいもの）。
 * IndexedDB に保存して、再読み込み・出力ウィンドウ（同じ保存場所）からも読めるようにする。
 * IndexedDB が使えない環境（プライベートモードなど）では、このウィンドウのメモリにだけ置く
 * （2 画面のときは link.js が出力ウィンドウへ直接渡す）。 */
(function (VJ) {
  'use strict';

  const DB = 'momosai-vj-media', STORE = 'blobs';
  const mem = new Map();
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        if (!globalThis.indexedDB) { resolve(null); return; }
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE); };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
        rq.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve) => {
      if (!db) { resolve(undefined); return; }
      try {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(rq ? rq.result : true);
        t.onerror = () => resolve(undefined);
        t.onabort = () => resolve(undefined);
      } catch (e) {
        resolve(undefined);
      }
    }));
  }

  const mediaStore = {
    /** 新しい鍵（日時 + 乱数） */
    newKey() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    /** blob を保存。IndexedDB に入ったら true（メモリには必ず置く） */
    async put(key, blob) {
      mem.set(key, blob);
      return (await tx('readwrite', (st) => st.put(blob, key))) === true;
    },
    /** このウィンドウのメモリにだけ置く（2 画面のとき、操作ウィンドウから受け取った分） */
    hold(key, blob) { mem.set(key, blob); },
    async get(key) {
      if (!key) return null;
      if (mem.has(key)) return mem.get(key);
      const b = await tx('readonly', (st) => st.get(key));
      if (b instanceof Blob) { mem.set(key, b); return b; }
      return null;
    },
    /** 1 つ消す（動画を入れ替えた・一覧から消したとき。ほかで使っていないかは呼ぶ側が確かめる。
     *  まとめて「使っていないものを全部消す」はしない：保存の途中のもの・読み込む前の設定ファイルが使っていたものまで消えるので） */
    async remove(key) {
      if (!key) return;
      mem.delete(key);
      await tx('readwrite', (st) => st.delete(key));
    },
  };

  VJ.mediaStore = mediaStore;
})(globalThis.VJ = globalThis.VJ || {});
