/* 光過敏対策。全画面の明るさが大きく変わる演出（フラッシュ・反転・残像リセット）は
 * すべてこの制限器を通す：1 秒に maxPerSec 回まで、最短 minGap 秒間隔。
 * 参考：NHK・民放連「アニメーション等の映像手法に関するガイドライン」/ WCAG 2.3.1（1 秒に 3 回まで）。
 * 上限は設定（flashLimit）で変えられるが、既定と推奨は 3 回。超える設定にするとパネル・本番前チェックで警告する。 */
(function (/** @type {VJNamespace} */ VJ) {
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

  /**
   * 明るさの点滅を数える（WCAG 2.3.1 の「一般閃光」の近似）。判定は test/helpers/flash.mjs と同じ：
   * 相対輝度が逆向きに 10% 以上変わったら 1 回（暗い側が 0.8 未満のときだけ）、2 回で 1 フラッシュ。
   * テストはフレームの番号で 1 秒を区切るが、重ねた映像のフレームは描画と同じ間隔では来ないので、ここでは時刻で区切る。
   * チャンネルは n 個（画面の領域）と、その平均の 1 個。
   */
  class FlashMeter {
    constructor(n, thr) {
      this.n = n;
      this.thr = thr || 0.1;
      this.reset();
    }
    reset() {
      this.ch = [];
      for (let i = 0; i <= this.n; i++) this.ch.push({ dir: 0, hi: 0, lo: 0, ext: 0, init: false, times: [] });
    }
    /** t（秒）のときの値（長さ n）を足す */
    push(t, values) {
      let sum = 0;
      for (let i = 0; i < this.n; i++) sum += values[i];
      for (let i = 0; i <= this.n; i++) {
        const c = this.ch[i], v = i < this.n ? values[i] : sum / this.n, thr = this.thr;
        if (!c.init) { c.init = true; c.hi = c.lo = c.ext = v; continue; }
        if (c.dir === 0) {
          c.hi = Math.max(c.hi, v); c.lo = Math.min(c.lo, v);
          if (c.hi - v >= thr) { c.dir = -1; c.ext = v; } else if (v - c.lo >= thr) { c.dir = 1; c.ext = v; }
        } else if (c.dir > 0) {
          if (v > c.ext) c.ext = v;
          else if (c.ext - v >= thr) { if (Math.min(c.ext, v) < 0.8) c.times.push(t); c.dir = -1; c.ext = v; }
        } else if (v < c.ext) c.ext = v;
        else if (v - c.ext >= thr) { if (Math.min(c.ext, v) < 0.8) c.times.push(t); c.dir = 1; c.ext = v; }
        while (c.times.length && t - c.times[0] >= 1) c.times.shift();
      }
    }
    /** 直近 1 秒の、逆向きの変化の数（いちばん多いチャンネル。2 回で 1 フラッシュ） */
    transitions() {
      let m = 0;
      for (const c of this.ch) m = Math.max(m, c.times.length);
      return m;
    }
  }

  /**
   * 重ねた映像（動画ファイル・画面の取り込み・カメラ）の点滅の見張り。シーンの光は FlashLimiter で制限しているが、
   * 映像の中の点滅は制限できないので、点滅が上限に近づいたら映像の濃さを下げる。
   *   push(t, lum, alpha)：新しいフレームの領域ごとの相対輝度（映像そのもの。0..1）と、そのときの濃さ。
   *                        濃さを掛けた値で数える（薄く重ねている映像を、濃いものと同じに数えない）
   *   gain(dt)：映像の濃さに掛ける値（1 = そのまま）。下げるときは速く（光の変化を続けさせない）、戻すときは 2 秒かけて
   * 下げる量は、直近 1 秒の明るさの揺れ幅が判定の 10% を下回るところまで。数えるのは下げる前の値なので、下げたことで
   * 数が減って戻り、また下げる、とはならない。
   */
  class OverlayGuard {
    constructor(regions) {
      this.n = regions || 12;
      this.meter = new FlashMeter(this.n);
      this.limit = SAFE;
      this.noFlash = false;
      this.g = 1;
      this.target = 1;
      this.hist = []; // [t, 値（長さ n + 1）]：揺れ幅を見る
      this.alerts = 0; // 下げた回数（記録用）
      this.strong = false; // 「制限なし」のときに、強い点滅があった（下げずに知らせるだけ）
      this.lastT = -1;
    }
    /** フラッシュの上限（設定 flashLimit。0 = 制限なし）と「フラッシュを一切使わない」 */
    setLimit(n, noFlash) {
      this.limit = Math.max(0, Math.round(+n || 0));
      this.noFlash = !!noFlash;
    }
    reset() {
      this.meter.reset();
      this.hist.length = 0;
      this.target = 1;
      this.strong = false;
      this.lastT = -1;
    }
    push(t, lum, alpha) {
      if (t <= this.lastT) return;
      this.lastT = t;
      const a = Math.max(0, Math.min(1, +alpha || 0));
      const v = new Array(this.n + 1);
      let sum = 0;
      for (let i = 0; i < this.n; i++) { v[i] = lum[i] * a; sum += v[i]; }
      v[this.n] = sum / this.n;
      this.meter.push(t, v);
      this.hist.push([t, v]);
      while (this.hist.length && t - this.hist[0][0] > 1) this.hist.shift();
      const tr = this.meter.transitions();
      const unlimited = this.limit === 0 && !this.noFlash;
      // 上限の 1 つ手前（「一切使わない」なら 1 回目）で下げる。「制限なし」のときは下げずに知らせるだけ
      const lim = this.noFlash ? 1 : unlimited ? SAFE : this.limit;
      const danger = tr >= Math.max(2, 2 * lim - 2);
      if (unlimited) { this.strong = danger; this.target = 1; return; }
      if (danger) {
        let swing = 0;
        for (let i = 0; i <= this.n; i++) {
          let lo = Infinity, hi = -Infinity;
          for (const [, h] of this.hist) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
          swing = Math.max(swing, hi - lo);
        }
        const k = (this.noFlash ? 0.04 : 0.08) / Math.max(swing, 1e-3);
        const tgt = Math.max(0, Math.min(1, k));
        if (tgt < this.target - 0.01 && this.target > 0.99) this.alerts++;
        this.target = Math.min(this.target, tgt);
      } else this.target = 1;
    }
    gain(dt) {
      dt = Math.max(0, Math.min(0.1, +dt || 0));
      if (this.g > this.target) this.g = Math.max(this.target, this.g - dt / 0.05);
      else this.g = Math.min(this.target, this.g + dt / 2);
      return this.g;
    }
    /** 'dim'（下げている）/ 'strong'（制限なしで強い点滅）/ '' */
    state() { return this.g < 0.99 ? 'dim' : this.strong ? 'strong' : ''; }
  }

  VJ.safety = { FlashLimiter, safeFlashColor, limitConfig, overSafe, SAFE, FlashMeter, OverlayGuard };
})(globalThis.VJ = globalThis.VJ || {});
