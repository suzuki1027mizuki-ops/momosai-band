/* シーンの登録と、全シーン共通の GLSL ヘッダ（uniform と補助関数）。
 * シーンは全画面フラグメントシェーダ 1 本 + JS 側の小さな update（積分値やカット切替）。 */
(function (VJ) {
  'use strict';

  const HEADER = `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;

uniform vec2 u_res;
uniform float u_time, u_dt, u_sceneTime, u_quality, u_idle;
uniform float u_level, u_low, u_mid, u_high, u_intensity, u_centroid;
uniform float u_kick, u_snare, u_hat, u_accent;
uniform float u_kickN, u_snareN, u_hatN, u_accentN;
uniform vec2 u_kickEv[8];
uniform vec2 u_snareEv[8];
uniform vec2 u_accentEv[8];
uniform float u_travel;
uniform float u_beat, u_beatPhase, u_bar, u_bpm; // 拍のパルス（拍で 1 → 減衰）・拍の位相・小節の位相
// 声：音程 0..1（C2〜C6。無声の間は直前の値）・有声 0..1・音名 0..1（C〜B）・話し声 0..1・音程の変わり目の回数
uniform float u_pitch, u_voiced, u_pitchClass, u_speech, u_noteN;
uniform vec4 u_param; // シーンごとの調整（設定パネルのスライダー。各シーンの params の順）
uniform sampler2D u_pitchHist; // 音程の履歴（約 2.7 秒・128 点）
uniform vec3 u_pal[4];
uniform sampler2D u_spec;
uniform sampler2D u_specSlow;
uniform sampler2D u_wave;
uniform sampler2D u_prev;
uniform sampler2D u_title;
uniform vec4 u_titleRect;

#define PI 3.14159265359
#define TAU 6.28318530718

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// パレット 4 色を循環補間
vec3 pal(float t) {
  t = fract(t) * 4.0;
  int i = int(t);
  float f = smoothstep(0.0, 1.0, fract(t));
  return mix(u_pal[i], u_pal[(i + 1) % 4], f);
}
// 中心原点・高さ 1 の座標
vec2 uvc() { return (gl_FragCoord.xy - 0.5 * u_res) / u_res.y; }
float spec(float x) { return texture(u_spec, vec2(clamp(x, 0.0, 1.0) * (63.0 / 64.0) + 0.5 / 64.0, 0.5)).r; }
float specS(float x) { return texture(u_specSlow, vec2(clamp(x, 0.0, 1.0) * (63.0 / 64.0) + 0.5 / 64.0, 0.5)).r; }
float wave(float x) { return texture(u_wave, vec2(clamp(x, 0.0, 1.0), 0.5)).r * 2.0 - 1.0; }
// 音程の履歴：x = 0（約 2.7 秒前）〜 1（今）。0..1、無声のところは -1
float pitchHist(float x) {
  float v = texture(u_pitchHist, vec2(clamp(x, 0.0, 1.0) * (127.0 / 128.0) + 0.5 / 128.0, 0.5)).r;
  return v < 0.5 / 255.0 ? -1.0 : (v * 255.0 - 1.0) / 254.0;
}
// 無音時のゆっくりした呼吸（止まって見えないように）
float idle() { return u_idle * (0.5 + 0.5 * sin(u_time * 1.3)); }
`;

  const scenes = {
    HEADER,
    list: [],
    byId: {},
    register(def) {
      def.feedback = !!def.feedback;
      // 調整できる値（最大 4 つ → シェーダの u_param.xyzw、update の fx.param[0..3]）。{ id, name, min, max, def, step }
      def.params = (def.params || []).slice(0, 4).map((p) => Object.assign({ min: 0, max: 1, def: 0.5, step: 0.01 }, p));
      def.cost = def.cost || 1;
      def.init = def.init || function () {};
      def.update = def.update || function () {};
      if (scenes.byId[def.id]) scenes.list = scenes.list.filter((s) => s.id !== def.id);
      scenes.byId[def.id] = def;
      scenes.list.push(def);
      return def;
    },
    source(def) { return HEADER + '\n' + def.frag; },
    /** シーンの調整値（設定に無ければ既定値）。out は長さ 4 */
    paramValues(def, saved, out) {
      out = out || new Float32Array(4);
      for (let i = 0; i < 4; i++) {
        const p = def.params[i];
        const v = saved && typeof saved[i] === 'number' && isFinite(saved[i]) ? saved[i] : p ? p.def : 0.5;
        out[i] = p ? Math.max(p.min, Math.min(p.max, v)) : v;
      }
      return out;
    },
    /** キー（'0'〜'9'・Shift の段は 's1'〜's9'）やシーン名・番号の文字列から ID を引く */
    resolve(token) {
      const t = String(token).trim().toLowerCase();
      if (!t) return null;
      for (const s of scenes.list) {
        if (s.key === t || s.id === t || (s.nameJa && s.nameJa === token.trim()) || (s.aliases && s.aliases.includes(t))) return s.id;
      }
      return null;
    },
  };

  VJ.scenes = scenes;
})(globalThis.VJ = globalThis.VJ || {});
