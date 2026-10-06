/* 既定設定。ユーザーが変えられる値は storage.js で localStorage に保存される。 */
(function (VJ) {
  'use strict';

  VJ.defaultSettings = {
    v: 1,
    bandName: 'MOMOSAI BAND',
    endText: 'Thank you!',
    setlistText: [
      '@band MOMOSAI BAND',
      '# 書き方: 曲名 | シーン(番号か名前, カンマ区切りで複数) | パレット',
      '1. オープニング | 1,2 | neon',
      '2. 疾走チューン | 2,6 | fire',
      '3. バラード | 4 | ocean',
      '4. ラストナンバー | 5,3 | sakura',
      '@end Thank you!',
    ].join('\n'),
    deviceId: '',
    deviceLabel: '',
    channel: 'mix', // mix | left | right
    auto: true,
    autoFlash: true, // アクセント（キメ）で自動フラッシュ
    toast: true, // キー操作の確認表示
    sensitivity: 0, // -5..+5
    master: 1.0, // 全体の明るさ 0.2..1.0
    paletteIdx: 0,
    customPalette: ['#00F0FF', '#FF00C8', '#7A00FF', '#FFFFFF'],
    desynchronized: true,
    latencySquare: false, // 遅延計測用の白い四角
    monitor: true, // デモ/ファイル再生時にスピーカーから鳴らす（マイクは絶対に出力しない）
    maxScale: 1.0, // 描画解像度の上限倍率
  };

  /** 解析パラメータ（調整はテストで行う。UI には出さない） */
  VJ.dspConfig = {
    hop: 128,
    // 5 帯域。lo/hi は Hz。null は片側なし。order は 2 か 4（バターワース）。
    bands: [
      { name: 'b0', lo: 35, hi: 150, order: 4, quadrature: true }, // キック
      { name: 'b1', lo: 150, hi: 400, order: 4, quadrature: true }, // ベース・ボディ
      { name: 'b2', lo: 400, hi: 2000, order: 4 }, // 中域
      { name: 'b3', lo: 2000, hi: 5000, order: 4 }, // スネア・アタック
      { name: 'b4', lo: 6000, hi: null, order: 4 }, // ハイハット
    ],
    // オンセット検出（帯域 index → パラメータ）
    // relDb: 帯域の最近のピーク（4dB/秒で下がる）からこれ以上小さい立ち上がりは無視
    onset: {
      kick: { band: 0, W: 4, L: 4, R: 4, K: 2.0, minRise: 4, refractory: 0.1, relDb: 8, peakFall: 3 },
      snare: { band: 3, W: 2, L: 3, R: 3, K: 2.5, minRise: 4, refractory: 0.09, relDb: 9, peakFall: 4 },
      hat: { band: 4, W: 1, L: 2, R: 3, K: 2.2, minRise: 3, refractory: 0.05, relDb: 20, peakFall: 4 },
      b1: { band: 1, W: 3, L: 3, R: 3, K: 2.2, minRise: 3, refractory: 0.08 },
      b2: { band: 2, W: 2, L: 3, R: 3, K: 2.2, minRise: 3, refractory: 0.08 },
    },
    kickSnareHops: 5, // スネア検出からこのホップ数以内のキック候補は…
    kickSnareRelDb: 7, // …キック帯域のピークよりこれ以上小さければ捨てる
    statTau: 1.0, // flux の平均・分散の時定数
    gateDb: 10, // ノイズフロア + gateDb を超えたら有効
    // アクセント（キメ）：3 帯域以上が同時に立ち上がり、かつ全帯域の音量が「直近のピーク + loudDb」を超えた
    accent: { zMin: 1.5, minBands: 3, windowHops: 6, minLevel: 0.5, refractory: 0.25, loudDb: 3, peakFall: 2, lagHops: 16 },
    // 自動正規化（連続値のみ）
    agc: { rangeDb: 24, attack: 0.3, release: 8, warmRelease: 1.0, warmSec: 6, initDb: -40, floorMarginDb: 20 },
    noiseFloor: { rise: 20, fall: 0.5, initDb: -100, capBelowRefDb: 20 },
    // 包絡線の減衰（秒）
    env: { level: 0.12, low: 0.15, mid: 0.1, high: 0.06 },
    // ヒットの山の減衰（秒）
    peak: { kick: 0.15, snare: 0.12, hat: 0.06, accent: 0.3 },
    silenceAbsDb: -70,
    breakRatio: 0.15,
    breakHold: 0.25,
    impactWindow: 4.0,
    fftSize: 2048,
    specBands: 64,
    specLo: 40,
    specHi: 16000,
    specRelease: 0.12,
    specSlowRelease: 0.45,
    specRangeDb: 48,
    waveLen: 512,
    historyLen: 8,
  };

  VJ.flashConfig = {
    maxPerSec: 3, // 光過敏対策：1 秒に 3 回まで
    minGap: 0.2, // 最短間隔（秒）
    decay: 0.09, // フラッシュの減衰（秒）
  };
})(globalThis.VJ = globalThis.VJ || {});
