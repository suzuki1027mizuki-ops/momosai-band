/* WebGL2 の小さな補助（全画面三角形・プログラム・テクスチャ・FBO）。 */
(function (VJ) {
  'use strict';

  const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  function shaderLog(gl, sh, src, name) {
    const log = gl.getShaderInfoLog(sh) || '';
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    let ctx = '';
    if (m) {
      const ln = +m[1];
      ctx = lines.slice(Math.max(0, ln - 3), ln + 2).map((l, i) => `${Math.max(1, ln - 2) + i}: ${l}`).join('\n');
    }
    return `[${name}] ${log}\n${ctx}`;
  }

  class Program {
    constructor(gl, fsSrc, name) {
      this.gl = gl;
      this.name = name;
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VS);
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSrc);
      gl.compileShader(fs);
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      this.prog = p;
      this.vs = vs;
      this.fs = fs;
      this.src = fsSrc;
      this.ready = false;
    }

    /** リンク結果を確認（KHR_parallel_shader_compile がある場合は完了を待ってから呼ぶ） */
    finish() {
      const gl = this.gl;
      if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
        let msg = '';
        if (!gl.getShaderParameter(this.fs, gl.COMPILE_STATUS)) msg = shaderLog(gl, this.fs, this.src, this.name);
        else msg = `[${this.name}] link: ${gl.getProgramInfoLog(this.prog)}`;
        throw new Error(msg);
      }
      this.uniforms = {};
      const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
      let unit = 0;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(this.prog, i);
        const name = info.name.replace(/\[0\]$/, '');
        const u = { loc: gl.getUniformLocation(this.prog, info.name), type: info.type, size: info.size };
        if (info.type === gl.SAMPLER_2D) u.unit = unit++;
        this.uniforms[name] = u;
      }
      this.ready = true;
      return this;
    }

    complete(ext) {
      return !ext || this.gl.getProgramParameter(this.prog, ext.COMPLETION_STATUS_KHR);
    }

    use() {
      this.gl.useProgram(this.prog);
      return this;
    }

    has(name) { return !!this.uniforms[name]; }

    /** 型に応じて uniform を設定（存在しない名前は無視） */
    set(name, v) {
      const u = this.uniforms[name];
      if (!u) return this;
      const gl = this.gl;
      switch (u.type) {
        case gl.FLOAT: if (u.size > 1) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
        default: break;
      }
      return this;
    }

    tex(name, texture) {
      const u = this.uniforms[name];
      if (!u) return this;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + u.unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u.loc, u.unit);
      return this;
    }

    dispose() {
      const gl = this.gl;
      gl.deleteProgram(this.prog);
      gl.deleteShader(this.vs);
      gl.deleteShader(this.fs);
    }
  }

  function texture(gl, w, h, o) {
    o = o || {};
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, o.internal || gl.RGBA8, w, h, 0, o.format || gl.RGBA, o.type || gl.UNSIGNED_BYTE, o.data || null);
    const f = o.filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.minFilter || f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.wrap || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.wrap || gl.CLAMP_TO_EDGE);
    return t;
  }

  /** 描画先（FBO + テクスチャ） */
  function target(gl, w, h, hdr) {
    const internal = hdr ? gl.RGBA16F : gl.RGBA8;
    const type = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const tex = texture(gl, w, h, { internal, type });
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h, hdr, ok };
  }

  function disposeTarget(gl, t) {
    if (!t) return;
    gl.deleteFramebuffer(t.fb);
    gl.deleteTexture(t.tex);
  }

  VJ.gfx = VJ.gfx || {};
  Object.assign(VJ.gfx, { VS, Program, texture, target, disposeTarget });
})(globalThis.VJ = globalThis.VJ || {});
