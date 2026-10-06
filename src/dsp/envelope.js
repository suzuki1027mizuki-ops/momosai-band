/* 包絡線・自動正規化・ノイズフロア追従。すべて「過去だけ」を見るので追加の遅延はゼロ。 */
(function (VJ) {
  'use strict';
  const { coef } = VJ.util;

  /** 入力レベル（dB）の自動正規化。ゲート外（無音）では基準を凍結する。 */
  class AutoGain {
    constructor(cfg, dt) {
      this.cfg = cfg;
      this.dt = dt;
      this.reset();
      this.cAtk = coef(cfg.attack, dt);
      this.cRel = coef(cfg.release, dt);
      this.cWarm = coef(cfg.warmRelease, dt);
    }
    reset() {
      this.ref = this.cfg.initDb;
      this.activeTime = 0;
    }
    update(db, active, floorDb) {
      if (!active) return;
      this.activeTime += this.dt;
      if (db > this.ref) this.ref += (db - this.ref) * this.cAtk;
      else this.ref += (db - this.ref) * (this.activeTime < this.cfg.warmSec ? this.cWarm : this.cRel);
      const lo = floorDb + this.cfg.floorMarginDb;
      if (this.ref < lo) this.ref = lo;
    }
    /** dB → 0..1（基準 = 1、rangeDb 下 = 0） */
    norm(db) {
      const v = 1 + (db - this.ref) / this.cfg.rangeDb;
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  /** ノイズフロア（最小値追従：下がるのは速く、上がるのは遅く）。上限は基準 - cap。 */
  class NoiseFloor {
    constructor(cfg, dt) {
      this.cfg = cfg;
      this.cRise = coef(cfg.rise, dt);
      this.cFall = coef(cfg.fall, dt);
      this.reset();
    }
    reset() { this.db = NaN; }
    update(db, refDb) {
      if (Number.isNaN(this.db)) this.db = db;
      else if (db < this.db) this.db += (db - this.db) * this.cFall;
      else this.db += (db - this.db) * this.cRise;
      const cap = refDb - this.cfg.capBelowRefDb;
      if (this.db > cap) this.db = cap;
      if (this.db < -140) this.db = -140;
      return this.db;
    }
  }

  /** 立ち上がり即時・減衰だけ指数平滑（tau 秒） */
  class Follower {
    constructor(tau, dt) { this.k = Math.exp(-dt / tau); this.v = 0; }
    update(x) {
      const d = this.v * this.k;
      this.v = x > d ? x : d;
      return this.v;
    }
    reset() { this.v = 0; }
  }

  /** 1 次ローパス（dB や線形値の平滑化用） */
  class Smoother {
    constructor(tau, dt, init) { this.c = coef(tau, dt); this.v = init || 0; this.init = init || 0; }
    update(x) { this.v += (x - this.v) * this.c; return this.v; }
    reset() { this.v = this.init; }
  }

  /** 最大値追従（上がるのは即時、下がるのは tau 秒で） */
  class PeakHold {
    constructor(tau, dt, init) { this.c = coef(tau, dt); this.v = init; this.init = init; }
    update(x) {
      if (x > this.v) this.v = x;
      else this.v += (x - this.v) * this.c;
      return this.v;
    }
    reset() { this.v = this.init; }
  }

  VJ.dsp = VJ.dsp || {};
  Object.assign(VJ.dsp, { AutoGain, NoiseFloor, Follower, Smoother, PeakHold });
})(globalThis.VJ = globalThis.VJ || {});
