/* 光過敏対策。全画面の明るさが大きく変わる演出（フラッシュ・反転・残像リセット）は
 * すべてこの制限器を通す：1 秒に maxPerSec 回まで、最短 minGap 秒間隔。
 * 参考：NHK・民放連「アニメーション等の映像手法に関するガイドライン」/ WCAG 2.3.1（1 秒に 3 回まで）。 */
(function (VJ) {
  'use strict';

  class FlashLimiter {
    constructor(cfg) {
      this.cfg = Object.assign({}, VJ.flashConfig, cfg || {});
      this.times = [];
      this.denied = 0;
    }
    /** now（秒）に光らせてよいか。よければ記録して true */
    allow(now) {
      const t = this.times;
      // 同じフレーム（同じ時刻）の演出は 1 回の明滅として扱う（自動フラッシュ＋反転 など）
      if (t.length && t[t.length - 1] === now) return true;
      while (t.length && now - t[0] >= 1.0) t.shift();
      if (t.length >= this.cfg.maxPerSec || (t.length && now - t[t.length - 1] < this.cfg.minGap)) {
        this.denied++;
        return false;
      }
      t.push(now);
      return true;
    }
    reset() { this.times.length = 0; }
  }

  /** フラッシュ色：鮮やかな赤系は白に置き換える（赤の点滅は特に危険とされるため） */
  function safeFlashColor(rgb) {
    const [h, s] = VJ.util.rgbToHsv(rgb[0], rgb[1], rgb[2]);
    if (s > 0.5 && (h < 0.07 || h > 0.9)) return [1, 1, 1];
    return rgb;
  }

  VJ.safety = { FlashLimiter, safeFlashColor };
})(globalThis.VJ = globalThis.VJ || {});
