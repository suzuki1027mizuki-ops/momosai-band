/* キュー（プリセット）：シーン・色・メディア・重ねるシーンを 1 回の操作でまとめて切り替える。DOM は使わない。
 * 1 件 = { name, scene（'' = そのまま / シーンの id）, palette（-1 = そのまま / 番号）,
 *          media（'' = そのまま / 'on' 出す / 'off' 消す / メディアの一覧の id）, ovScene（'' = そのまま / 'off' / シーンの id） }。
 * 呼び出しは src/ui/cuesui.js（設定を持っているウィンドウで。2 画面のときは操作ウィンドウ）。 */
(function (VJ) {
  'use strict';

  const MAX = 9;

  /** 1 件の形を確かめる。使えなければ null */
  function clean(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const scene = typeof x.scene === 'string' && (x.scene === '' || (VJ.scenes && VJ.scenes.byId[x.scene] && x.scene !== 'test')) ? x.scene : '';
    const n = VJ.palettes ? VJ.palettes.length : 99;
    const palette = Number.isInteger(x.palette) && x.palette >= 0 && x.palette < n ? x.palette : -1;
    const media = typeof x.media === 'string' && /^(|on|off|[\w-]{1,40})$/.test(x.media) ? x.media : '';
    const ovScene = typeof x.ovScene === 'string' && (x.ovScene === '' || x.ovScene === 'off' || (VJ.scenes && VJ.scenes.byId[x.ovScene] && !VJ.scenes.byId[x.ovScene].hidden)) ? x.ovScene : '';
    return { name: String(typeof x.name === 'string' ? x.name : '').slice(0, 40), scene, palette, media, ovScene };
  }

  const cues = {
    MAX,
    clean,

    /** いまの状態から 1 件を作る（テストパターンは入れない） */
    capture(s, state, name) {
      const o = s.overlay || {};
      return clean({
        name: name || '',
        scene: state && state.sceneId && state.sceneId !== 'test' ? state.sceneId : '',
        palette: (state && Number.isInteger(state.paletteIdx) ? state.paletteIdx : s.paletteIdx) | 0,
        media: !s.overlayOn ? 'off' : o.mediaKind === 'lib' && o.libId ? o.libId : 'on',
        ovScene: s.ovSceneOn && o.scene ? o.scene : 'off',
      });
    },

    /** 設定の部分（メディア・重ねるシーン）を変える。シーン・色は ShowController で。変わったら true */
    applySettings(s, c) {
      const o = s.overlay;
      const before = JSON.stringify([s.overlayOn, s.ovSceneOn, o.mediaKind, o.libId, o.scene]);
      if (c.media === 'off') s.overlayOn = false;
      else if (c.media === 'on') s.overlayOn = true;
      else if (c.media && VJ.mediaLib && VJ.mediaLib.byId(s, c.media)) { o.mediaKind = 'lib'; o.libId = c.media; s.overlayOn = true; }
      if (c.ovScene === 'off') s.ovSceneOn = false;
      else if (c.ovScene) { o.scene = c.ovScene; s.ovSceneOn = true; }
      return JSON.stringify([s.overlayOn, s.ovSceneOn, o.mediaKind, o.libId, o.scene]) !== before;
    },

    /** 中身の短い説明（パネルのボタンの下に出す） */
    describe(s, c) {
      const t = (...a) => VJ.t(...a);
      const out = [];
      if (c.scene && VJ.scenes.byId[c.scene]) out.push(VJ.sceneName(VJ.scenes.byId[c.scene]));
      if (c.palette >= 0 && VJ.palettes[c.palette]) out.push(t(VJ.palettes[c.palette].name));
      if (c.media === 'off') out.push(t('メディア OFF'));
      else if (c.media === 'on') out.push(t('メディア ON'));
      else if (c.media) {
        const it = VJ.mediaLib.byId(s, c.media);
        out.push(it ? `${VJ.mediaLib.label(s, it.id)} ${it.name}` : t('（消えたメディア）'));
      }
      if (c.ovScene === 'off') out.push(t('重ね OFF'));
      else if (c.ovScene && VJ.scenes.byId[c.ovScene]) out.push(t('重ね：{0}', VJ.sceneName(VJ.scenes.byId[c.ovScene])));
      return out.join('・') || t('（何も変えない）');
    },
  };

  VJ.cues = cues;
})(globalThis.VJ = globalThis.VJ || {});
