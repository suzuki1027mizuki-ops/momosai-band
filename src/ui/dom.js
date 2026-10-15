/* 画面の部品を HTML の文字列で作るときの道具。
 *   html`<b>${名前}</b>` … ${} に入れた値は必ずエスケープする（利用者が入れた文字でタグや属性が作られないように）。
 *                          html`…` で作ったもの・その配列は、そのまま入る（入れ子にできる）。null・undefined・false は空。
 *   VJ.dom.set(el, html`…`) … 要素の中身にする（html`…` でない文字列は、文字としてエスケープして入れる）。
 * 手で esc() を付けて回る書き方だと、1 か所付け忘れるだけで、名前に入れた <img onerror=…> が動いてしまうため。
 * 注意：属性の値は必ず "…" で囲む（囲まないと、空白で属性を足せてしまう）。 */
(function (VJ) {
  'use strict';

  class SafeHtml {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const piece = (v) => (v instanceof SafeHtml ? v.s : Array.isArray(v) ? v.map(piece).join('') : v === null || v === undefined || v === false ? '' : esc(v));

  /** タグ付きテンプレート：値をエスケープしてつなぐ */
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += piece(vals[i]) + strings[i + 1];
    return new SafeHtml(out);
  }

  VJ.dom = {
    html,
    esc,
    SafeHtml,
    /** 要素の中身を html`…` にする。html`…` どうしを + でつなぐと、ただの文字列になって文字として出てしまうので、
     *  そのときは raw(…) で包む。包み忘れ（タグを含むただの文字列）はコンソールのエラーにして、テストで見つける */
    set(el, h) {
      if (typeof h === 'string' && h.includes('<')) console.error('VJ.dom.set: html`…` でない文字列にタグがあります（文字として出します）: ' + h.slice(0, 60));
      el.innerHTML = piece(h);
    },
    /** html`…` どうしを + でつないだ文字列を、もう一度「安全な HTML」として扱う。利用者が入れた文字そのものには使わない */
    raw(s) { return new SafeHtml(String(s)); },
  };
})(globalThis.VJ = globalThis.VJ || {});
