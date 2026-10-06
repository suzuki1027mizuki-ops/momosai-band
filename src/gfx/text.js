/* 文字（バンド名・曲名）を Canvas2D で描いてテクスチャにする。
 * 文字が変わったときだけ転送し、作ったテクスチャはキャッシュする（曲名は事前に作っておける）。 */
(function (VJ) {
  'use strict';

  const W = 2048, H = 512;
  const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", sans-serif';

  class TextLayer {
    constructor(gl) {
      this.gl = gl;
      this.canvas = document.createElement('canvas');
      this.canvas.width = W;
      this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d');
      this.cache = new Map();
      this.aspect = W / H;
    }

    /** lines = { main, sub } のテクスチャを返す（キャッシュ） */
    get(main, sub) {
      const key = (sub || '') + '\u0000' + (main || '');
      let e = this.cache.get(key);
      if (e) {
        this.cache.delete(key);
        this.cache.set(key, e); // LRU
        return e;
      }
      e = this._make(main || '', sub || '');
      this.cache.set(key, e);
      while (this.cache.size > 8) {
        const k = this.cache.keys().next().value;
        this.gl.deleteTexture(this.cache.get(k).tex);
        this.cache.delete(k);
      }
      return e;
    }

    _make(main, sub) {
      const c = this.ctx, gl = this.gl;
      c.clearRect(0, 0, W, H);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      const fit = (text, maxSize, maxW) => {
        let size = maxSize;
        c.font = `900 ${size}px ${FONT}`;
        const w = c.measureText(text).width;
        if (w > maxW) size = Math.max(24, Math.floor((size * maxW) / w));
        c.font = `900 ${size}px ${FONT}`;
        return size;
      };
      const draw = (text, y, size) => {
        c.shadowColor = 'rgba(0,0,0,0.85)';
        c.shadowBlur = size * 0.12;
        c.lineWidth = Math.max(4, size * 0.07);
        c.strokeStyle = 'rgba(0,0,0,0.7)';
        c.strokeText(text, W / 2, y);
        c.shadowBlur = 0;
        c.fillStyle = '#ffffff';
        c.fillText(text, W / 2, y);
      };
      if (sub) {
        const s2 = fit(sub, 96, W * 0.9);
        draw(sub, H * 0.2, s2);
        const s1 = fit(main, 250, W * 0.92);
        draw(main, H * 0.62, s1);
      } else {
        const s1 = fit(main, 300, W * 0.92);
        draw(main, H * 0.52, s1);
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex, main, sub };
    }

    /** WebGL コンテキストが失われたとき（テクスチャは無効になっている） */
    reset(gl) {
      this.gl = gl;
      this.cache.clear();
    }
  }

  TextLayer.ASPECT = W / H;
  VJ.gfx = VJ.gfx || {};
  VJ.gfx.TextLayer = TextLayer;
})(globalThis.VJ = globalThis.VJ || {});
