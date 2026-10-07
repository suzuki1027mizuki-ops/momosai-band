/* 表示の言語（日本語 / 英語）。
 *   t('シーン: {0}', name)  … 英語のときは辞書（i18n-en.js）の訳。{0} {1} … は引数で置き換える
 *   画面の文字（index.html と、あとから入る部品）は、要素の文字がそのまま辞書にあれば自動で置き換える。
 *   文の中に太字などが混ざる要素は data-i18n-html を付け、中身（HTML）ごと置き換える。
 * 元の日本語は覚えておくので、言語を何度切り替えても戻せる。 */
(function (VJ) {
  'use strict';

  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const origText = new WeakMap();
  const origHtml = new WeakMap();
  const origAttr = new WeakMap();

  const i18n = {
    lang: 'ja',
    en: {},

    /** 設定（'auto' / 'ja' / 'en'）→ 実際の言語 */
    resolve(setting) {
      if (setting === 'ja' || setting === 'en') return setting;
      const l = (globalThis.navigator && (navigator.language || (navigator.languages || [])[0])) || 'ja';
      return /^ja/i.test(l) ? 'ja' : 'en';
    },

    t(s, ...args) {
      let r = s;
      if (i18n.lang === 'en') {
        const v = i18n.en[s];
        if (v !== undefined) r = v;
      }
      return args.length ? r.replace(/\{(\d)\}/g, (m, i) => (args[i] === undefined ? '' : String(args[i]))) : r;
    },

    /** 英語の訳 → 元の日本語（英語のときにコードが書いた文字を、元の文として覚えるため） */
    _ja(v) {
      if (!i18n._rev || i18n._revN !== i18n.en) {
        i18n._rev = new Map();
        i18n._revN = i18n.en;
        for (const k of Object.keys(i18n.en)) if (!i18n._rev.has(i18n.en[k])) i18n._rev.set(i18n.en[k], k);
      }
      const key = v.trim();
      const ja = i18n._rev.get(key);
      return ja === undefined ? v : v.replace(key, ja);
    },

    /** 辞書にあれば訳す（無ければそのまま）。前後の空白は残す */
    _tx(orig) { return i18n.lang === 'en' ? i18n._en(orig) : orig; },
    _en(orig) {
      const key = orig.trim();
      if (!key) return orig;
      const v = i18n.en[key] !== undefined ? i18n.en[key] : i18n.en[norm(key)];
      return v === undefined ? orig : orig.replace(key, v);
    },

    _skip(el) {
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        if (e.hasAttribute('data-i18n-skip') || e.tagName === 'TEXTAREA' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') return true;
      }
      return false;
    },

    /** root 以下を今の言語にする */
    translateDom(root) {
      if (!root || typeof document === 'undefined') return;
      const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [];
      for (const el of els) {
        if (i18n._skip(el)) continue;
        if (el.hasAttribute('data-i18n-html')) {
          if (!origHtml.has(el)) origHtml.set(el, el.innerHTML);
          const o = origHtml.get(el);
          const v = i18n.lang === 'en' ? i18n.en[norm(o)] : undefined;
          const want = v === undefined ? o : v;
          if (el.innerHTML !== want) el.innerHTML = want;
        }
        for (const a of ATTRS) {
          if (!el.hasAttribute(a)) continue;
          let m = origAttr.get(el);
          if (!m) origAttr.set(el, (m = {}));
          const cur = el.getAttribute(a);
          if (m[a] === undefined || (cur !== m[a] && cur !== i18n._en(m[a]))) m[a] = i18n._ja(cur); // コードが書き換えた
          el.setAttribute(a, i18n._tx(m[a]));
        }
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      for (const n of nodes) {
        const p = n.parentElement;
        if (!p || i18n._skip(p) || p.closest('[data-i18n-html]')) continue;
        // あとからコードが書き換えた文字は、それを元の文として覚え直す
        const known = origText.get(n);
        if (known === undefined || (n.nodeValue !== known && n.nodeValue !== i18n._en(known))) origText.set(n, i18n._ja(n.nodeValue));
        const o = origText.get(n);
        const want = i18n.lang === 'en' ? i18n._tx(o) : o;
        if (n.nodeValue !== want) n.nodeValue = want;
      }
    },

    /** 言語を切り替えて画面全体に反映 */
    setLang(lang) {
      i18n.lang = lang === 'en' ? 'en' : 'ja';
      if (typeof document === 'undefined') return;
      document.documentElement.lang = i18n.lang;
      i18n.translateDom(document.body);
    },

    /** あとから入る部品（パネルの一覧・トーストなど）も訳す */
    observe(root) {
      if (typeof MutationObserver === 'undefined' || i18n._mo) return;
      i18n._mo = new MutationObserver((list) => {
        if (i18n.lang !== 'en') return;
        for (const m of list) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1) i18n.translateDom(n);
            else if (n.nodeType === 3 && n.parentElement) i18n.translateDom(n.parentElement);
          }
        }
      });
      i18n._mo.observe(root, { childList: true, subtree: true });
    },
  };

  VJ.i18n = i18n;
  VJ.t = i18n.t;
  /** シーン・音楽のタイプの表示名（英語のときは英語名） */
  VJ.sceneName = (d) => (!d ? '' : i18n.lang === 'en' ? d.name || d.nameJa : d.nameJa);
  VJ.profileName = (p) => (i18n.lang === 'en' && p.nameEn ? p.nameEn : p.name);
  VJ.profileDesc = (p) => (i18n.lang === 'en' && p.descEn ? p.descEn : p.desc);
})(globalThis.VJ = globalThis.VJ || {});
