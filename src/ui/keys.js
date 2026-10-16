/* キー操作。event.code（物理キー）で判定するので日本語入力 ON でも効く。
 * 入力欄にフォーカスがあるときは何もしない。キーリピートは無視。 */
(function (VJ) {
  'use strict';

  /** 数字キー → シーン。Shift を押していれば 2 段目（key が 's1'〜's9' のシーン）。0 はどちらもタイトル */
  function sceneForKey(code, shift) {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (!m) return null;
    const d = m[1];
    if (d === '0') return 'title';
    const want = (shift ? 's' : '') + d;
    const def = VJ.scenes.list.find((s) => s.key === want && !s.hidden);
    return def ? def.id : null;
  }

  const HOLD = { KeyL: 1500, KeyR: 2000 };

  // [キー, 説明]（表示するときに VJ.t で訳す）
  const KEY_HELP = [
    ['1〜9', 'シーン切替（次のビートで。もう一度押すとすぐ）'], ['Shift+1〜9', 'シーン 2 段目（声の輪・メロディ線・花火 など）'], ['0', 'タイトル（バンド名）'],
    ['→ / ←', '次の曲 / 前の曲（曲名を表示）'], ['Space', 'フラッシュ'], ['S（押している間）', 'ストロボ'],
    ['B', '暗転 ON/OFF'], ['C / Shift+C', 'パレット 次 / 前'], ['↑ / ↓', '感度'], ['Shift+↑ / ↓', '全体の明るさ'],
    ['A', 'オート ON/OFF'], ['Enter', 'タップテンポ（拍に合わせて 3 回以上）'], ['Q / W / E', 'テロップ 1〜3 を表示・消す'],
    ['N / Shift+N', '次のバンド / 前のバンド（演奏中は 2 回押す）'],
    ['T', '曲名をもう一度表示'], ['O / Shift+O', 'メディアのオーバーレイ / シーンのオーバーレイ ON/OFF'], ['Alt+1〜9', 'キュー（シーン・色・メディアをまとめて切替）'], ['G', 'テストパターン（位置合わせ）'], ['F', '全画面にする'], ['D', '診断表示'],
    ['H', 'このヘルプ'], ['M', '設定パネル'], ['L', 'ロック（長押しで解除）'], ['R（2 秒長押し）', 'ソフトリセット'],
    ['Esc', 'パネルを閉じる（全画面中は長押しで解除）'],
  ];

  const TEXT_TYPES = ['text', 'search', 'email', 'url', 'password', 'number', 'tel', 'time', 'date', 'datetime-local', 'month', 'week'];
  const ACTIVATE_TYPES = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'];

  /**
   * このキーをフォームの部品に任せるか（ショーの操作にしない）。
   *  - 文字入力欄・テキストエリア・選択肢：すべて任せる
   *  - スライダー・ラジオボタン：矢印キーだけ任せる（微調整できるように。数字キーなどはショーに効く）
   *  - ボタン・チェックボックスなど：Space / Enter だけ任せる（キーボードで押せるように）
   * マウスで押したボタン・チェックボックスは panel.js が直後にフォーカスを外すので、Space はフラッシュになる。
   */
  function forForm(e) {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select' || t.isContentEditable) return true;
    const type = tag === 'input' ? (t.type || 'text').toLowerCase() : '';
    if (tag === 'input' && TEXT_TYPES.includes(type)) return true;
    const activate = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
    if (activate && (tag === 'button' || tag === 'summary' || (tag === 'input' && ACTIVATE_TYPES.includes(type)))) return true;
    if (/^Arrow/.test(e.code) && tag === 'input' && (type === 'range' || type === 'radio')) return true;
    return false;
  }

  /** 操作の名前 → 動き。キーとパネルの「本番の操作」のボタンの両方から使う（動きを二重に書かない）。
   *  shift：Shift を押していたか（前へ・2 段目など） */
  const ACTIONS = {
    nextSong: (app) => app.show.nextSong(),
    prevSong: (app) => app.show.prevSong(),
    flash: (app) => app.show.flash(0.85, 'key') || app.ui.toast(VJ.t('フラッシュ制限中（光過敏対策）'), 'warn'),
    strobe: (app) => app.show.setStrobe(true),
    blackout: (app) => app.show.toggleBlackout(),
    palette: (app, shift) => app.show.cyclePalette(shift ? -1 : 1),
    up: (app, shift) => (shift ? app.show.nudgeMaster(1) : app.show.nudgeSensitivity(1)),
    down: (app, shift) => (shift ? app.show.nudgeMaster(-1) : app.show.nudgeSensitivity(-1)),
    auto: (app) => app.show.toggleAuto(),
    songTitle: (app) => app.show.showSongTitle(),
    band: (app, shift) => { if (VJ.bandsUI) VJ.bandsUI.step(shift ? -1 : 1); },
    tap: (app) => app.show.tap(),
    msg1: (app) => app.show.toggleMessage(0),
    msg2: (app) => app.show.toggleMessage(1),
    msg3: (app) => app.show.toggleMessage(2),
    test: (app) => app.show.toggleTestPattern(),
    overlay: (app, shift) => (shift ? app.show.toggleSceneOverlay() : app.show.toggleOverlay()),
    fullscreen: (app) => app.ui.enterFullscreen(),
    hud: (app) => app.ui.toggleHud(),
    help: (app) => app.ui.toggleHelp(),
    panel: (app) => app.ui.togglePanel(),
    lock: (app) => app.show.lock(),
    resetHint: (app) => app.ui.toast(VJ.t('R を 2 秒長押しでソフトリセット')),
    close: (app) => app.ui.closeOverlays(),
  };
  const CODE_ACTION = {
    ArrowRight: 'nextSong', ArrowLeft: 'prevSong', Space: 'flash', KeyS: 'strobe', KeyB: 'blackout', KeyC: 'palette',
    ArrowUp: 'up', ArrowDown: 'down', KeyA: 'auto', KeyT: 'songTitle', KeyN: 'band', Enter: 'tap', NumpadEnter: 'tap',
    KeyQ: 'msg1', KeyW: 'msg2', KeyE: 'msg3', KeyG: 'test', KeyO: 'overlay', KeyF: 'fullscreen', KeyD: 'hud', KeyH: 'help',
    KeyM: 'panel', KeyL: 'lock', KeyR: 'resetHint', Escape: 'close',
  };

  /** 操作を 1 つ行う（パネルのボタンから）。ロック中は暗転だけ（キーと同じ）。行ったら true */
  function run(app, name, shift) {
    const fn = ACTIONS[name];
    if (!fn) return false;
    if (app.show.state.locked && name !== 'blackout') { app.ui.toast(VJ.t('ロック中（L 長押しで解除 / B は暗転）'), 'warn'); return false; }
    fn(app, !!shift);
    if (app.onAction) app.onAction(name);
    return true;
  }

  /**
   * @param app { show, ui: {toggleHud, toggleHelp, togglePanel, closeOverlays, enterFullscreen, softReset} }
   */
  function install(app) {
    const holds = {};
    const handle = (e) => {
      if (e.repeat || e.isComposing) return;
      if (forForm(e)) return;
      if (e.code === 'Escape' && e.target && e.target.blur && e.target !== document.body) e.target.blur();
      // Alt+1〜9：キュー（Ctrl・⌘ と一緒のとき＝AltGr などは使わない）
      const cueKey = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (cueKey && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (app.show.state.locked) { app.ui.toast(VJ.t('ロック中（L 長押しで解除 / B は暗転）'), 'warn'); return; }
        if (app.cue) app.cue(+cueKey[1] - 1);
        if (app.onAction) app.onAction('cue');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const show = app.show, ui = app.ui, code = e.code;
      const shift = e.shiftKey;

      // 長押し系（L 解除・R リセット）
      if (HOLD[code]) {
        clearTimeout(holds[code]);
        holds[code] = setTimeout(() => {
          holds[code] = null;
          if (code === 'KeyL' && show.state.locked) show.unlock();
          if (code === 'KeyR' && !show.state.locked) ui.softReset();
        }, HOLD[code]);
      }

      if (show.state.locked) {
        if (code === 'KeyB') { show.toggleBlackout(); e.preventDefault(); }
        else if (code !== 'KeyL') ui.toast(VJ.t('ロック中（L 長押しで解除 / B は暗転）'), 'warn');
        return;
      }

      let handled = true;
      const sceneId = sceneForKey(code, shift);
      if (/^(?:Digit|Numpad)\d$/.test(code) && !sceneId) ui.toast(VJ.t('このキーにはシーンがありません'), 'warn');
      else if (sceneId) show.selectScene(sceneId, { immediate: code.endsWith('0') });
      else if (CODE_ACTION[code]) ACTIONS[CODE_ACTION[code]](app, shift);
      else handled = false;
      if (handled) { e.preventDefault(); if (app.onAction) app.onAction(code); }
    };
    const up = (e) => {
      if (HOLD[e.code]) { clearTimeout(holds[e.code]); holds[e.code] = null; }
      if (e.code === 'KeyS') app.show.setStrobe(false);
    };
    window.addEventListener('keydown', handle, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', () => app.show.setStrobe(false));
    return { handle, up };
  }

  VJ.keys = { install, run, sceneForKey, KEY_HELP, forForm, ACTIONS, CODE_ACTION };
})(globalThis.VJ = globalThis.VJ || {});
