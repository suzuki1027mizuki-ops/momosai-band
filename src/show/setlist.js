/* セットリストの解析。1 行 1 曲：
 *   曲名 | シーン(番号か名前、カンマ区切りで複数) | パレット | notitle | m:メディア（一覧の名前か番号。m:off で出さない）
 *   @band バンド名   @end 終演の文字   # コメント
 * 全角の「｜」「、」「１」などもそのまま受け付ける。 */
(function (VJ) {
  'use strict';

  function normalize(s) {
    return s
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[｜￨│]/g, '|')
      .replace(/[、，]/g, ',')
      .replace(/＃/g, '#')
      .replace(/＠/g, '@')
      .replace(/　/g, ' ');
  }

  function parse(text) {
    const out = { band: null, end: null, songs: [], errors: [] };
    const lines = String(text || '').split(/\r?\n/);
    lines.forEach((raw, i) => {
      const lineNo = i + 1;
      const line = normalize(raw).trim();
      if (!line || line.startsWith('#')) return;
      if (/^@band\b/i.test(line)) { out.band = line.replace(/^@band\s*/i, '').trim() || null; return; }
      if (/^@end\b/i.test(line)) { out.end = line.replace(/^@end\s*/i, '').trim() || null; return; }
      if (line.startsWith('@')) { out.errors.push({ line: lineNo, msg: VJ.t('不明な指定: {0}', line.split(/\s/)[0]) }); return; }
      const parts = line.split('|').map((s) => s.trim());
      // 行頭の曲番号（「1.」「01)」「3 」など）を外す。「22才の別れ」のような曲名は残す
      const title = parts[0].replace(/^\d{1,3}\s*[.)．:：]\s*|^\d{1,3}\s+/, '').trim();
      if (!title) { out.errors.push({ line: lineNo, msg: VJ.t('曲名がありません') }); return; }
      const song = { title, scenes: [], palette: null, notitle: false, media: '', line: lineNo };
      if (parts[1]) {
        for (const tok of parts[1].split(',')) {
          if (!tok.trim()) continue;
          const id = VJ.scenes.resolve(tok);
          if (id) song.scenes.push(id);
          else out.errors.push({ line: lineNo, msg: VJ.t('シーン「{0}」は見つかりません（1〜9・s1〜s9・0 か名前）', tok.trim()) });
        }
      }
      if (parts[2]) {
        const p = VJ.resolvePalette(parts[2]);
        if (p === null) out.errors.push({ line: lineNo, msg: VJ.t('パレット「{0}」は見つかりません', parts[2]) });
        else song.palette = p;
      }
      for (const flag of parts.slice(3)) {
        const mm = /^(?:m|media|メディア)\s*[:：]\s*(.+)$/i.exec(flag);
        if (/^notitle$/i.test(flag)) song.notitle = true;
        else if (mm) song.media = mm[1].trim().slice(0, 60);
        else if (flag) out.errors.push({ line: lineNo, msg: VJ.t('不明なオプション「{0}」', flag) });
      }
      out.songs.push(song);
    });
    return out;
  }

  /** 1 曲目より前のコメント行（# …）。表で編集して書き直すときに残す */
  function headComments(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = normalize(raw).trim();
      if (!line || line.startsWith('@')) continue;
      if (!line.startsWith('#')) break;
      out.push(raw.trim());
    }
    return out;
  }

  /** 解析結果 → 文字（表で編集したとき）。シーンはキー（1〜9・s1〜s9・0）、パレットは英字の名前で書く */
  function serialize(p, comments) {
    const lines = [];
    if (p.band) lines.push('@band ' + p.band);
    for (const c of comments || []) lines.push(c);
    p.songs.forEach((x, i) => lines.push(songLine(x, i)));
    if (p.end) lines.push('@end ' + p.end);
    return lines.join('\n');
  }

  /** 1 曲を 1 行に（k は 0 から始まる順番） */
  function songLine(s, k) {
    // 区切りの「|」と改行は曲名に入れられない。行頭に番号を付ける（数字で始まる曲名が番号と間違われないように）
    const title = String(s.title || '').replace(/[|｜￨│]/g, '/').replace(/[\r\n]+/g, ' ').trim() || '?';
    const sc = (s.scenes || []).map((id) => (VJ.scenes.byId[id] ? VJ.scenes.byId[id].key : id)).join(',');
    const pal = s.palette !== null && s.palette !== undefined && VJ.palettes[s.palette] ? VJ.palettes[s.palette].id : '';
    const media = String(s.media || '').replace(/[|｜￨│\r\n]/g, ' ').trim();
    const opts = [];
    if (s.notitle) opts.push('notitle');
    if (media) opts.push('m:' + media);
    const parts = [`${k + 1}. ${title}`];
    if (sc || pal || opts.length) parts.push(sc);
    if (pal || opts.length) parts.push(pal);
    return parts.concat(opts).join(' | ');
  }

  /**
   * 表で編集した曲の並び → 文字。元の文字を行ごとに残し、曲の行だけを入れ替える
   * （コメント・@band / @end・読めなかった行・空行はそのまま。曲の途中のコメントも残る）。
   * songs: [{ title, scenes, palette, notitle, line（元の行番号。新しい曲は null）, dirty（編集した） }]
   * 編集していない曲は元の行をそのまま使う（読めなかったシーン名なども消さない。行頭の番号だけ付け直す）。
   */
  function rewrite(text, songs) {
    const lines = String(text || '').split(/\r?\n/);
    const slots = parse(text).songs.map((x) => x.line - 1);
    const fmt = (x, k) => {
      if (x.dirty || !x.line || !lines[x.line - 1]) return songLine(x, k);
      const raw = lines[x.line - 1];
      return /^\s*[0-9０-９]{1,3}\s*[.)．:：]/.test(raw) ? raw.replace(/^(\s*)[0-9０-９]{1,3}(\s*[.)．:：])/, `$1${k + 1}$2`) : raw;
    };
    const out = lines.slice();
    const n = Math.min(slots.length, songs.length);
    for (let k = 0; k < n; k++) out[slots[k]] = fmt(songs[k], k);
    // 減った曲の行を消す（後ろから。前の行の位置がずれないように）
    for (let k = slots.length - 1; k >= songs.length; k--) out.splice(slots[k], 1);
    if (songs.length > slots.length) {
      // 増えた曲は最後の曲の次に。曲が無ければ @end の前か末尾に
      let at = slots.length ? slots[slots.length - 1] + 1 : out.findIndex((l) => /^@end\b/i.test(normalize(l).trim()));
      if (at < 0) {
        at = out.length;
        while (at > 0 && !out[at - 1].trim()) at--;
      }
      out.splice(at, 0, ...songs.slice(slots.length).map((x, j) => fmt(x, slots.length + j)));
    }
    return out.join('\n');
  }

  VJ.setlist = { parse, normalize, serialize, headComments, rewrite, songLine };
})(globalThis.VJ = globalThis.VJ || {});
