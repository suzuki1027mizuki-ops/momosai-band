/* ブラウザの違いの吸収（Chrome / Edge を基準に、Firefox・Safari でも動くように）。
 * 無い機能は使わずに済ませ、パネルに「このブラウザでは使えない機能」として出す。 */
(function (VJ) {
  'use strict';

  const ua = (globalThis.navigator && navigator.userAgent) || '';
  const browser = /Firefox\//.test(ua) ? 'firefox'
    : /Edg\//.test(ua) || /Chrome\/|Chromium\//.test(ua) ? 'chromium'
    : /Safari\//.test(ua) ? 'safari' : 'other';

  const compat = {
    browser,
    get name() { return { chromium: 'Chrome / Edge', firefox: 'Firefox', safari: 'Safari', other: VJ.t('このブラウザ') }[browser]; },

    /** 機能ごとの有無 */
    features() {
      const nav = globalThis.navigator || {};
      const md = nav.mediaDevices || {};
      const doc = globalThis.document || {};
      const el = doc.documentElement || {};
      return {
        audio: !!(globalThis.AudioContext || globalThis.webkitAudioContext),
        mic: !!md.getUserMedia,
        // 画面共有で音も取れるのは Chromium 系だけ（Firefox・Safari は映像だけ）
        displayAudio: !!md.getDisplayMedia && browser === 'chromium',
        midi: !!nav.requestMIDIAccess,
        serial: !!nav.serial,
        wakeLock: !!nav.wakeLock,
        keyboardLock: !!(nav.keyboard && nav.keyboard.lock),
        screenDetails: typeof globalThis.getScreenDetails === 'function',
        fullscreen: !!(el.requestFullscreen || el.webkitRequestFullscreen),
      };
    },

    /** 使えない機能の説明（パネルの注意書き用） */
    missing() {
      const f = compat.features();
      const out = [];
      if (!f.audio || !f.mic) out.push('音声入力（マイク）');
      if (!f.displayAudio) out.push('PC で再生中の音の取り込み');
      if (!f.midi) out.push('MIDI コントローラ');
      if (!f.serial) out.push('USB-DMX（照明）');
      if (!f.wakeLock) out.push('画面のスリープ防止');
      if (!f.keyboardLock) out.push('全画面中の Esc の取り込み');
      if (!f.screenDetails) out.push('出力ウィンドウをプロジェクター側へ自動で移す');
      if (!f.fullscreen) out.push('全画面');
      return out.map((x) => VJ.t(x));
    },

    fullscreenElement() {
      const d = globalThis.document;
      return d ? d.fullscreenElement || d.webkitFullscreenElement || null : null;
    },

    async requestFullscreen(el) {
      if (el.requestFullscreen) return el.requestFullscreen({ navigationUI: 'hide' });
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
      throw new Error(VJ.t('全画面にできません'));
    },

    onFullscreenChange(fn) {
      document.addEventListener('fullscreenchange', fn);
      document.addEventListener('webkitfullscreenchange', fn);
    },
  };

  VJ.compat = compat;
})(globalThis.VJ = globalThis.VJ || {});
