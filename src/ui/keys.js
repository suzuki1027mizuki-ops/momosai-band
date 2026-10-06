/* キー操作。event.code（物理キー）で判定するので日本語入力 ON でも効く。
 * 入力欄にフォーカスがあるときは何もしない。キーリピートは無視。 */
(function (VJ) {
  'use strict';

  const SCENE_KEYS = { Digit0: 'title', Digit1: 'ripple', Digit2: 'tunnel', Digit3: 'horizon', Digit4: 'aurora', Digit5: 'kaleido', Digit6: 'glitch' };
  for (const k of Object.keys(SCENE_KEYS)) SCENE_KEYS[k.replace('Digit', 'Numpad')] = SCENE_KEYS[k];

  const HOLD = { KeyL: 1500, KeyR: 2000 };

  const KEY_HELP = [
    ['1〜6', 'シーン切替（次のビートで）'], ['Shift+数字', 'すぐ切替'], ['0', 'タイトル（バンド名）'],
    ['→ / ←', '次の曲 / 前の曲（曲名を表示）'], ['Space', 'フラッシュ'], ['S（押している間）', 'ストロボ'],
    ['B', '暗転 ON/OFF'], ['C / Shift+C', 'パレット 次 / 前'], ['↑ / ↓', '感度'], ['Shift+↑ / ↓', '全体の明るさ'],
    ['A', 'オート ON/OFF'], ['T', '曲名をもう一度表示'], ['F', '全画面にする'], ['D', '診断表示'],
    ['H', 'このヘルプ'], ['M', '設定パネル'], ['L', 'ロック（長押しで解除）'], ['R（2 秒長押し）', 'ソフトリセット'],
    ['Esc', 'パネルを閉じる（全画面中は長押しで解除）'],
  ];

  function isTyping(e) {
    const t = e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  /**
   * @param app { show, ui: {toggleHud, toggleHelp, togglePanel, closeOverlays, enterFullscreen, softReset} }
   */
  function install(app) {
    const holds = {};
    const handle = (e) => {
      if (e.repeat || e.isComposing) return;
      if (isTyping(e)) {
        if (e.code === 'Escape') { e.target.blur(); }
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
        else if (code !== 'KeyL') ui.toast('ロック中（L 長押しで解除 / B は暗転）', 'warn');
        return;
      }

      let handled = true;
      if (SCENE_KEYS[code]) show.selectScene(SCENE_KEYS[code], { immediate: shift || code.endsWith('0') });
      else if (code === 'ArrowRight') show.nextSong();
      else if (code === 'ArrowLeft') show.prevSong();
      else if (code === 'Space') show.flash(0.85, 'key') || ui.toast('フラッシュ制限中（光過敏対策）', 'warn');
      else if (code === 'KeyS') show.setStrobe(true);
      else if (code === 'KeyB') show.toggleBlackout();
      else if (code === 'KeyC') show.cyclePalette(shift ? -1 : 1);
      else if (code === 'ArrowUp') (shift ? show.nudgeMaster(1) : show.nudgeSensitivity(1));
      else if (code === 'ArrowDown') (shift ? show.nudgeMaster(-1) : show.nudgeSensitivity(-1));
      else if (code === 'KeyA') show.toggleAuto();
      else if (code === 'KeyT') show.showSongTitle();
      else if (code === 'KeyF') ui.enterFullscreen();
      else if (code === 'KeyD') ui.toggleHud();
      else if (code === 'KeyH') ui.toggleHelp();
      else if (code === 'KeyM') ui.togglePanel();
      else if (code === 'KeyL') show.lock();
      else if (code === 'KeyR') ui.toast('R を 2 秒長押しでソフトリセット');
      else if (code === 'Escape') ui.closeOverlays();
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

  VJ.keys = { install, SCENE_KEYS, KEY_HELP };
})(globalThis.VJ = globalThis.VJ || {});
