/* オートモード：操作者が何もしなくても破綻しないように自動でシーンを切り替える。
 *  - 前の切替から switchSec 秒以上たち、アクセント（なければ強いキック）が来たら次のシーンへ
 *  - 曲にシーン指定があればその中で順番に。なければ盛り上がりに合わせて選ぶ
 *  - 無音が silenceSec 秒続いたらタイトルへ。強打で元に戻る */
(function (VJ) {
  'use strict';

  const TIERS = {
    low: ['aurora', 'horizon', 'stars', 'ripple'],
    mid: ['ripple', 'tunnel', 'horizon', 'kaleido', 'eq'],
    high: ['tunnel', 'kaleido', 'glitch', 'eq'],
  };

  class AutoDirector {
    constructor(opts) {
      this.opts = Object.assign({ switchSec: 24, kickFallbackSec: 34, silenceSec: 8 }, opts || {});
      this.lastSwitch = -1e9;
      this.switches = 0;
      this.silentFrom = null; // 無音でタイトルにする前のシーン
      this.rng = VJ.util.rng(1234);
    }

    noteSwitch(now) { this.lastSwitch = now; }

    /** @returns {{scene?: string, palette?: number, reason: string}|null} */
    update(show, f, now) {
      if (!show.auto) return null;
      const st = show.state;
      // 無音 → タイトル
      if (f.silenceSec > this.opts.silenceSec && st.sceneId !== 'title' && !this.silentFrom) {
        this.silentFrom = st.sceneId;
        return { scene: 'title', reason: 'silence' };
      }
      if (this.silentFrom) {
        if (f.active && (f.onsetFlags & (1 | 8 | 16)) && (f.kick >= 0.6 || f.accent > 0 || (f.onsetFlags & 16))) {
          const back = this.silentFrom;
          this.silentFrom = null;
          this.lastSwitch = now;
          return { scene: back === 'title' ? this._pick(show, f) : back, reason: 'resume' };
        }
        if (st.sceneId !== 'title') this.silentFrom = null; // 手動で動かした
        return null;
      }
      if (!f.active) return null;
      // タイトル（開演前・MC・終演）は操作者が離れるまで維持する
      if (st.sceneId === 'title') return null;
      const prof = (show.profile && show.profile.show) || {};
      const S = prof.switchSec || this.opts.switchSec;
      const KF = prof.kickFallbackSec || this.opts.kickFallbackSec;
      const since = now - this.lastSwitch;
      const fl = f.onsetFlags;
      // 1) キメ・ブレイク明け  2) 少し待っても無ければ小節の頭（テンポが取れているとき）  3) それも無ければキック
      const trigger = (since >= S && (fl & (8 | 16)))
        || (since >= S + 6 && (fl & 64) && f.beatConf >= 0.35)
        || (since >= KF && (fl & 1));
      if (!trigger) return null;
      const song = show.currentSong();
      if (song && song.scenes.length === 1) return null; // 1 シーン指定の曲は固定
      const next = this._pick(show, f);
      if (!next || next === st.sceneId) return null;
      this.lastSwitch = now;
      this.switches++;
      const out = { scene: next, reason: 'auto' };
      if (this.switches % 2 === 0 && !(song && song.palette !== null)) out.palette = 1;
      return out;
    }

    _pick(show, f) {
      const song = show.currentSong();
      const cur = show.state.sceneId;
      if (song && song.scenes.length > 1) {
        const list = song.scenes.filter((id) => show.sceneAvailable(id));
        if (!list.length) return null;
        const i = list.indexOf(cur);
        return list[(i + 1) % list.length];
      }
      const tiers = (show.profile && show.profile.show.tiers) || TIERS;
      const ok = (id) => (show.autoAllowed ? show.autoAllowed(id) : show.sceneAvailable(id));
      const tier = f.intensity > 0.66 ? tiers.high : f.intensity > 0.33 ? tiers.mid : tiers.low;
      let cands = tier.filter((id) => id !== cur && ok(id));
      // 選べるものが無ければ（オートで使うシーンを絞った場合など）許可されたシーン全体から
      if (!cands.length) cands = VJ.scenes.list.map((d) => d.id).filter((id) => id !== cur && ok(id));
      if (!cands.length) return null;
      return cands[Math.floor(this.rng() * cands.length)];
    }
  }

  VJ.AutoDirector = AutoDirector;
  VJ.AutoDirector.TIERS = TIERS;
})(globalThis.VJ = globalThis.VJ || {});
