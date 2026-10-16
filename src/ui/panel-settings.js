/* 設定パネル：設定の書き出し・読み込み・初期化と、設定をパネルに映し直す（バンドの切替・2 画面の受け取りでも使う）。
 * panel.js の続き（VJ.panel にメソッドを足す。中身は panel.js から移しただけ）。 */
(function (VJ) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OUT_DEFAULT = { rotate: 0, flipH: false, flipV: false, size: 1, x: 0, y: 0 };
  const t = (...a) => VJ.t(...a);
  const panel = VJ.panel;

  Object.assign(panel, {
    syncOutputUi() {
      const out = panel.app.settings.output;
      $('out-rotate').value = String(out.rotate);
      $('out-fliph').checked = !!out.flipH;
      $('out-flipv').checked = !!out.flipV;
      for (const [id, key] of [['out-size', 'size'], ['out-x', 'x'], ['out-y', 'y']]) {
        $(id).value = out[key];
        $(id).dispatchEvent(new Event('input'));
      }
    },

    exportSettings() {
      const blob = new Blob([VJ.storage.toJSON(panel.app.settings)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'momosai-vj-settings.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },

    async importSettings(e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        panel.replaceSettings(VJ.storage.fromFile(await f.text()));
        panel.app.ui.toast(t('設定を読み込みました'));
      } catch (err) {
        alert(t('設定ファイルを読み込めませんでした：') + err.message);
      }
      e.target.value = '';
    },

    /** 設定をまるごと入れ替えて画面に反映 */
    replaceSettings(ns) {
      // 入力欄の更新で何度も反映しないように、最後に 1 回だけ（2 画面のときは出力側へ送る回数も減る）
      panel._bulk = true;
      try { panel._replace(ns); } finally { panel._bulk = false; }
      panel.renderWarnings(); // 読み込んだ設定についての知らせ（YouTube・ニコニコをやめた など）
      panel.applyShow(true);
      VJ.storage.save(panel.app.settings);
    },

    /** シーンの切り替えの欄（種類と長さ）を設定に合わせる。長さの選択肢に無い秒数（設定ファイル）は足す */
    syncTransition() {
      const s = panel.app.settings, cf = +s.crossfade;
      $('opt-trans').value = cf < 0 ? 'auto' : cf === 0 ? 'cut' : s.transition || 'fade';
      if ($('opt-trans').selectedIndex < 0) $('opt-trans').value = 'fade';
      const sel = $('opt-xfade');
      if (cf > 0) {
        const v = String(Math.min(4, cf));
        if (!Array.from(sel.options).some((o) => o.value === v)) sel.add(new Option(t('{0} 秒', v), v));
        sel.value = v;
      } else if (sel.selectedIndex < 0) sel.value = '0.5';
      sel.disabled = cf <= 0;
    },

    /** フラッシュの上限・激しさの表示（設定ファイルの値が選択肢に無ければ足す）と、推奨を超えたときの警告 */
    syncFlashLimit() {
      const s = panel.app.settings, sel = $('opt-flashlimit');
      const v = String(s.flashLimit);
      if (!Array.from(sel.options).some((o) => o.value === v)) sel.add(new Option(t('1 秒に {0} 回', v), v));
      sel.value = v;
      sel.disabled = !!s.noFlash;
      $('flashlimit-warn').hidden = !!s.noFlash || !VJ.safety.overSafe(s.flashLimit);
      $('opt-intensity').value = String(s.intensity);
    },

    _replace(ns) {
      const s = panel.app.settings;
      for (const k of Object.keys(ns)) s[k] = ns[k];
      s.output = Object.assign({}, OUT_DEFAULT, s.output || {});
      $('band').value = s.bandName;
      $('setlist').value = s.setlistText;
      $('channel').value = s.channel;
      $('monitor').checked = s.monitor;
      $('opt-profile').value = VJ.profileById(s.profile).id;
      panel.renderProfile();
      for (const [id, key] of [['opt-auto', 'auto'], ['opt-autoflash', 'autoFlash'], ['opt-noflash', 'noFlash'], ['opt-toast', 'toast'],
        ['opt-latsq', 'latencySquare'], ['opt-autostart', 'autoStart'], ['opt-desync', 'desynchronized'], ['opt-speechtitle', 'speechTitle'],
        ['opt-palauto', 'paletteAuto']]) $(id).checked = !!s[key];
      panel.syncTransition();
      panel.syncFlashLimit();
      $('demo-kind').value = ['band', 'sing', 'speech'].includes(s.demoKind) ? s.demoKind : 'band';
      $('opt-lang').value = ['auto', 'ja', 'en'].includes(s.lang) ? s.lang : 'auto';
      if (VJ.i18n.resolve(s.lang) !== VJ.i18n.lang) panel.setLang(s.lang);
      for (const [id, key] of [['opt-sens', 'sensitivity'], ['opt-react', 'react'], ['opt-master', 'master'], ['opt-scale', 'maxScale'], ['opt-gate', 'gateDb']]) {
        $(id).value = s[key];
        $(id).dispatchEvent(new Event('input'));
      }
      $('opt-fps').value = String(s.fpsCap || 0);
      $('opt-palette').value = s.paletteIdx;
      panel.app.show.setPalette(s.paletteIdx | 0);
      $('opt-logomode').value = s.logoMode;
      $('opt-logocorner').value = s.logoCorner;
      for (let i = 0; i < 3; i++) $('msg-' + i).value = s.messages[i] || '';
      $('opt-countdown').value = s.countdownTo || '';
      panel.renderCustom();
      panel.renderAutoScenes();
      panel.renderSceneParams(true);
      panel.syncOverlay();
      if (VJ.cuesUI) VJ.cuesUI.render(true);
      VJ.sections.adopt(s); // 読み込んだ設定で拡張機能を使っていれば、パネルに出す
      VJ.sections.render();
      if ($('midi-map-box').open) panel.renderMidiMap();
      for (const [id, o, k] of [['net-on', 'net', 'enabled'], ['net-url', 'net', 'url'], ['osc-on', 'osc', 'enabled'], ['osc-host', 'osc', 'host'], ['osc-port', 'osc', 'port'], ['osc-rate', 'osc', 'rate'],
        ['dmx-on', 'dmx', 'enabled'], ['dmx-out', 'dmx', 'out'], ['dmx-host', 'dmx', 'host'], ['dmx-uni', 'dmx', 'universe'], ['dmx-type', 'dmx', 'type'], ['dmx-count', 'dmx', 'count'],
        ['dmx-start', 'dmx', 'start'], ['dmx-flash', 'dmx', 'flash'], ['dmx-max', 'dmx', 'max'], ['dmx-pulse', 'dmx', 'pulse']]) {
        const v = (s[o] || {})[k];
        if ($(id).type === 'checkbox') $(id).checked = !!v; else $(id).value = v === undefined ? '' : v;
      }
      for (const k of ['max', 'pulse']) $('dmx-' + k + '-v').textContent = Math.round($('dmx-' + k).value * 100) + '%';
      panel.renderIo();
      panel.renderLogo();
      panel.syncOutputUi();
    },

    /** キー操作などで変わった設定をパネルの表示に反映（出力ウィンドウからの通知など） */
    syncFromSettings() {
      const s = panel.app.settings;
      if (+$('opt-palette').value !== (s.paletteIdx | 0)) { $('opt-palette').value = s.paletteIdx; panel.renderCustom(); }
      for (const [id, key] of [['opt-sens', 'sensitivity'], ['opt-master', 'master']]) {
        if (+$(id).value !== +s[key]) { $(id).value = s[key]; $(id + '-v').textContent = key === 'master' ? Math.round(s[key] * 100) + '%' : (s[key] > 0 ? '+' : '') + s[key]; }
      }
      $('opt-auto').checked = !!s.auto;
      $('ov-on').checked = !!s.overlayOn;
      $('ovs-on').checked = !!s.ovSceneOn;
      // 取り込みを始めた・やめた（出力ウィンドウ・キーから）ときなど、メディアの種類が変わったら欄を合わせる
      const kind = s.overlay.mediaKind || 'image';
      const r = document.querySelector('input[name=ov-kind]:checked');
      if (!r || r.value !== kind || (kind === 'lib' && $('ov-lib').value !== s.overlay.libId)) panel.syncOverlay();
    },
  });
})(globalThis.VJ = globalThis.VJ || {});
