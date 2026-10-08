/* 光過敏対策。全画面の明るさが大きく変わる演出（フラッシュ・反転・残像リセット）は
 * すべてこの制限器を通す：1 秒に maxPerSec 回まで、最短 minGap 秒間隔。
 * 参考：NHK・民放連「アニメーション等の映像手法に関するガイドライン」/ WCAG 2.3.1（1 秒に 3 回まで）。
 * 上限は設定（flashLimit）で変えられるが、既定と推奨は 3 回。超える設定にするとパネル・本番前チェックで警告する。 */
(function (VJ) {
  'use strict';

  const SAFE = 3; // ガイドラインの上限（1 秒あたり）

  /** 1 秒あたりの上限 n（0 = 制限なし）から制限器の設定を作る。3 回までは最短間隔 0.2 秒（既定と同じ） */
  function limitConfig(n) {
    n = Math.round(+n);
    if (!isFinite(n) || n < 0) n = SAFE;
    if (n === 0) return { maxPerSec: Infinity, minGap: 0 };
    return { maxPerSec: n, minGap: n <= SAFE ? VJ.flashConfig.minGap : 0.6 / n };
  }

  class FlashLimiter {
    constructor(cfg) {
      this.cfg = Object.assign({}, VJ.flashConfig, cfg || {});
      this.times = [];
      this.denied = 0;
    }
    /** 1 秒あたりの上限を変える（0 = 制限なし） */
    setLimit(n) { Object.assign(this.cfg, limitConfig(n)); }
    /** 光と光の最短間隔（秒。照明のチェイスも同じ間隔にそろえる） */
    gap() { return isFinite(this.cfg.maxPerSec) ? 1 / this.cfg.maxPerSec : 0; }
    /** now（秒）に光らせてよいか。よければ記録して true。
     *  reserve：上限のうちこの回数分は残しておく（拍ごとの軽いフラッシュがキメの分を使い切らないように） */
    allow(now, reserve) {
      const t = this.times;
      // 同じフレーム（同じ時刻）の演出は 1 回の明滅として扱う（自動フラッシュ＋反転 など）
      if (t.length && t[t.length - 1] === now) return true;
      while (t.length && now - t[0] >= 1.0) t.shift();
      if (t.length >= this.cfg.maxPerSec - (reserve || 0) || (t.length && now - t[t.length - 1] < this.cfg.minGap)) {
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

  /** 設定の上限が推奨（1 秒に 3 回）を超えているか */
  const overSafe = (n) => Math.round(+n) === 0 || Math.round(+n) > SAFE;

  VJ.safety = { FlashLimiter, safeFlashColor, limitConfig, overSafe, SAFE };
})(globalThis.VJ = globalThis.VJ || {});
