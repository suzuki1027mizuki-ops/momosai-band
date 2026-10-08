/* セットリストの解析。1 行 1 曲：
 *   曲名 | シーン(番号か名前、カンマ区切りで複数) | パレット | notitle
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
      const song = { title, scenes: [], palette: null, notitle: false, line: lineNo };
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
        if (/^notitle$/i.test(flag)) song.notitle = true;
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
    p.songs.forEach((s, i) => {
      // 区切りの「|」と改行は曲名に入れられない。行頭に番号を付ける（数字で始まる曲名が番号と間違われないように）
      const title = String(s.title || '').replace(/[|｜￨│]/g, '/').replace(/[\r\n]+/g, ' ').trim() || '?';
      const sc = (s.scenes || []).map((id) => (VJ.scenes.byId[id] ? VJ.scenes.byId[id].key : id)).join(',');
      const pal = s.palette !== null && s.palette !== undefined && VJ.palettes[s.palette] ? VJ.palettes[s.palette].id : '';
      const parts = [`${i + 1}. ${title}`];
      if (sc || pal || s.notitle) parts.push(sc);
      if (pal || s.notitle) parts.push(pal);
      if (s.notitle) parts.push('notitle');
      lines.push(parts.join(' | '));
    });
    if (p.end) lines.push('@end ' + p.end);
    return lines.join('\n');
  }

  VJ.setlist = { parse, normalize, serialize, headComments };
})(globalThis.VJ = globalThis.VJ || {});
