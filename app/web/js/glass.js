/* Liquid-glass layer: one WebGL canvas under the DOM.
 *
 * Same technique as FrontRow's frontrow-gpu-scene.c (GLASS_FRAGMENT etc.):
 * the wallpaper is the backdrop; it is drawn (at half size while animated),
 * copied to a full-size target, blurred once into a quarter-size copy, and
 * every glass tile samples those two textures: frosted body, refracted bevel
 * with a slight colour split, rim light from the top left, Fresnel glow and a
 * soft shadow. All coordinates are CSS px (the DOM's), `scale` is the render
 * resolution (1.25 measured: 60 fps on iPad Air 2, ~9 ms per frame).
 */
(function () {
  'use strict';

  const COMMON = `
precision highp float;
uniform vec3 tint; uniform float t; uniform float style;
uniform vec2 res;        // CSS px of the screen
uniform vec2 view;       // x: device px per CSS px for this target, y: target height in device px
vec2 logical() { return vec2(gl_FragCoord.x, view.y - gl_FragCoord.y) / view.x; }
float flow(vec2 uv) {
  vec2 q = uv;
  q += 0.30 * vec2(sin(uv.y * 2.3 + t * 0.21 + 1.3), sin(uv.x * 2.1 - t * 0.17 + 0.4));
  q += 0.12 * vec2(sin(q.y * 4.7 - t * 0.13 + 2.0), cos(q.x * 3.9 + t * 0.11));
  return 0.65 * sin((q.x * 1.2 + q.y * 1.9) * 4.2) + 0.35 * sin((q.x * -1.7 + q.y * 0.8) * 3.1 + 1.7);
}
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735); float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 aurora(vec2 p) {
  vec2 uv = p / res.y;
  vec3 sky = mix(tint * 0.18 + vec3(0.01, 0.02, 0.05), vec3(0.005, 0.01, 0.03), smoothstep(0.0, 1.0, uv.y));
  float sway = 0.10 * sin(uv.y * 3.0 + t * 0.22) + 0.04 * sin(uv.y * 8.0 - t * 0.35);
  float x = uv.x + sway;
  float rise = smoothstep(1.05, 0.25, uv.y) * smoothstep(-0.05, 0.25, uv.y);
  float c1 = pow(0.5 + 0.5 * sin(x * 11.0 + t * 0.15), 2.5);
  float c2 = pow(0.5 + 0.5 * sin(x * 6.5 - t * 0.11 + 1.9), 3.0);
  float glow = exp(-pow((uv.y - 0.62) * 3.2, 2.0));
  return sky + mix(tint, vec3(1.0), 0.2) * c1 * rise * 0.75 + hueShift(mix(tint, vec3(1.0), 0.15), 1.1) * c2 * rise * 0.55 + tint * glow * 0.25;
}
vec3 bubbles(vec2 p) {
  vec3 col = mix(tint * 0.55, vec3(0.05), 0.35);
  float k = res.y / 572.0;
  for (int i = 0; i < 6; i++) {
    float f = float(i);
    vec2 c = res * 0.5 + vec2(res.x * 0.40 * sin(f * 2.4 + t * 0.05 * (1.0 + f * 0.3)), res.y * 0.40 * cos(f * 1.7 + t * 0.04 * (1.0 + f * 0.2)));
    float r = (170.0 + 50.0 * sin(f * 3.1)) * k;
    float d = length(p - c) / r;
    float a = smoothstep(1.0, 0.7, d);
    vec3 bc = hueShift(mix(tint, vec3(1.0), 0.45), (f - 2.5) * 0.25);
    col = mix(col, bc * (0.85 + 0.25 * (1.0 - d)), a * 0.62);
  }
  return col;
}
vec3 liquid(vec2 p) {
  vec2 uv = p / res.y; float e = 2.0 / res.y;
  float h = flow(uv);
  vec2 g = vec2(flow(uv + vec2(e, 0.0)) - h, flow(uv + vec2(0.0, e)) - h) / e;
  vec3 n = normalize(vec3(-g * 0.10, 1.0));
  vec3 L = normalize(vec3(-0.45, -0.6, 0.65));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 18.0);
  vec3 deep = tint * 0.16 + vec3(0.015); vec3 lit = mix(tint, vec3(1.0), 0.22);
  float shade = (0.5 + 0.5 * h) * 0.35 + diff * 0.65;
  vec3 col = mix(deep, lit, shade * shade * (3.0 - 2.0 * shade));
  col += spec * 0.75 * mix(vec3(1.0), tint, 0.25);
  float vign = smoothstep(0.0, 0.9, length(p - res * 0.5) / (0.5 * length(res)));
  return col * (1.0 - 0.35 * vign);
}
vec3 solid(vec2 p) {
  return mix(mix(tint, vec3(1.0), 0.12), tint * 0.45, smoothstep(0.0, 1.0, length(p - res * vec2(0.3, 0.2)) / length(res)));
}
// style 4: photos, cover-fitted (fit = uv offset.xy, uv scale.zw), cross-faded by photoMix
uniform sampler2D photoA; uniform sampler2D photoB; uniform float photoMix; uniform vec4 fitA; uniform vec4 fitB;
vec3 photo(vec2 p) {
  vec2 q = p / res;
  vec3 a = texture2D(photoA, fitA.xy + q * fitA.zw).rgb;
  vec3 b = photoMix > 0.001 ? texture2D(photoB, fitB.xy + q * fitB.zw).rgb : a;
  return mix(a, b, photoMix);
}
// style 5: 弥散 mesh gradient, four soft colour fields drifting and blending
vec3 meshGrad(vec2 p) {
  vec2 uv = p / res;
  vec3 c0 = mix(tint, vec3(1.0), 0.15), c1 = hueShift(tint, 0.9), c2 = hueShift(tint, -0.8) * 0.9, c3 = tint * 0.35;
  vec2 a = vec2(0.25 + 0.18 * sin(t * 0.11), 0.30 + 0.15 * cos(t * 0.13));
  vec2 b = vec2(0.78 + 0.15 * cos(t * 0.09), 0.25 + 0.18 * sin(t * 0.12 + 1.0));
  vec2 c = vec2(0.70 + 0.18 * sin(t * 0.10 + 2.0), 0.80 + 0.12 * cos(t * 0.08));
  vec2 d = vec2(0.20 + 0.15 * cos(t * 0.12 + 3.0), 0.82 + 0.12 * sin(t * 0.10));
  vec2 asp = vec2(res.x / res.y, 1.0);
  float wa = exp(-5.0 * dot((uv - a) * asp, (uv - a) * asp)), wb = exp(-5.0 * dot((uv - b) * asp, (uv - b) * asp));
  float wc = exp(-5.0 * dot((uv - c) * asp, (uv - c) * asp)), wd = exp(-5.0 * dot((uv - d) * asp, (uv - d) * asp));
  vec3 col = (c0 * wa + c1 * wb + c2 * wc + c3 * wd + tint * 0.08) / (wa + wb + wc + wd + 0.08);
  return col;
}
// style 6: 丝绸 silk, layered glossy ribbons
vec3 silk(vec2 p) {
  vec2 uv = p / res.y;
  vec3 col = tint * 0.22 + vec3(0.02);
  for (int i = 0; i < 4; i++) {
    float f = float(i);
    float y = 0.25 + f * 0.17 + 0.07 * sin(uv.x * (2.2 + f * 0.6) + t * (0.10 + f * 0.03) + f * 1.7) + 0.03 * sin(uv.x * 5.3 - t * 0.07 + f);
    float d = uv.y - y;
    float band = exp(-d * d * 90.0);
    float sheen = pow(max(0.0, 1.0 - abs(d) * 9.0), 6.0);
    vec3 c = hueShift(mix(tint, vec3(1.0), 0.25 + 0.1 * f), (f - 1.5) * 0.18);
    col = mix(col, c * (0.55 + 0.45 * band), band * 0.75) + sheen * 0.25;
  }
  return col;
}
// style 7: 光环 halo, soft rings spreading from a slowly wandering centre
vec3 halo(vec2 p) {
  vec2 c = res * vec2(0.5 + 0.08 * sin(t * 0.07), 0.45 + 0.06 * cos(t * 0.05));
  float r = length(p - c) / res.y;
  float rings = 0.5 + 0.5 * sin(r * 18.0 - t * 0.6);
  float fall = exp(-r * 1.6);
  vec3 base = mix(tint * 0.18, tint * 0.06, smoothstep(0.0, 1.2, r));
  vec3 glow = mix(tint, vec3(1.0), 0.35) * fall;
  return base + glow * (0.35 + 0.35 * rings * rings);
}
// style 8: 星空 starfield, twinkling stars over a faint nebula in the theme colour
float hash2(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
vec3 stars(vec2 p) {
  vec2 uv = p / res.y;
  vec3 col = mix(vec3(0.01, 0.015, 0.04), tint * 0.12, smoothstep(1.0, 0.0, uv.y));
  float neb = 0.5 + 0.5 * sin(uv.x * 3.1 + t * 0.03) * sin(uv.y * 2.3 - t * 0.02 + 1.0);
  col += hueShift(tint, 0.6) * 0.10 * neb * neb;
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 60.0 : 130.0;
    vec2 g = uv * sc + vec2(t * 0.02 * float(layer + 1), 0.0);
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash2(id + float(layer) * 17.0);
    if (h > 0.93) {
      vec2 off = vec2(hash2(id + 3.1), hash2(id + 7.7)) - 0.5;
      float d = length(f - off * 0.6);
      float tw = 0.6 + 0.4 * sin(t * (1.5 + h * 3.0) + h * 40.0);
      col += vec3(0.9, 0.95, 1.0) * smoothstep(0.08, 0.0, d) * tw * (layer == 0 ? 1.0 : 0.6);
    }
  }
  return col;
}
vec3 wallpaper(vec2 p) {
  if (style > 7.5) return stars(p);
  if (style > 6.5) return halo(p);
  if (style > 5.5) return silk(p);
  if (style > 4.5) return meshGrad(p);
  if (style > 3.5) return photo(p);
  if (style > 2.5) return solid(p);
  if (style > 1.5) return bubbles(p);
  if (style > 0.5) return aurora(p);
  return liquid(p);
}
`;

  const WALL_FS = `void main() { gl_FragColor = vec4(wallpaper(logical()), 1.0); }`;
  const COPY_FS = `uniform sampler2D image; uniform vec2 dst; uniform float dim;
void main() { gl_FragColor = vec4(texture2D(image, gl_FragCoord.xy / dst).rgb * (1.0 - dim), 1.0); }`;
  const BLUR_FS = `uniform sampler2D image; uniform vec2 src;
void main() {
  vec2 c = gl_FragCoord.xy * 4.0; vec3 sum = vec3(0.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    sum += texture2D(image, (c + vec2(float(i), float(j)) * 12.0 * view.x) / src).rgb;
  gl_FragColor = vec4(sum / 9.0, 1.0);
}`;
  const GLASS_FS = `uniform vec4 rect; uniform float radius; uniform float bevel; uniform float refraction; uniform float alpha;
uniform vec3 fill; uniform float tintAmount; uniform float margin;
uniform sampler2D blurred; uniform sampler2D sharp;
vec2 screenUv(vec2 p) { return vec2(p.x, res.y - p.y) / res; }
vec3 frosted(vec2 p) { return 0.5 * (texture2D(blurred, screenUv(p + vec2(6.0, 5.0))).rgb + texture2D(blurred, screenUv(p - vec2(6.0, 5.0))).rgb); }
vec3 seen(vec2 p, float edge) { vec3 f = frosted(p); return edge > 0.01 ? mix(f, texture2D(sharp, screenUv(p)).rgb, edge) : f; }
void main() {
  vec2 p = logical();
  vec2 c = rect.xy + rect.zw * 0.5; vec2 dp = p - c;
  vec2 q = abs(dp) - (rect.zw * 0.5 - radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  if (d > 0.5) {
    float drop = min(7.0, margin * 0.4);
    vec2 qs = abs(dp - vec2(0.0, drop)) - (rect.zw * 0.5 - radius);
    float s = length(max(qs, 0.0)) + min(max(qs.x, qs.y), 0.0) - radius;
    float a = 0.30 * (1.0 - smoothstep(-4.0, margin - drop - 1.0, s)) * alpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a); return;
  }
  float e = -d; float b = 1.0 - clamp(e / bevel, 0.0, 1.0);
  vec2 sgn = vec2(dp.x < 0.0 ? -1.0 : 1.0, dp.y < 0.0 ? -1.0 : 1.0);
  vec2 n = sgn * ((q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));
  vec3 col;
  if (b > 0.01) {
    vec2 off = n * refraction * b * b * bevel; float edge = 0.55 * b * b;
    vec3 c1 = seen(p + off * 0.94, edge); vec3 c2 = seen(p + off * 1.08, edge);
    col = vec3(c1.r, 0.5 * (c1.g + c2.g), c2.b);
  } else {
    col = frosted(p);
  }
  col = mix(col, vec3(1.0), 0.12);
  col = mix(col, fill * (0.80 + 0.30 * dot(col, vec3(0.333))), tintAmount);
  col *= mix(1.0, 0.70, smoothstep(0.55, 0.95, dot(col, vec3(0.299, 0.587, 0.114))) * (1.0 - tintAmount));
  float top = 1.0 - clamp((p.y - rect.y) / rect.w, 0.0, 1.0);
  col += vec3(0.06) * top * top;
  float light = 0.5 + 0.5 * dot(n, normalize(vec2(-0.55, -0.85)));
  col += vec3((1.0 - smoothstep(0.0, 1.8, e)) * (0.18 + 0.55 * light) + b * b * b * (0.10 + 0.22 * light));
  float a = clamp(0.5 - d, 0.0, 1.0) * alpha;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(min(col, 1.0), a);
}`;
  // Glass glyphs (FrontRow GLASS_TEXT_FRAGMENT): the mask's R is the coverage blurred into a height,
  // A the coverage. The height's slope is the edge normal: the backdrop is refracted along it and the
  // rim catches light from the top left; a soft shadow falls below.
  const TEXT_FS = `uniform vec4 rect; uniform sampler2D mask; uniform vec2 texel; uniform float alpha;
uniform float refraction; uniform vec3 fill; uniform float tintAmount;
uniform sampler2D blurred; uniform sampler2D sharp;
vec2 screenUv(vec2 p) { return vec2(p.x, res.y - p.y) / res; }
vec3 frosted(vec2 p) { return 0.5 * (texture2D(blurred, screenUv(p + vec2(6.0, 5.0))).rgb + texture2D(blurred, screenUv(p - vec2(6.0, 5.0))).rgb); }
vec3 seen(vec2 p, float edge) { vec3 f = frosted(p); return edge > 0.01 ? mix(f, texture2D(sharp, screenUv(p)).rgb, edge) : f; }
void main() {
  vec2 p = logical();
  vec2 uv = (p - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 m = texture2D(mask, uv);
  if (m.a < 0.01) {
    float a = 0.30 * smoothstep(0.05, 0.6, texture2D(mask, uv - vec2(0.0, 6.0) * texel).r) * (1.0 - m.a) * alpha;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a); return;
  }
  vec2 g = vec2(texture2D(mask, uv + vec2(texel.x, 0.0)).r - texture2D(mask, uv - vec2(texel.x, 0.0)).r,
                texture2D(mask, uv + vec2(0.0, texel.y)).r - texture2D(mask, uv - vec2(0.0, texel.y)).r);
  float slope = length(g); vec2 n = -g / (slope + 1e-4);
  float b = clamp(slope * 4.0, 0.0, 1.0);
  vec2 off = n * refraction * b * 16.0;
  float edge = 0.6 * b;
  vec3 c1 = seen(p + off * 0.92, edge); vec3 c2 = seen(p + off * 1.1, edge);
  vec3 col = vec3(c1.r, 0.5 * (c1.g + c2.g), c2.b);
  col = mix(col, vec3(1.0), 0.16);
  col = mix(col, fill * (0.80 + 0.30 * dot(col, vec3(0.333))), tintAmount);
  col *= mix(1.0, 0.75, smoothstep(0.55, 0.95, dot(col, vec3(0.299, 0.587, 0.114))) * (1.0 - tintAmount));
  float light = 0.5 + 0.5 * dot(n, normalize(vec2(-0.55, -0.85)));
  col += vec3(b * b * (0.12 + 0.6 * light) + (1.0 - m.r) * 0.08);
  gl_FragColor = vec4(min(col, 1.0), m.a * alpha);
}`;
  const VS = 'attribute vec2 pos; uniform vec2 res; void main(){ gl_Position = vec4(pos.x / res.x * 2.0 - 1.0, 1.0 - pos.y / res.y * 2.0, 0.0, 1.0); }';

  function Glass(canvas, opts) {
    this.canvas = canvas;
    this.scale = opts.scale || 1.25;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.P = { wall: this.program(WALL_FS), copy: this.program(COPY_FS), blur: this.program(BLUR_FS), glass: this.program(GLASS_FS), text: this.program(TEXT_FS) };
    this.masks = new Map();
    this.vbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quadData = new Float32Array(8);
    this.wall = { style: 2, tint: [0.82, 0.72, 0.58], animated: true, speed: 1, dim: 0 };
    this.T = {};
    this.wallKey = '';
    this.t0 = performance.now();
    this.resize();
  }

  Glass.prototype.program = function (fs) {
    const gl = this.gl;
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, COMMON + fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  };

  Glass.prototype.target = function (w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  };

  Glass.prototype.resize = function () {
    const gl = this.gl;
    this.W = window.innerWidth || 1024;
    this.H = window.innerHeight || 768;
    const dw = Math.round(this.W * this.scale), dh = Math.round(this.H * this.scale);
    this.canvas.width = dw;
    this.canvas.height = dh;
    for (const k in this.T) { gl.deleteTexture(this.T[k].tex); gl.deleteFramebuffer(this.T[k].fbo); }
    this.T = {
      half: this.target(Math.max(1, dw >> 1), Math.max(1, dh >> 1)),
      wall: this.target(dw, dh),
      back: this.target(dw, dh),
      small: this.target(Math.max(1, dw >> 2), Math.max(1, dh >> 2)),
    };
    this.wallKey = '';
    this.backTime = null;
  };

  /** style: 0 liquid, 1 aurora, 2 bubbles, 3 solid. dim: 0..1 darkening of the visible wallpaper. */
  Glass.prototype.setWallpaper = function (w) { Object.assign(this.wall, w); this.wallKey = ''; this.backTime = null; };

  Glass.prototype.quad = function (x, y, w, h) {
    const gl = this.gl;
    this.quadData[0] = x; this.quadData[1] = y; this.quadData[2] = x + w; this.quadData[3] = y;
    this.quadData[4] = x; this.quadData[5] = y + h; this.quadData[6] = x + w; this.quadData[7] = y + h;
    gl.bufferData(gl.ARRAY_BUFFER, this.quadData, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  Glass.prototype.bind = function (tg) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.fbo : null);
    gl.viewport(0, 0, tg ? tg.w : this.canvas.width, tg ? tg.h : this.canvas.height);
  };

  /**
   * Photo wallpaper (style 4): a = current image, b = next, mix 0..1 (cross-fade).
   * Images are uploaded once per image object and cover-fitted to the screen.
   */
  Glass.prototype.setPhotos = function (a, b, mix) {
    const gl = this.gl;
    this.photoTex = this.photoTex || new Map();         // image._id -> {tex, w, h}
    const tex = (img) => {
      if (!img) return null;
      let t = this.photoTex.get(img._id);
      if (t) return t;
      const id = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, id);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      t = { tex: id, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
      this.photoTex.set(img._id, t);
      return t;
    };
    this.photoA = tex(a);
    this.photoB = b ? tex(b) : null;
    // drop textures no longer shown
    for (const [k, t] of this.photoTex) {
      if (t !== this.photoA && t !== this.photoB) { gl.deleteTexture(t.tex); this.photoTex.delete(k); }
    }
    this.photoMix = b ? mix : 0;
    this.wall.photoKey = (a ? a._id : '') + '|' + (b ? b._id : '') + '|' + this.photoMix.toFixed(3);
    this.wallKey = '';
    this.backTime = null;
  };

  Glass.prototype.fit = function (t) {
    // texture uv for screen uv q: cover the screen, centred (upright photos keep more of their top)
    if (!t) return [0, 0, 1, 1];
    const sa = this.W / this.H, ia = t.w / t.h;
    if (ia > sa) { const zw = sa / ia; return [(1 - zw) / 2, 0, zw, 1]; }
    const zh = ia / sa; return [0, (1 - zh) * (t.h > t.w ? 0.35 : 0.5), 1, zh];
  };

  Glass.prototype.use = function (pr, devW, devH, time) {
    const gl = this.gl;
    gl.useProgram(pr.p);
    if (pr.u.photoA && this.wall.style > 3.5 && this.photoA) {
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.photoA.tex);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, (this.photoB || this.photoA).tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(pr.u.photoA, 4); gl.uniform1i(pr.u.photoB, 5);
      gl.uniform1f(pr.u.photoMix, this.photoMix || 0);
      gl.uniform4fv(pr.u.fitA, this.fit(this.photoA));
      gl.uniform4fv(pr.u.fitB, this.fit(this.photoB || this.photoA));
    }
    gl.uniform2f(pr.u.res, this.W, this.H);
    gl.uniform2f(pr.u.view, devW / this.W, devH);
    if (pr.u.tint) gl.uniform3fv(pr.u.tint, this.wall.tint);
    if (pr.u.t) gl.uniform1f(pr.u.t, time);
    if (pr.u['style']) gl.uniform1f(pr.u['style'], this.wall.style);
  };

  Glass.prototype.copy = function (src, dst, dim) {
    const gl = this.gl, pr = this.P.copy;
    this.bind(dst);
    const dw = dst ? dst.w : this.canvas.width, dh = dst ? dst.h : this.canvas.height;
    this.use(pr, dw, dh, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(pr.u.image, 0);
    gl.uniform2f(pr.u.dst, dw, dh);
    gl.uniform1f(pr.u.dim, dim || 0);
    this.quad(0, 0, this.W, this.H);
  };

  /** Wallpaper time: a slow drift (1.2 units per second at speed 1). Frozen while the UI moves. */
  Glass.prototype.time = function (now) {
    if (!this.wall.animated) return 7;
    if (this.frozenAt != null) return this.frozenTime;
    return (now - this.t0 - (this.pausedMs || 0)) / 1000 * 1.2 * this.wall.speed;
  };

  /** Hold the wallpaper still (drags, springs): the cached backdrop and blur are reused. */
  Glass.prototype.freeze = function (on, now) {
    if (on && this.frozenAt == null) { this.frozenTime = this.time(now); this.frozenAt = now; }
    else if (!on && this.frozenAt != null) { this.pausedMs = (this.pausedMs || 0) + (now - this.frozenAt); this.frozenAt = null; }
  };

  /**
   * tiles: [{x, y, w, h, r, alpha, fill:[r,g,b], tintAmount, bevel}] in CSS px.
   */
  Glass.prototype.render = function (now, tiles) {
    const gl = this.gl, T = this.T;
    const time = this.time(now);
    gl.disable(gl.BLEND);
    // While frozen, back and small still hold this exact wallpaper: go straight to the screen.
    const reuse = this.backTime === time && (this.frozenAt != null || !this.wall.animated);
    this.lastPasses = reuse ? 'reuse' : 'full';
    if (reuse) { this.copy(T.back, null, this.wall.dim); this.drawTiles(tiles, time); return; }
    this.backTime = time;
    // 1. backdrop: half size each frame while animated, else a cached full-size copy
    if (this.wall.animated) {
      this.bind(T.half); this.use(this.P.wall, T.half.w, T.half.h, time); this.quad(0, 0, this.W, this.H);
      this.copy(T.half, T.back, 0);
    } else {
      const key = JSON.stringify(this.wall);
      if (key !== this.wallKey) {
        this.bind(T.wall); this.use(this.P.wall, T.wall.w, T.wall.h, time); this.quad(0, 0, this.W, this.H);
        this.wallKey = key;
      }
      this.copy(T.wall, T.back, 0);
    }
    // 2. one quarter-size blur, shared by every tile
    this.bind(T.small);
    this.use(this.P.blur, T.small.w, T.small.h, time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.back.tex);
    gl.uniform1i(this.P.blur.u.image, 0);
    gl.uniform2f(this.P.blur.u.src, T.back.w, T.back.h);
    this.quad(0, 0, this.W, this.H);
    // 3. backdrop on screen
    this.copy(T.back, null, this.wall.dim);
    // 4. glass
    this.drawTiles(tiles, time);
  };

  Glass.prototype.drawTiles = function (tiles, time) {
    const gl = this.gl, T = this.T;
    if (!tiles.length) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    let current = null;
    const use = (pr) => {
      if (current === pr) return;
      current = pr;
      this.use(pr, this.canvas.width, this.canvas.height, time);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.small.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.back.tex);
      gl.uniform1i(pr.u.blurred, 1);
      gl.uniform1i(pr.u.sharp, 2);
      gl.uniform1f(pr.u.refraction, pr === this.P.text ? 1.0 : 0.9);
    };
    for (const t of tiles) {
      if (t.alpha <= 0.01 || t.x > this.W || t.x + t.w < 0) continue;
      if (t.mask) {
        const pr = this.P.text;
        use(pr);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, t.mask.tex);
        gl.uniform1i(pr.u.mask, 3);
        gl.uniform2f(pr.u.texel, 1 / t.mask.pw, 1 / t.mask.ph);
        gl.uniform4f(pr.u.rect, t.x, t.y, t.w, t.h);
        gl.uniform1f(pr.u.alpha, t.alpha == null ? 1 : t.alpha);
        gl.uniform3fv(pr.u.fill, t.fill || [1, 1, 1]);
        gl.uniform1f(pr.u.tintAmount, t.tintAmount || 0);
        this.quad(t.x, t.y, t.w, t.h + 10);
        continue;
      }
      const pr = this.P.glass;
      use(pr);
      const margin = Math.min(28, Math.max(6, Math.min(t.w, t.h) * 0.5));
      gl.uniform4f(pr.u.rect, t.x, t.y, t.w, t.h);
      gl.uniform1f(pr.u.radius, Math.min(t.r, t.w / 2, t.h / 2));
      gl.uniform1f(pr.u.bevel, t.bevel || Math.min(18, t.r * 0.6));
      gl.uniform1f(pr.u.alpha, t.alpha == null ? 1 : t.alpha);
      gl.uniform3fv(pr.u.fill, t.fill || [1, 1, 1]);
      gl.uniform1f(pr.u.tintAmount, t.tintAmount || 0);
      gl.uniform1f(pr.u.margin, margin);
      this.quad(t.x - margin, t.y - margin, t.w + 2 * margin, t.h + 2 * margin);
    }
  };

  /**
   * A glass-text mask for `draw(ctx, w, h)` (white on transparent, CSS px, w x h box).
   * R = coverage blurred into a height, A = coverage; cached by key (LRU of 24).
   * Drawn at the render scale so the glyph edges match the canvas.
   */
  Glass.prototype.textMask = function (key, w, h, draw, soft) {
    const hit = this.masks.get(key);
    if (hit) { this.masks.delete(key); this.masks.set(key, hit); return hit; }
    const k = this.scale, pw = Math.ceil(w * k), ph = Math.ceil(h * k);
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    ctx.fillStyle = '#fff';
    draw(ctx, w, h);
    const img = ctx.getImageData(0, 0, pw, ph).data;
    const n = pw * ph;
    let a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = img[i * 4 + 3] / 255;
    const r = Math.max(1, Math.round((soft || 5) * k));
    let hgt = a;
    for (let pass = 0; pass < 2; pass++) hgt = boxBlur(hgt, pw, ph, r);
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.round(Math.min(1, hgt[i] * 1.6) * 255);
      out[i * 4 + 3] = Math.round(a[i] * 255);
    }
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pw, ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    const m = { tex, pw, ph };
    this.masks.set(key, m);
    if (this.masks.size > 24) {
      const oldest = this.masks.keys().next().value;
      gl.deleteTexture(this.masks.get(oldest).tex);
      this.masks.delete(oldest);
    }
    return m;
  };

  // Separable box blur (radius r), edges clamped.
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / d;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / d;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  window.Glass = Glass;
})();
