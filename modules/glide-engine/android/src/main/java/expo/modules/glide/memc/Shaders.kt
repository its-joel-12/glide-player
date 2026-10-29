package expo.modules.glide.memc

/**
 * GLSL ES 3.00 programs for the motion engine. All passes draw one full-screen triangle.
 * Texture coordinates are shared by every texture (frames, luma pyramid, motion fields),
 * and motion vectors are stored in those coordinates (fractions of the picture), so a vector
 * means the same thing at every pyramid level.
 */
internal object Shaders {
  const val VERTEX = """#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
"""

  /** Copies the incoming frame, which the pipeline recycles as soon as we hand it back. */
  const val COPY = """#version 300 es
precision highp float;
uniform sampler2D uSrc;
in vec2 vUV;
out vec4 o;
void main() {
  o = texture(uSrc, vUV);
}
"""

  /** Downscales to luma: from the colour frame (uIsLuma = 0) or from the previous pyramid level. */
  const val LUMA = """#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDT;
uniform int uIsLuma;
in vec2 vUV;
out vec4 o;
float L(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  return uIsLuma == 1 ? c.r : dot(c.rgb, vec3(0.299, 0.587, 0.114));
}
void main() {
  vec2 d = uDT * 0.25;
  float y = 0.25 * (L(vUV + vec2(-d.x, -d.y)) + L(vUV + vec2(d.x, -d.y)) + L(vUV + vec2(-d.x, d.y)) + L(vUV + vec2(d.x, d.y)));
  o = vec4(y, y, y, 1.0);
}
"""

  /**
   * Block matching. One output texel is one block of the picture. It tests a few predictors
   * (the coarser level's answer and its neighbours, last frame's answer, zero motion) and then
   * searches a small window around the best one. Output: xy = vector, z = match error.
   */
  const val MOTION = """#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uPrev;
uniform sampler2D uTemp;
uniform vec2 uLT;
uniform vec2 uFT;
uniform int uR;
uniform int uHasPrev;
uniform int uHasTemp;
uniform float uStep;
uniform float uLambda;
out vec4 o;
float a[64];
float sad(vec2 c, vec2 v) {
  float s = 0.0;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 off = (vec2(float(i), float(j)) - 3.5) * uLT;
      s += abs(a[j * 8 + i] - texture(uB, c + off + v).r);
    }
  }
  return s * (1.0 / 64.0);
}
void main() {
  vec2 c = gl_FragCoord.xy * uFT;
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      a[j * 8 + i] = texture(uA, c + (vec2(float(i), float(j)) - 3.5) * uLT).r;
    }
  }
  vec2 best = vec2(0.0);
  float bc = sad(c, best);
  if (uHasPrev == 1) {
    vec2 cand[5];
    cand[0] = texture(uPrev, c).xy;
    cand[1] = texture(uPrev, c + vec2(uFT.x, 0.0)).xy;
    cand[2] = texture(uPrev, c - vec2(uFT.x, 0.0)).xy;
    cand[3] = texture(uPrev, c + vec2(0.0, uFT.y)).xy;
    cand[4] = texture(uPrev, c - vec2(0.0, uFT.y)).xy;
    for (int k = 0; k < 5; k++) {
      float e = sad(c, cand[k]);
      if (e < bc) { bc = e; best = cand[k]; }
    }
  }
  if (uHasTemp == 1) {
    vec2 v = texture(uTemp, c).xy;
    float e = sad(c, v);
    if (e < bc) { bc = e; best = v; }
  }
  vec2 base = best;
  float bcost = bc;
  for (int dy = -uR; dy <= uR; dy++) {
    for (int dx = -uR; dx <= uR; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec2 d = vec2(float(dx), float(dy)) * uStep;
      vec2 v = base + d * uLT;
      float e = sad(c, v) + uLambda * length(d);
      if (e < bcost) { bcost = e; best = v; }
    }
  }
  o = vec4(best, bcost, 1.0);
}
"""

