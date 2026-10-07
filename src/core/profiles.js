/* 音楽のタイプ（プロファイル）。解析パラメータ（dsp）と演出（show）の既定値を切り替える。
 *   dsp  : VJ.dspConfig への上書き（配列は添字ごと・オブジェクトは再帰的に）
 *   show : switchSec（オートの切替間隔）/ kickFallbackSec / autoFlash（自動のフラッシュを使うか）
 *          / react（動きの大きさの基準）/ crossfade（シーン切替のフェード秒。0 = カット）
 *          / noTempo（テンポに合わせた切替をしない）/ tiers（盛り上がり 3 段階で使うシーン） */
(function (VJ) {
  'use strict';

  const DEFAULT_TIERS = {
    low: ['aurora', 'horizon', 'stars', 'ripple'],
    mid: ['ripple', 'tunnel', 'horizon', 'kaleido', 'eq'],
    high: ['tunnel', 'kaleido', 'glitch', 'eq'],
  };

  VJ.profiles = [
    {
      id: 'auto', name: 'おまかせ（バンド・ポップス全般）', nameEn: 'Auto (bands, pop in general)',
      desc: 'ドラムがあればドラムに、無ければピアノ・ギター・歌の発音に反応します。迷ったらこれ。',
      descEn: 'Follows the drums when there are drums, otherwise the notes of piano, guitar and voice. Pick this if unsure.',
      dsp: {}, show: { tiers: DEFAULT_TIERS },
    },
    {
      id: 'dance', name: 'EDM・ダンス・アイドル', nameEn: 'EDM, dance, idol pop',
      desc: '4 つ打ちのキックと低音に強く反応。シーンの切替は速め。',
      descEn: 'Strong reaction to four-on-the-floor kicks and bass. Faster scene changes.',
      dsp: { melodicMode: 'off', onset: { kick: { K: 1.8, relDb: 7 } }, env: { low: 0.12 } },
      show: { switchSec: 16, kickFallbackSec: 24, tiers: { low: ['stars', 'horizon', 'scope'], mid: ['eq', 'tunnel', 'kaleido', 'ripple'], high: ['glitch', 'tunnel', 'eq', 'kaleido'] } },
    },
    {
      id: 'hiphop', name: 'ヒップホップ・R&B', nameEn: 'Hip-hop, R&B',
      desc: '太い低音（808）と手拍子・スネアに合わせます。',
      descEn: 'Follows heavy bass (808), claps and snares.',
      dsp: { melodicMode: 'off', bands: [{ lo: 28 }], onset: { kick: { relDb: 7 } }, env: { low: 0.2 } },
      show: { switchSec: 24, tiers: { low: ['horizon', 'aurora', 'scope'], mid: ['eq', 'ripple', 'horizon'], high: ['glitch', 'eq', 'tunnel'] } },
    },
    {
      id: 'acoustic', name: 'アコースティック・弾き語り・ピアノ', nameEn: 'Acoustic, singer-songwriter, piano',
      desc: 'ドラムが無くても音の立ち上がりに反応。自動のフラッシュは使いません。',
      descEn: 'Reacts to note onsets even without drums. No automatic flashes.',
      dsp: { melodicMode: 'on', env: { level: 0.2, low: 0.25, mid: 0.18, high: 0.1 }, peak: { kick: 0.25, snare: 0.2 } },
      show: { switchSec: 36, kickFallbackSec: 50, autoFlash: false, react: 0.85, crossfade: 0.8, tiers: { low: ['aurora', 'stars', 'scope'], mid: ['ripple', 'scope', 'horizon', 'stars'], high: ['kaleido', 'ripple', 'horizon'] } },
    },
    {
      id: 'calm', name: 'しっとり（合唱・クラシック・バラード）', nameEn: 'Calm (choir, classical, ballads)',
      desc: 'ゆっくり大きく動きます。自動のフラッシュは使いません。',
      descEn: 'Slow, large movements. No automatic flashes.',
      dsp: {
        melodicMode: 'on', melodic: { K: 1.8, minRise: 3, refractory: 0.2 },
        env: { level: 0.4, low: 0.45, mid: 0.35, high: 0.2 }, peak: { kick: 0.45, snare: 0.35, hat: 0.15, accent: 0.5 },
        accent: { loudDb: 4 },
      },
      show: { switchSec: 45, kickFallbackSec: 60, autoFlash: false, react: 0.7, crossfade: 1.5, tiers: { low: ['aurora', 'stars'], mid: ['aurora', 'stars', 'scope'], high: ['horizon', 'scope', 'kaleido'] } },
    },
    {
      id: 'voice', name: '歌（アカペラ・弾き語りの歌・カラオケ）', nameEn: 'Singing (a cappella, vocals, karaoke)',
      desc: '声の高さで色が変わり、音程が変わるたびに反応。子音（サ行・タ行など）をドラムとして扱いません。',
      descEn: 'Colors follow the pitch of the voice and react to every note change. Consonants (s, t, k…) are not treated as drums.',
      dsp: {
        melodicMode: 'on', voice: { mode: 'sing' },
        env: { level: 0.2, low: 0.25, mid: 0.18, high: 0.1 }, peak: { kick: 0.25, snare: 0.2 },
      },
      show: { switchSec: 30, kickFallbackSec: 45, autoFlash: false, react: 0.85, crossfade: 1.0, tiers: { low: ['orb', 'bokeh', 'aurora', 'melody'], mid: ['melody', 'orb', 'waves', 'smoke', 'petals'], high: ['melody', 'circle', 'fireworks', 'kaleido'] } },
    },
    {
      id: 'speech', name: '司会・スピーチ・朗読', nameEn: 'MC, speeches, readings',
      desc: '話し声に合わせてやさしく動きます。フラッシュ・テンポに合わせた切替は使いません。',
      descEn: 'Moves gently with the speaking voice. No flashes and no tempo-based switching.',
      dsp: {
        melodicMode: 'on', voice: { mode: 'speech' }, melodic: { K: 1.8, minRise: 3, refractory: 0.15 },
        env: { level: 0.3, low: 0.35, mid: 0.25, high: 0.15 }, peak: { kick: 0.35, snare: 0.3, hat: 0.15, accent: 0.5 },
      },
      show: { switchSec: 60, kickFallbackSec: 90, autoFlash: false, react: 0.6, noTempo: true, crossfade: 1.5, tiers: { low: ['orb', 'bokeh', 'aurora'], mid: ['orb', 'voiceprint', 'bokeh', 'waves'], high: ['orb', 'voiceprint', 'waves', 'stars'] } },
    },
  ];
  VJ.profiles.DEFAULT_TIERS = DEFAULT_TIERS;

  VJ.profileById = function (id) {
    return VJ.profiles.find((p) => p.id === id) || VJ.profiles[0];
  };

  function deepMerge(base, over) {
    if (Array.isArray(base)) {
      const out = base.map((v) => (v && typeof v === 'object' ? deepMerge(v, {}) : v));
      if (Array.isArray(over)) over.forEach((v, i) => { if (v !== undefined && v !== null) out[i] = i < out.length && out[i] && typeof out[i] === 'object' ? deepMerge(out[i], v) : v; });
      return out;
    }
    const out = {};
    for (const k of Object.keys(base)) out[k] = base[k] && typeof base[k] === 'object' ? deepMerge(base[k], {}) : base[k];
    if (over && typeof over === 'object') {
      for (const k of Object.keys(over)) {
        const v = over[k];
        out[k] = v && typeof v === 'object' && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v;
      }
    }
    return out;
  }
  VJ.deepMerge = deepMerge;

  /** 設定（音楽のタイプ・無音とみなす音量）から解析パラメータを作る */
  VJ.makeDspConfig = function (settings) {
    const prof = VJ.profileById(settings && settings.profile);
    const cfg = deepMerge(VJ.dspConfig, prof.dsp);
    if (settings && typeof settings.gateDb === 'number') cfg.silenceAbsDb = settings.gateDb;
    return cfg;
  };

  /** 解析パラメータが変わる設定の組（変わったら FeatureExtractor を作り直す） */
  VJ.dspKey = function (settings) {
    return (settings.profile || 'auto') + '|' + settings.gateDb;
  };
})(globalThis.VJ = globalThis.VJ || {});
