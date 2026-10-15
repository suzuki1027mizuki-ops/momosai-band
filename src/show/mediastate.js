/* 曲のメディア（セットリストの m:…）と、操作者の選択のどちらを出すか。DOM は使わない（単体テストから呼べる）。
 * ShowController が出来事ごとに下の関数を呼ぶ。状態は 3 つだけ：
 *   manual  この曲の途中で、操作者がメディアを選んだ（次の曲までは、曲の指定より操作者の選択を出す）
 *   sigAt   曲が始まった・再開したときの「設定のメディア」の目印（パネル・キューで変わったら、操作者が選んだとみなす）
 *   songOn  消してあったメディアを、曲の指定で出した（指定の無い曲・m:off の曲・終演・開演前・バンドの切替で、消した状態に戻す。
 *           その間に操作者が出す・消す・選ぶをしたら戻さない）
 * 出来事と結果（状態 → 変わったあと）：
 *   曲が始まる      manual=false・sigAt=いまの目印。曲が出す指定で、メディアが消えていたら出して songOn=true。そうでなければ戻す（restore）
 *   終演・開演前・バンドの切替   restore：songOn なら消して songOn=false
 *   再開            manual=false・sigAt=いまの目印（曲のメディアは、ここからの設定の変更で「操作者が選んだ」と見る）
 *   設定を反映      songOn なのに消えている（パネルで消した）→ songOn=false
 *   出すものを決める  目印が sigAt から変わっていたら manual=true・songOn=false。manual でなければ曲の指定 → 一覧から選んだもの → 設定のメディア
 *   操作者が選ぶ    manual=true・songOn=false（一覧の ▶・キュー・カメラを開く）
 *   O（出す・消す）  m:off の曲で、出ている扱いなのに何も出ていない → manual=true（1 回で設定のメディアを出す）。そうでなければ set(!overlayOn)
 *   出す・消す      songOn=false。出すとき m:off の曲なら manual=true */
(function (/** @type {VJNamespace} */ VJ) {
  'use strict';

  const mediaState = {
    create() { return { manual: false, sigAt: undefined, songOn: false }; },

    /** 設定のメディア（どれを出すか）の目印。出す・消す（overlayOn）は含めない */
    sig(settings) {
      const o = settings.overlay || {};
      return [o.mediaKind, o.libId, (o.image || '').length, (o.image || '').slice(-16), o.videoKey, o.cameraId, !!o.cameraMirror].join('|');
    },

    /** 曲が始まった。song：セットリストの曲（media：m:… の指定） */
    songStart(st, settings, song) {
      st.manual = false;
      st.sigAt = mediaState.sig(settings);
      const sm = song && song.media ? VJ.mediaLib.find(settings, song.media) : null;
      if (sm && !sm.off) {
        if (!settings.overlayOn) { settings.overlayOn = true; st.songOn = true; }
      } else mediaState.restore(st, settings);
    },

    /** 曲の指定で出していたメディアを、もとの「消している」状態に戻す（操作者が触っていなければ） */
    restore(st, settings) {
      if (!st.songOn) return;
      st.songOn = false;
      settings.overlayOn = false;
    },

    /** 前回の続きから再開した */
    resume(st, settings) {
      st.manual = false;
      st.sigAt = mediaState.sig(settings);
    },

    /** 設定を反映した（パネル・読み込み） */
    settingsApplied(st, settings) {
      if (st.songOn && !settings.overlayOn) st.songOn = false;
    },

    /** 操作者がメディアを選んだ：この曲の m:… より優先する（次の曲で戻る） */
    override(st) {
      st.manual = true;
      st.songOn = false;
    },

    /** いま出すメディア：曲の指定（m:…）→ メディアの一覧から選んだもの → 設定のメディア。
     *  { kind: image / video / capture / camera / '', image（data URL）, key（保存場所の鍵）, cameraId, mirror, name, song } */
    effective(st, settings, song) {
      const o = settings.overlay || {};
      if (!st.manual && st.sigAt !== undefined && mediaState.sig(settings) !== st.sigAt) mediaState.override(st);
      let it = song && song.media && !st.manual ? VJ.mediaLib.find(settings, song.media) : null;
      if (it && it.off) return { kind: '', song: true };
      const fromSong = !!it;
      if (!it && o.mediaKind === 'lib') it = VJ.mediaLib.byId(settings, o.libId);
      if (it) return { kind: it.kind, image: '', key: it.key || '', cameraId: it.cameraId || '', mirror: !!it.mirror, name: it.name, song: fromSong };
      if (o.mediaKind === 'lib') return { kind: '' }; // 一覧から消えた
      const kind = o.mediaKind || 'image';
      return { kind, image: o.image || '', key: kind === 'video' ? o.videoKey || '' : '', cameraId: o.cameraId || '', mirror: !!o.cameraMirror, name: '', song: false };
    },

    /** O キー：出す・消す。m:off の曲で何も出ていないときは、ON のままでも 1 回で設定のメディアを出す。
     *  戻り値：'shown'（m:off の曲で出した）/ 'on' / 'off' / ''（変わらない） */
    toggle(st, settings, song) {
      const e = settings.overlayOn ? mediaState.effective(st, settings, song) : null;
      if (e && e.song && !e.kind) { mediaState.override(st); return 'shown'; }
      return mediaState.set(st, settings, song, !settings.overlayOn);
    },

    /** 出す・消す（スマホ・OSC・キューの「出す」も）。m:off の曲でも、出すときは設定のメディアを出す。
     *  戻り値：'on' / 'off'（変わった）/ ''（変わらない） */
    set(st, settings, song, on) {
      on = !!on;
      st.songOn = false; // 操作者が決めた：次の曲でも、そのままにする
      if (on) {
        const e = mediaState.effective(st, settings, song);
        if (e.song && !e.kind) st.manual = true;
      }
      if (on === !!settings.overlayOn) return '';
      settings.overlayOn = on;
      return on ? 'on' : 'off';
    },
  };

  VJ.mediaState = mediaState;
})(globalThis.VJ = globalThis.VJ || {});