  /** 3x3 vector median (each component separately) to remove stray vectors. */
  const val MEDIAN = """#version 300 es
precision highp float;
uniform sampler2D uF;
uniform vec2 uFT;
out vec4 o;
#define s2(a,b) t = a; a = min(t, b); b = max(t, b);
#define mn3(a,b,c) s2(a,b) s2(a,c)
#define mx3(a,b,c) s2(b,c) s2(a,c)
#define mnmx3(a,b,c) mx3(a,b,c) s2(a,b)
#define mnmx4(a,b,c,d) s2(a,b) s2(c,d) s2(a,c) s2(b,d)
#define mnmx5(a,b,c,d,e) s2(a,b) s2(c,d) mn3(a,c,e) mx3(b,d,e)
#define mnmx6(a,b,c,d,e,f) s2(a,d) s2(b,e) s2(c,f) mn3(a,b,c) mx3(d,e,f)
vec2 S(vec2 c, float x, float y) { return texture(uF, c + vec2(x, y) * uFT).xy; }
void main() {
  vec2 c = gl_FragCoord.xy * uFT;
  vec2 t;
  vec2 v0 = S(c, -1.0, -1.0);
  vec2 v1 = S(c, 0.0, -1.0);
  vec2 v2 = S(c, 1.0, -1.0);
  vec2 v3 = S(c, -1.0, 0.0);
  vec2 v4 = S(c, 0.0, 0.0);
  vec2 v5 = S(c, 1.0, 0.0);
  vec2 v6 = S(c, -1.0, 1.0);
  vec2 v7 = S(c, 0.0, 1.0);
  vec2 v8 = S(c, 1.0, 1.0);
  mnmx6(v0, v1, v2, v3, v4, v5)
  mnmx5(v1, v2, v3, v4, v6)
  mnmx4(v2, v3, v4, v7)
  mnmx3(v3, v4, v8)
  o = vec4(v4, texture(uF, c).z, 1.0);
}
"""

  /**
   * Draws one output frame at time uT between frame A (0) and frame B (1).
   * uMode: 0 = show A, 1 = cross-fade, 2 = motion-compensated.
   * MEMC tries three explanations per pixel (forward motion, backward motion, no motion),
   * weights them by how well A and B agree, and falls back to the nearer real frame
   * where none of them fits (occlusions, scene cuts).
   */
  const val OUTPUT = """#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uF;
uniform sampler2D uW;
uniform float uT;
uniform float uSplit;
uniform float uLineW;
uniform float uFlowMax;
uniform int uMode;
uniform int uHasF;
uniform int uVec;
uniform vec2 uRes;
in vec2 vUV;
out vec4 o;
float diff(vec3 a, vec3 b) { vec3 d = abs(a - b); return (d.r + d.g + d.b) * 0.3333; }
vec3 memc(vec2 p) {
  float t = uT;
  float s = 1.0 - uT;
  vec2 v = texture(uF, p).xy;
  v = texture(uF, p - t * v).xy;
  v = texture(uF, p - t * v).xy;
  vec2 w = texture(uW, p).xy;
  w = texture(uW, p - s * w).xy;
  w = texture(uW, p - s * w).xy;
  vec3 a1 = texture(uA, p - t * v).rgb;
  vec3 b1 = texture(uB, p + s * v).rgb;
  vec3 a2 = texture(uA, p + t * w).rgb;
  vec3 b2 = texture(uB, p - s * w).rgb;
  vec3 a0 = texture(uA, p).rgb;
  vec3 b0 = texture(uB, p).rgb;
  float e1 = diff(a1, b1);
  float e2 = diff(a2, b2);
  float e0 = diff(a0, b0);
  float w1 = 1.0 / (e1 * e1 + 2e-4);
  float w2 = 1.0 / (e2 * e2 + 2e-4);
  float w0 = 0.8 / (e0 * e0 + 2e-4);
  vec3 c = (mix(a1, b1, t) * w1 + mix(a2, b2, t) * w2 + mix(a0, b0, t) * w0) / (w0 + w1 + w2);
  float f = smoothstep(0.14, 0.34, min(min(e1, e2), e0));
  return mix(c, mix(a0, b0, smoothstep(0.25, 0.75, t)), f);
}
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  vec2 p = vUV;
  bool left = uSplit >= 0.0 && p.x < uSplit;
  vec3 col;
  if (left || uMode == 0) {
    col = texture(uA, p).rgb;
  } else if (uMode == 1 || uHasF == 0) {
    col = mix(texture(uA, p).rgb, texture(uB, p).rgb, uT);
  } else {
    col = memc(p);
  }
  if (uVec == 1 && uHasF == 1 && !left) {
    vec2 px = texture(uF, p).xy * uRes;
    float m = clamp(length(px) / uFlowMax, 0.0, 1.0);
    vec3 fc = mix(vec3(0.5), hue(atan(px.y, px.x) / 6.2831853 + 0.5), m);
    col = mix(col, fc, 0.6);
  }
  if (uSplit >= 0.0 && abs(p.x - uSplit) < uLineW) col = vec3(1.0);
  o = vec4(col, texture(uA, p).a);
}
"""
}
