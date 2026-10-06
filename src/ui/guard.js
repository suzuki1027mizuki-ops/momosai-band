/* 本番の事故防止：スリープ防止・全画面・Esc の取り込み・離脱確認・カーソル非表示・右クリック無効。 */
(function (VJ) {
  'use strict';

  const guard = {
    showing: false,
    wakeLock: null,
    wakeLockOk: false,
    kbLockOk: false,

    install() {
      // 2 秒動かさなければカーソルを隠す
      let timer = null;
      const wake = () => {
        document.body.classList.remove('nocursor');
        clearTimeout(timer);
        timer = setTimeout(() => document.body.classList.add('nocursor'), 2000);
      };
      window.addEventListener('mousemove', wake, { passive: true });
      wake();
      document.addEventListener('contextmenu', (e) => { if (!e.target.closest || !e.target.closest('#panel')) e.preventDefault(); });
      document.getElementById('stage').addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
      window.addEventListener('beforeunload', (e) => {
        if (!guard.showing) return undefined;
        e.preventDefault();
        e.returnValue = '';
        return '';
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && guard.showing) guard.requestWakeLock();
      });
      document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) guard.lockKeys();
      });
    },

    async requestWakeLock() {
      try {
        if (!navigator.wakeLock) return false;
        guard.wakeLock = await navigator.wakeLock.request('screen');
        guard.wakeLockOk = true;
        guard.wakeLock.addEventListener('release', () => { guard.wakeLockOk = false; });
        return true;
      } catch (e) {
        guard.wakeLockOk = false;
        return false;
      }
    },

    async lockKeys() {
      try {
        if (navigator.keyboard && navigator.keyboard.lock) {
          await navigator.keyboard.lock(['Escape']);
          guard.kbLockOk = true;
        }
      } catch (e) {
        guard.kbLockOk = false;
      }
    },

    async enterFullscreen() {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await guard.lockKeys();
        return true;
      } catch (e) {
        return false;
      }
    },

    async startShow() {
      guard.showing = true;
      await guard.enterFullscreen();
      await guard.requestWakeLock();
    },
  };

  VJ.guard = guard;
})(globalThis.VJ = globalThis.VJ || {});
