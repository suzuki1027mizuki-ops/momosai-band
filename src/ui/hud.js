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
      const t = VJ.t, on = (v) => (v ? 'ON' : 'OFF');
      const lines = [
        `MOMOSAI VJ ${VJ.version}  ${VJ.buildTime}`,
        t('シーン  {0} {1}', pad(s.sceneId, 8), s.pending ? '→ ' + s.pending.id + t('（待機）') : ''),
        t('パレット {0}   オート {1}   ロック {2}   暗転 {3}', t(VJ.palettes[s.paletteIdx].name), on(s.auto), on(s.locked), on(s.blackout)),
        t('曲     {0}', song ? 'M' + (s.songIdx + 1) + ' ' + song.title : s.endState ? t('（終演）') : t('（開演前）')),
        t('感度 {0}   明るさ {1}%   動き {2}%   タイプ {3}', (s.sens > 0 ? '+' : '') + s.sens, Math.round(s.master * 100), Math.round(app.show.react() * 100), VJ.profileName(prof)),
        '',
        t('入力   {0}  {1}  {2}ch  {3}Hz', d.status, d.device, d.channels, d.sampleRate),
        t('メーター L {0}dB  R {1}  {2}', m.l.toFixed(1), m.mono ? '—' : m.r.toFixed(1) + 'dB', performance.now() - m.clip < 2000 ? t('⚠ クリップ') : ''),
        t('ヒット {0}  K{1} S{2} H{3} A{4} I{5}', lamp('k', 'K') + lamp('s', 'S') + lamp('h', 'H') + lamp('a', 'A') + lamp('b', 'B'), f.kickN, f.snareN, f.hatN, f.accentN, f.impactN),
        t('テンポ {0}  確度 {1}{2}   {3}', f.bpm ? f.bpm.toFixed(1) + ' BPM' : '—', (f.beatConf || 0).toFixed(2), f.tempoManual ? t('  （タップ）') : '', f.melodic ? t('ドラムなしモード') : t('ドラムモード')),
        t('声     {0}  有声 {1}  話し声 {2} {3}  音程変化 {4}', f.voiced > 0.5 && f.note ? pad(VJ.dsp.noteName(f.note), 4) + Math.round(f.pitchHz) + 'Hz' : '—       ', bar(f.voiced || 0, 6), f.speech ? t('検出中') : '—', bar(f.speechScore || 0, 6), f.noteN || 0),
        `level ${bar(f.level)} low ${bar(f.low, 8)} mid ${bar(f.mid, 8)} high ${bar(f.high, 8)}`,
        t('盛上り {0} {1}', bar(f.intensity), f.active ? '' : t('（無音）')),
        '',
        t('描画   {0}fps  倍率 {1}  {2} → {3}', r.fps.toFixed(0), r.scale.toFixed(2), r.sceneSize.join('x'), r.size.join('x')),
        `GPU    ${(r.gpu || '').slice(0, 60)}${r.software ? t('  ⚠ ソフトウェア描画') : ''}`,
        t('遅延   base {0}  out {1}  track {2}  塊 {3}/{4}', ms(d.baseLatency), ms(d.outputLatency), ms(d.trackLatency), d.chunk, d.chunkMax),
        t('整合   一致 {0}  不一致 {1}  飛び {2}  再起動 {3}  再接続 {4}', d.align, d.alignMiss, d.gaps, d.restarts, d.reconnects),
        t('安全   フラッシュ却下 {0}  エラー {1}  {2}', app.show.limiter.denied, app.errors, r.failed.length ? t('シェーダ失敗: ') + r.failed.join(',') : ''),
        t('保護   スリープ防止 {0}  Esc取込 {1}  MIDI {2}  画面 {3}', on(VJ.guard.wakeLockOk), on(VJ.guard.kbLockOk), VJ.midi && VJ.midi.inputs.length ? VJ.midi.inputs.join(',') : '—', VJ.link ? VJ.link.role : 'solo'),
      ];
      return lines.join('\n');
    },
  };

  VJ.hud = hud;
})(globalThis.VJ = globalThis.VJ || {});
