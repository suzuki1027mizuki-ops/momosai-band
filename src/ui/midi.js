/* Web MIDI（任意）。パッド付きの MIDI コントローラがあれば、つなぐだけで使える固定割り当て：
 *   ノート 36〜41（C1〜F1）… シーン 1〜6（即時）  ノート 42 … タイトル
 *   ノート 43 … フラッシュ   ノート 44 … 暗転 ON/OFF   ノート 45 / 46 … 前の曲 / 次の曲
 *   CC1（モジュレーション）… 全体の明るさ   CC2 … 感度
 * 対応していない環境や許可されない場合は何もしない。 */
(function (VJ) {
  'use strict';

  const NOTE_SCENES = { 36: 'ripple', 37: 'tunnel', 38: 'horizon', 39: 'aurora', 40: 'kaleido', 41: 'glitch', 42: 'title' };

  const midi = {
    access: null,
    inputs: [],
    last: '',

    /** MIDI メッセージを ShowController の操作に変換（テストからも呼べる） */
    handle(show, data) {
      const st = data[0] & 0xf0, d1 = data[1], d2 = data[2];
      if (show.state.locked && !(st === 0x90 && d1 === 44 && d2 > 0)) return false;
      if (st === 0x90 && d2 > 0) {
        if (NOTE_SCENES[d1]) show.selectScene(NOTE_SCENES[d1], { immediate: true });
        else if (d1 === 43) show.flash(0.85, 'midi');
        else if (d1 === 44) show.toggleBlackout();
        else if (d1 === 45) show.prevSong();
        else if (d1 === 46) show.nextSong();
        else return false;
        return true;
      }
      if (st === 0xb0) {
        if (d1 === 1) {
          show.state.master = Math.max(0.2, Math.min(1, 0.2 + (d2 / 127) * 0.8));
          show.settings.master = show.state.master;
          return true;
        }
        if (d1 === 2) {
          const step = Math.round((d2 / 127) * 10 - 5);
          if (step !== show.state.sens) show.nudgeSensitivity(step - show.state.sens);
          return true;
        }
      }
      return false;
    },

    async init(app) {
      if (!navigator.requestMIDIAccess) return false;
      try {
        midi.access = await navigator.requestMIDIAccess({ sysex: false });
      } catch (e) {
        return false;
      }
      const bind = () => {
        midi.inputs = [];
        midi.access.inputs.forEach((inp) => {
          inp.onmidimessage = (ev) => {
            if (midi.handle(app.show, ev.data)) { midi.last = inp.name; if (app.onAction) app.onAction('midi'); }
          };
          midi.inputs.push(inp.name);
        });
      };
      bind();
      midi.access.onstatechange = bind;
      return true;
    },
  };

  VJ.midi = midi;
  VJ.midi.NOTE_SCENES = NOTE_SCENES;
})(globalThis.VJ = globalThis.VJ || {});
