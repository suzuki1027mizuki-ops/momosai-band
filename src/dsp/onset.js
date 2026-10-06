/* 帯域ごとの立ち上がり（オンセット）検出。
 * 128 サンプル（約 2.7ms）ごとに：
 *   S    = 直近 W ホップの平均エネルギー（dB）
 *   ref  = L〜L+R ホップ前の S の最大値（低音の周期的な脈動やトレモロを無視するため最大値）
 *   flux = max(0, S - ref)                 … dB の上昇量
 *   thr  = μ + K·sens·σ + minRise           … μ,σ は flux の指数移動平均（過去のみ）
 * flux > thr かつゲート通過かつ不応期外かつ armed で発火。flux < thr/2 で再び armed。 */
(function (VJ) {
  'use strict';
  const { coef, powToDb } = VJ.util;

  class OnsetDetector {
    constructor(p, hopSec, statTau) {
      this.p = p;
      this.hopSec = hopSec;
      this.W = Math.max(1, p.W | 0);
      this.size = p.L + p.R + 1;
      this.eRing = new Float64Array(this.W);
      this.sRing = new Float64Array(this.size);
      this.a = coef(statTau, hopSec);
      this.refHops = Math.max(1, Math.round(p.refractory / hopSec));
      this.reset();
    }

    reset() {
      this.eRing.fill(0);
      this.eIdx = 0;
      this.eSum = 0;
      this.eFill = 0;
      this.sRing.fill(-200);
      this.sIdx = 0;
      this.sFill = 0;
      this.mu = 0.5;
      this.va = 4;
      this.armed = true;
      this.sinceFire = 1e9;
      this.thrAtFire = 0;
      this.sigmaAtFire = 1;
      this.peakStrength = 0;
      this.S = -200;
      this.flux = 0;
      this.z = 0;
      this.gateOpen = false;
      this.mute = 0;
      this.peakDb = -200;
    }

    /** ギャップ後などに統計以外を作り直す（誤発火防止のため mute ホップ数だけ発火しない） */
    resync(muteHops) {
      const mu = this.mu, va = this.va;
      this.reset();
      this.mu = mu; this.va = va;
      this.mute = muteHops | 0;
    }

    /**
     * 1 ホップ分を処理。
     * @param e     このホップの平均二乗エネルギー
     * @param gateDb S がこれを超えていないと発火しない（ノイズフロア + 余裕）
     * @param sens  K に掛ける倍率（小さいほど敏感）
     * @returns 発火したら強さ(0.4..1)、しなければ 0
     */
    step(e, gateDb, sens) {
      const p = this.p;
      // 直近 W ホップの平均
      this.eSum += e - this.eRing[this.eIdx];
      this.eRing[this.eIdx] = e;
      this.eIdx = (this.eIdx + 1) % this.W;
      if (this.eFill < this.W) this.eFill++;
      const S = powToDb(Math.max(0, this.eSum) / this.eFill);
      this.S = S;

      // L〜L+R ホップ前の最大値
      this.sRing[this.sIdx] = S;
      this.sIdx = (this.sIdx + 1) % this.size;
      if (this.sFill < this.size) this.sFill++;
      let ref = S;
      if (this.sFill >= this.size) {
        ref = -200;
        // sIdx は「最も古い」位置。古い順に R+1 個 = L〜L+R ホップ前
        for (let k = 0; k <= p.R; k++) {
          const v = this.sRing[(this.sIdx + k) % this.size];
          if (v > ref) ref = v;
        }
      }
      const flux = S > ref ? S - ref : 0;
      this.flux = flux;

      // 過去の統計でしきい値（現在値で自分のしきい値を上げないため、更新は後）
      const sigma = Math.sqrt(this.va);
      const thr = this.mu + p.K * sens * sigma + p.minRise;
      this.z = (flux - this.mu) / (sigma + 1e-6);
      // 統計は「オンセットでない揺れ」を学習したいので、しきい値で切り詰めてから更新（ウィンソライズ）。
      // そうしないと大きなヒット自体で σ が膨らみ、2 打目以降の弱いヒットを取りこぼす。
      const xs = flux < thr ? flux : thr;
      const d = xs - this.mu;
      this.mu += this.a * d;
      this.va += this.a * (d * d - this.va);
      if (this.va < 0.25) this.va = 0.25;

      this.gateOpen = S > gateDb;
      this.sinceFire++;

      // 相対レベルゲート：この帯域の最近のピークより relDb 以上小さい立ち上がりは無視
      // （ハイハットの漏れでスネアが、ベースの発音でキックが反応するのを防ぐ）
      this.rel = S - this.peakDb; // 最近のピークとの差（dB、負なら小さい）
      const loudEnough = S >= this.peakDb - (p.relDb || 99);
      if (S > this.peakDb) this.peakDb = S;
      else this.peakDb = Math.max(S, this.peakDb - (p.peakFall || 4) * this.hopSec);

      let fired = 0;
      if (this.mute > 0) {
        this.mute--;
      } else if (this.armed && flux > thr && this.gateOpen && loudEnough && this.sinceFire >= this.refHops) {
        fired = this._strength(flux, thr, sigma);
        this.armed = false;
        this.sinceFire = 0;
        this.thrAtFire = thr;
        this.sigmaAtFire = sigma;
        this.peakStrength = fired;
      }
      if (!this.armed && flux < 0.5 * thr) this.armed = true;

      // 発火直後の数ホップは flux がまだ上がることがあるので強さを追従（見た目の強さ用）
      this.strengthUpdate = 0;
      if (!fired && this.sinceFire <= 4) {
        const s = this._strength(flux, this.thrAtFire, this.sigmaAtFire);
        if (s > this.peakStrength) { this.peakStrength = s; this.strengthUpdate = s; }
      }
      return fired;
    }

    _strength(flux, thr, sigma) {
      const s = (flux - thr) / (2 * sigma + 3) + 0.4;
      return s < 0.4 ? 0.4 : s > 1 ? 1 : s;
    }
  }

  VJ.dsp = VJ.dsp || {};
  VJ.dsp.OnsetDetector = OnsetDetector;
})(globalThis.VJ = globalThis.VJ || {});
