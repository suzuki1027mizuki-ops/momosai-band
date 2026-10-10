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
    profile: 'auto', // 音楽のタイプ（profiles.js）
    gateDb: -70, // これより小さい音は無音とみなす（dBFS）。ざわざわした会場では上げる
    noFlash: false, // フラッシュ類を一切使わない（光に配慮が必要な会場）
    flashLimit: 3, // 1 秒あたりのフラッシュの上限（3 = 推奨：光過敏対策のガイドライン。0 = 制限なし）
    intensity: 2, // 激しさ 0 控えめ / 1 ふつう（以前の動き）/ 2 激しい / 3 最大 / -1 自動（曲の盛り上がりに合わせる）
    paletteAuto: false, // パレットを曲の区切りごとに自動で変える
    react: 1.0, // 動きの大きさ 0.3〜1.5
    autoScenes: {}, // オートで使うシーン（false のものは使わない）
    fpsCap: 0, // 0 = 制限なし / 30 = 30fps（非力な PC 向け）
    messages: ['', '', ''], // テロップ（Q / W / E）
    countdownTo: '', // 開演時刻 'HH:MM'（タイトルにカウントダウン）
    logo: '', // ロゴ画像（data URL）
    logoMode: 'title', // title: バンド名の代わり / corner: 隅に透かし / both / off
    logoCorner: 'br', // tl / tr / bl / br
    output: { rotate: 0, flipH: false, flipV: false, size: 1, x: 0, y: 0 }, // 表示の調整
    autoStart: false, // 起動したら前回の入力で自動的に開始
    lastSource: 'mic', // 前回の音声入力の種類
    sceneParams: {}, // シーンごとの調整値 { sceneId: [v0, v1, v2, v3] }
    speechTitle: false, // 話し声（MC）を検出したらタイトル画面にする
    demoKind: 'band', // デモ音源の種類 band / sing / speech
    lang: 'auto', // 表示の言語 auto / ja / en
    crossfade: -1, // シーン切替の長さ（秒）。0 = カット / -1 = 音楽のタイプに合わせる
    transition: 'fade', // シーン切替の種類（crossfade が 0 より大きいとき）：fade / wipe / iris / blinds / zoom / slide / glitch / mosaic / random
    midiMap: {}, // MIDI の割り当て（空なら既定）。{ 'n36': 'scene:ripple', 'c1': 'master', ... }
    net: { enabled: false, url: 'ws://127.0.0.1:8787/vj' }, // ブリッジ（スマホ操作・OSC・Art-Net）
    osc: { enabled: false, host: '127.0.0.1', port: 9001, rate: 30 }, // OSC で特徴量を送る
    dmx: { enabled: false, out: 'artnet', host: '255.255.255.255', universe: 0, type: 'drgb', count: 4, start: 1, max: 1, pulse: 0.5, flash: true }, // 照明
    bands: [], // 出演バンド（bands.js）。いま出ているバンドの値は上の bandName・setlistText などにある
    bandIdx: 0, // いま出ているバンドの番号
    bandPalette: -1, // いま出ているバンドの色（パネルで選んだもの。-1 = 決めていない）
    overlayOn: true, // メディアのオーバーレイ（画像・動画・画面の取り込み・YouTube / ニコニコ）の表示（O キー）
    ovSceneOn: true, // シーンのオーバーレイ（別のシーンを重ねる）の表示（Shift+O）
    overlay: {
      // メディア：mediaKind image 画像 / video 動画ファイル / capture 画面・タブの取り込み / web YouTube・ニコニコ /
      // camera カメラ / lib メディアの一覧の 1 件（libId）
      mediaKind: 'image', libId: '',
      // カメラ（Web カメラ・キャプチャーボード）。cameraId が空なら既定のカメラ。mirror：左右反転（鏡）
      cameraId: '', cameraLabel: '', cameraMirror: false,
      // 画像（透過 PNG の枠・イラストなど。data URL）。fit: contain 全体が入る / cover 画面を埋める / stretch 引き伸ばす（動画にも使う）
      image: '', imageFit: 'contain', imageBlend: 'normal', imageOpacity: 1, // blend: normal そのまま / add 光を足す / screen
      // 動画ファイル（中身は大きいので設定には入れず、mediastore.js に保存。ここは鍵と名前だけ）
      videoKey: '', videoName: '', videoLoop: true, videoSound: false,
      // YouTube / ニコニコの URL（埋め込みで、映像の上に重ねる。インターネットが必要）
      webUrl: '',
      // いまのシーンの上に、別のシーンを重ねる（'' = 重ねない）
      scene: '', sceneBlend: 'screen', sceneOpacity: 0.7, // blend: screen / add。濃さ 1 でも足す強さは 0.6 まで（光過敏対策）
      // 文字（時計・バンド名・曲名・自由な文字）を隅にずっと出す
      textOn: true, clock: false, band: false, song: false, text: '', corner: 'tr', textSize: 1, textOpacity: 0.9,
    },
    mediaLib: [], // メディアの一覧（medialib.js。曲ごとのメディア「m:名前」・キューで使う）
    cues: [], // キュー：{ name, scene, palette, media, ovScene }（cues.js。1 回の操作でまとめて切り替える）
    guide: true, // パネルの上に「はじめてのガイド」を出す
    panelFold: {}, // パネルの閉じている見出し { '3': true, ... }（①〜⑦）
  };

  /** 英語で初めて開いたときのセットリストの見本 */
  VJ.defaultSetlistEn = [
    '@band MOMOSAI BAND',
    '# Format: title | scenes (number or name, comma-separated) | palette',
    '1. Opening | 1,2 | neon',
    '2. Fast Tune | 2,6 | fire',
    '3. Ballad | 4 | ocean',
    '4. Last Song | 5,3 | sakura',
    '@end Thank you!',
  ].join('\n');

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
    // ドラムが無い曲用：中域（150Hz〜5kHz）の立ち上がり（ピアノ・ギター・歌の発音）
    melodic: { W: 2, L: 4, R: 6, K: 1.5, minRise: 2.5, refractory: 0.12, relDb: 16, peakFall: 3 },
    melodicMode: 'auto', // auto: ドラムが無ければ自動で切替 / on: 常に / off: 使わない
    drumRatioDb: -2, // キック時に 低域 ÷ 中域 がこれより大きければドラムとみなす
    // 声：ピッチ推定（YIN）
    // everySec：推定の間隔（秒）。ホップ数はサンプルレートから決める（96kHz でも時間で同じ間隔にする）
    pitch: { fmin: 70, fmax: 1100, everySec: 0.0107, thr: 0.15, maxAperiodic: 0.3, lowpass: 2000 },
    // 声の扱い。mode: off（楽器と同じ）/ sing（歌：音程の変わり目にも反応・子音をドラム扱いしない）
    //                 / speech（話し声：子音をドラム扱いしない）
    voice: {
      mode: 'off',
      pitchSmooth: 0.5, // 音程のなめらかさ（推定 1 回あたりの追従率）
      // 音程の変わり目：ずれ（半音）・続く回数・その間の揺れの上限（半音）・周期性の上限・最短間隔（秒）・中心の追従率
      // （合唱・和音は複数の声が混ざって周期性が下がる＝非周期性が大きいので出さない）
      noteThr: 0.9, noteHold: 3, noteStable: 0.5, noteMaxAp: 0.06, noteGap: 0.1, centerFollow: 0.08,
      speechWindow: 4, speechEvery: 0.17, speechMinSec: 1.5, // 話し声の判定：窓（秒）・更新間隔・判定に要る有音の長さ
      speechTau: 0.6, speechOn: 0.55, speechOff: 0.25, // なめらかさ（秒）とヒステリシス
      segmentGap: 1.0, speechHoldSilence: 4, // この秒数の無音で区間を区切る / 話し声の状態を解除（話の間はそれまで保つ）
      histLen: 128,
    },
    // 話し声（MC）を検出したら、自動フラッシュ・ブレイク明けの一撃・キメ・拍を止める
    speechGuard: true,
    // テンポ推定に使う帯域ごとの重み（立ち上がりの強さの和）
    tempoWeights: [1.0, 0.5, 0.5, 0.8, 0.4],
    kickSnareHops: 5, // スネア検出からこのホップ数以内のキック候補は…
    kickSnareRelDb: 7, // …キック帯域のピークよりこれ以上小さければ捨てる
    statTau: 1.0, // flux の平均・分散の時定数
    gateDb: 10, // ノイズフロア + gateDb を超えたら有効
    // アクセント（キメ）：3 帯域以上が同時に立ち上がり、かつ全帯域の音量が「直近のピーク + loudDb」を超えた
    accent: { zMin: 1.5, minBands: 3, edgeBands: [0, 4], windowHops: 6, minLevel: 0.5, refractory: 0.25, loudDb: 3, peakFall: 2, lagHops: 16 },
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
    maxPerSec: 3, // 光過敏対策：1 秒に 3 回まで（設定 flashLimit で変えられる。既定はこの値）
    minGap: 0.2, // 最短間隔（秒）
    decay: 0.09, // フラッシュの減衰（秒）
  };
})(globalThis.VJ = globalThis.VJ || {});
