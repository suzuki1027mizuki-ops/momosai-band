/* Web MIDI（任意）。パッドやつまみの付いた MIDI コントローラで操作する。
 * 既定の割り当て（つなぐだけで使える）：
 *   ノート 36〜41（C1〜F1）… シーン 1〜6（即時）  ノート 42 … タイトル
 *   ノート 43 … フラッシュ   ノート 44 … 暗転 ON/OFF   ノート 45 / 46 … 前の曲 / 次の曲
 *   CC1（モジュレーション）… 全体の明るさ   CC2 … 感度
 * 「割り当てを変える」で、操作ごとに「学習」を押してからパッド・つまみを動かすと割り当てが変わる（MIDI ラーン）。
 * 割り当ては設定（settings.midiMap）に保存する。キーは 'n36'（ノート）/ 'c1'（コントロールチェンジ）。
 * 対応していない環境や許可されない場合は何もしない。 */
(function (VJ) {
  'use strict';

  const DEFAULT_MAP = {
    n36: 'scene:ripple', n37: 'scene:tunnel', n38: 'scene:horizon', n39: 'scene:aurora', n40: 'scene:kaleido', n41: 'scene:glitch', n42: 'scene:title',
    n43: 'flash', n44: 'blackout', n45: 'prevSong', n46: 'nextSong', c1: 'master', c2: 'sens',
  };

  /** 操作の一覧（学習の画面に出す順）。kind: trigger（押したとき）/ hold（押している間）/ value（つまみ） */
  function actions() {
    const list = [];
    for (const s of VJ.scenes.list) {
      if (s.hidden) continue;
      list.push({ id: 'scene:' + s.id, name: VJ.t('シーン {0} {1}', s.key.replace('s', 'Shift+'), VJ.sceneName(s)), kind: 'trigger' });
    }
    list.push(
      { id: 'flash', name: 'フラッシュ', kind: 'trigger' },
      { id: 'strobe', name: 'ストロボ（押している間）', kind: 'hold' },
      { id: 'blackout', name: '暗転 ON/OFF', kind: 'trigger' },
      { id: 'prevSong', name: '前の曲', kind: 'trigger' },
      { id: 'nextSong', name: '次の曲', kind: 'trigger' },
      { id: 'auto', name: 'オート ON/OFF', kind: 'trigger' },
      { id: 'tap', name: 'タップテンポ', kind: 'trigger' },
      { id: 'palette', name: 'パレット（次）', kind: 'trigger' },
      { id: 'msg0', name: 'テロップ 1', kind: 'trigger' },
      { id: 'msg1', name: 'テロップ 2', kind: 'trigger' },
      { id: 'msg2', name: 'テロップ 3', kind: 'trigger' },
      { id: 'test', name: 'テストパターン', kind: 'trigger' },
      { id: 'media', name: 'メディアのオーバーレイ ON/OFF', kind: 'trigger' },
      { id: 'ovscene', name: 'シーンのオーバーレイ ON/OFF', kind: 'trigger' },
      { id: 'master', name: '全体の明るさ（つまみ）', kind: 'value' },
      { id: 'sens', name: '感度（つまみ）', kind: 'value' },
    );
    for (const a of list) if (!a.id.startsWith('scene:')) a.name = VJ.t(a.name);
    return list;
  }

  /** 'n36' → 'ノート 36（C1）' */
  function keyLabel(k) {
    if (!k) return '—';
    const n = +k.slice(1);
    if (k[0] === 'c') return `CC ${n}`;
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return VJ.t('ノート {0}（{1}）', n, names[n % 12] + (Math.floor(n / 12) - 2));
  }

  const midi = {
    access: null,
    inputs: [],
    last: '',
    learning: null, // { action, cb }
    ccHigh: {}, // CC をボタンとして使うときの押下状態

    /** 今の割り当て（設定に無ければ既定） */
    map(settings) {
      const m = settings && settings.midiMap;
      return m && typeof m === 'object' && Object.keys(m).length ? m : DEFAULT_MAP;
    },

    /** 次に来た MIDI メッセージを action に割り当てる。cb(key) */
    learn(action, cb) { midi.learning = { action, cb }; },
    cancelLearn() { midi.learning = null; },

    /** 学習の結果を割り当てに反映（同じ操作の古い割り当て・同じキーの古い操作は外す） */
    assign(settings, key, action) {
      const m = Object.assign({}, midi.map(settings));
      for (const k of Object.keys(m)) if (m[k] === action) delete m[k];
      if (key) m[key] = action;
      settings.midiMap = m;
      return m;
    },

    /** MIDI メッセージを ShowController の操作に変換（テストからも呼べる）。settings は割り当て用 */
    handle(show, data, settings) {
      const st = data[0] & 0xf0, d1 = data[1], d2 = data[2];
      const noteOn = st === 0x90 && d2 > 0, noteOff = st === 0x80 || (st === 0x90 && d2 === 0), cc = st === 0xb0;
      if (!noteOn && !noteOff && !cc) return false;
      const key = (cc ? 'c' : 'n') + d1;
      // CC をボタンとして使うとき：64 以上に上がった瞬間が「押した」、下がった瞬間が「離した」
      let press = noteOn, release = noteOff;
      if (cc) {
        const was = !!midi.ccHigh[key];
        midi.ccHigh[key] = d2 >= 64;
        press = !was && d2 >= 64;
        release = was && d2 < 64;
      }
      if (midi.learning && (noteOn || cc)) {
        const l = midi.learning;
        midi.learning = null;
        if (l.cb) l.cb(key);
        return 'learned';
      }
      const action = midi.map(settings || show.settings)[key];
      if (!action) return false;
      // ロック中も暗転と「ストロボを離す」は通す（押している途中でロックしても止められるように）
      if (show.state.locked && action !== 'blackout' && !(action === 'strobe' && release)) return false;
      // つまみ
      if (action === 'master' || action === 'sens') {
        if (!cc) return false;
        if (action === 'master') show.setMaster(0.2 + (d2 / 127) * 0.8);
        else show.setSensitivity(Math.round((d2 / 127) * 10 - 5));
        return true;
      }
      if (action === 'strobe') {
        if (press) show.setStrobe(true);
        else if (release) show.setStrobe(false);
        return press || release;
      }
      if (!press) return false;
      if (action.startsWith('scene:')) show.selectScene(action.slice(6), { immediate: true });
      else if (action === 'flash') show.flash(0.85, 'midi');
      else if (action === 'blackout') show.toggleBlackout();
      else if (action === 'prevSong') show.prevSong();
      else if (action === 'nextSong') show.nextSong();
      else if (action === 'auto') show.toggleAuto();
      else if (action === 'tap') show.tap();
      else if (action === 'palette') show.cyclePalette(1);
      else if (/^msg[0-2]$/.test(action)) show.toggleMessage(+action[3]);
      else if (action === 'test') show.toggleTestPattern();
      else if (action === 'media') show.toggleOverlay();
      else if (action === 'ovscene') show.toggleSceneOverlay();
      else return false;
      return true;
    },

    async init(app) {
      if (!navigator.requestMIDIAccess) return false;
      if (midi.access) return true;
      try {
        midi.access = await navigator.requestMIDIAccess({ sysex: false });
      } catch (e) {
        return false;
      }
      const bind = () => {
        midi.inputs = [];
        midi.access.inputs.forEach((inp) => {
          inp.onmidimessage = (ev) => {
            const r = midi.handle(app.show, ev.data, app.settings);
            if (r) { midi.last = inp.name; if (app.onAction) app.onAction('midi'); }
          };
          midi.inputs.push(inp.name);
        });
        if (midi.onchange) midi.onchange();
      };
      bind();
      midi.access.onstatechange = bind;
      return true;
    },
  };

  VJ.midi = midi;
  VJ.midi.DEFAULT_MAP = DEFAULT_MAP;
  VJ.midi.actions = actions;
  VJ.midi.keyLabel = keyLabel;
})(globalThis.VJ = globalThis.VJ || {});
