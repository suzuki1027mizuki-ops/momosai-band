/* 診断 HUD（D キー）。1 秒に 4 回だけ更新。 */
(function (VJ) {
  'use strict';
  const pad = (s, n) => String(s).padEnd(n);
  const bar = (v, n) => {
    n = n || 12;
    const k = Math.max(0, Math.min(n, Math.round(v * n)));
    return '█'.repeat(k) + '·'.repeat(n - k);
  };
  const ms = (v) => (v === null || v === undefined ? '—' : (v * 1000).toFixed(1) + 'ms');

  const hud = {
    el: null,
    visible: false,
    last: 0,
    lamps: { k: 0, s: 0, h: 0, a: 0, b: 0 },

    init(el) { hud.el = el; },
    toggle(force) {
      hud.visible = force === undefined ? !hud.visible : !!force;
      hud.el.hidden = !hud.visible;
      hud.last = 0;
    },

    note(f, t) {
      const fl = f.onsetFlags, L = hud.lamps;
      if (fl & 1) L.k = t;
      if (fl & 2) L.s = t;
      if (fl & 4) L.h = t;
      if (fl & 8) L.a = t;
      if (fl & 32) L.b = t;
    },

    update(app, f, perfNow) {
      hud.note(f, perfNow);
      if (!hud.visible || perfNow - hud.last < 250) return;
      hud.last = perfNow;
      hud.el.textContent = hud.text(app, f, perfNow);
    },

    /** 診断の文字列（出力ウィンドウから操作ウィンドウへも送る） */
    text(app, f, perfNow) {
      if (!f || f.level === undefined) return '';
      const s = app.show.state, d = app.engine.diagnostics(), r = app.renderer.info(), m = app.engine.meter;
      const L = hud.lamps;
      const lamp = (k, c) => (perfNow - L[k] < 300 ? `[${c}]` : ` ${c.toLowerCase()} `);
      const song = app.show.currentSong();
      const prof = VJ.profileById(app.settings.profile);
      const lines = [
        `MOMOSAI VJ ${VJ.version}  ${VJ.buildTime}`,
        `シーン  ${pad(s.sceneId, 8)} ${s.pending ? '→ ' + s.pending.id + '（待機）' : ''}`,
        `パレット ${VJ.palettes[s.paletteIdx].name}   オート ${s.auto ? 'ON' : 'OFF'}   ロック ${s.locked ? 'ON' : 'OFF'}   暗転 ${s.blackout ? 'ON' : 'OFF'}`,
        `曲     ${song ? 'M' + (s.songIdx + 1) + ' ' + song.title : s.endState ? '（終演）' : '（開演前）'}`,
        `感度 ${s.sens > 0 ? '+' : ''}${s.sens}   明るさ ${Math.round(s.master * 100)}%   動き ${Math.round(app.show.react() * 100)}%   タイプ ${prof.name}`,
        '',
        `入力   ${d.status}  ${d.device}  ${d.channels}ch  ${d.sampleRate}Hz`,
        `メーター L ${m.l.toFixed(1)}dB  R ${m.mono ? '—' : m.r.toFixed(1) + 'dB'}  ${performance.now() - m.clip < 2000 ? '⚠ クリップ' : ''}`,
        `ヒット ${lamp('k', 'K')}${lamp('s', 'S')}${lamp('h', 'H')}${lamp('a', 'A')}${lamp('b', 'B')}  K${f.kickN} S${f.snareN} H${f.hatN} A${f.accentN} I${f.impactN}`,
        `テンポ ${f.bpm ? f.bpm.toFixed(1) + ' BPM' : '—'}  確度 ${(f.beatConf || 0).toFixed(2)}${f.tempoManual ? '  （タップ）' : ''}   ${f.melodic ? 'ドラムなしモード' : 'ドラムモード'}`,
        `level ${bar(f.level)} low ${bar(f.low, 8)} mid ${bar(f.mid, 8)} high ${bar(f.high, 8)}`,
        `盛上り ${bar(f.intensity)} ${f.active ? '' : '（無音）'}`,
        '',
        `描画   ${r.fps.toFixed(0)}fps  倍率 ${r.scale.toFixed(2)}  ${r.sceneSize.join('x')} → ${r.size.join('x')}`,
        `GPU    ${(r.gpu || '').slice(0, 60)}${r.software ? '  ⚠ ソフトウェア描画' : ''}`,
        `遅延   base ${ms(d.baseLatency)}  out ${ms(d.outputLatency)}  track ${ms(d.trackLatency)}  塊 ${d.chunk}/${d.chunkMax}`,
        `整合   一致 ${d.align}  不一致 ${d.alignMiss}  飛び ${d.gaps}  再起動 ${d.restarts}  再接続 ${d.reconnects}`,
        `安全   フラッシュ却下 ${app.show.limiter.denied}  エラー ${app.errors}  ${r.failed.length ? 'シェーダ失敗: ' + r.failed.join(',') : ''}`,
        `保護   スリープ防止 ${VJ.guard.wakeLockOk ? 'ON' : 'OFF'}  Esc取込 ${VJ.guard.kbLockOk ? 'ON' : 'OFF'}  MIDI ${VJ.midi && VJ.midi.inputs.length ? VJ.midi.inputs.join(',') : '—'}  画面 ${VJ.link ? VJ.link.role : 'solo'}`,
      ];
      return lines.join('\n');
    },
  };

  VJ.hud = hud;
})(globalThis.VJ = globalThis.VJ || {});
