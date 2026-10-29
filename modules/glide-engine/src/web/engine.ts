/**
 * Web (WebGL 2) port of the Android MotionEngine: luma pyramid, hierarchical block matching in
 * both directions, vector median, and motion-compensated rendering. Same shaders, same plan.
 */
import * as S from './shaders';

export type Quality = 'fast' | 'balanced' | 'detailed';
const LONG_SIDE: Record<Quality, number> = { fast: 480, balanced: 640, detailed: 960 };

type Tex = { id: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };
type Prog = { p: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> };

export type Frame = {
  color: Tex;
  pyramid: Tex[];
  forward: Tex | null;
  backward: Tex | null;
  /** media time, seconds */
  t: number;
  serial: number;
  /** serial of the frame the fields were estimated against, or -1 */
  fieldsFrom: number;
};

export type Rect = { x: number; y: number; w: number; h: number };

export class WebMotionEngine {
  readonly gl: WebGL2RenderingContext;
  motionSupported: boolean;
  width = 0;
  height = 0;
  private progs: Record<'copy' | 'luma' | 'motion' | 'median' | 'output', Prog>;
  private slots: Frame[] = [];
  private scratch: Tex[] = [];
  private levels: [number, number][] = [];
  private plan: [number, number, number, number][] = [];
  private fieldW = 0;
  private fieldH = 0;
  private quality: Quality | null = null;
  private serials = 0;
  private next = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly slotCount = 4,
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.motionSupported = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const vs = this.shader(gl.VERTEX_SHADER, S.VERTEX);
    const make = (fs: string): Prog => {
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed');
      return { p, loc: new Map() };
    };
    this.progs = { copy: make(S.COPY), luma: make(S.LUMA), motion: make(S.MOTION), median: make(S.MEDIAN), output: make(S.OUTPUT) };
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  private shader(type: number, src: string) {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
    return s;
  }

  private target(w: number, h: number, format: number): Tex {
    const gl = this.gl;
    const id = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, id);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, id, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(id);
      throw new Error('framebuffer incomplete');
    }
    return { id, fbo, w, h };
  }

  private del(t: Tex | null) {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.id);
  }

  private use(name: keyof WebMotionEngine['progs']) {
    const pr = this.progs[name];
    this.gl.useProgram(pr.p);
    const loc = (n: string) => {
      if (!pr.loc.has(n)) pr.loc.set(n, this.gl.getUniformLocation(pr.p, n));
      return pr.loc.get(n) ?? null;
    };
    const gl = this.gl;
    return {
      i: (n: string, v: number) => gl.uniform1i(loc(n), v),
      f: (n: string, v: number) => gl.uniform1f(loc(n), v),
      f2: (n: string, x: number, y: number) => gl.uniform2f(loc(n), x, y),
      tex: (n: string, unit: number, t: WebGLTexture) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(loc(n), unit);
      },
    };
  }

  private drawTo(t: Tex) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Sets up textures for w×h frames. Returns true when it (re)allocated, which drops history. */
  configure(w: number, h: number, q: Quality): boolean {
    if (w === this.width && h === this.height && q === this.quality && this.slots.length) return false;
    this.releaseTextures();
    const gl = this.gl;
    this.width = w;
    this.height = h;
    this.quality = q;
    const scale = Math.min(1, LONG_SIDE[q] / Math.max(w, h));
    let lw = Math.max(16, Math.round(w * scale));
    let lh = Math.max(16, Math.round(h * scale));
    const count = Math.min(5, Math.max(3, 1 + Math.floor(Math.log2(Math.max(lw, lh) / 48))));
    this.levels = [];
    for (let i = 0; i < count; i++) {
      this.levels.push([lw, lh]);
      lw = Math.max(4, (lw + 1) >> 1);
      lh = Math.max(4, (lh + 1) >> 1);
    }
    this.fieldW = (this.levels[0][0] + 7) >> 3;
    this.fieldH = (this.levels[0][1] + 7) >> 3;
    const top = count - 1;
    this.plan = [[top, 4, 1, 0.003]];
    for (let l = top - 1; l >= 1; l--) this.plan.push([l, 2, 1, 0.003]);
    this.plan.push([0, 3, 0.5, 0.002]);

    if (this.motionSupported) {
      try {
        this.scratch = [this.target(this.fieldW, this.fieldH, gl.RGBA16F), this.target(this.fieldW, this.fieldH, gl.RGBA16F)];
      } catch {
        this.motionSupported = false;
        this.scratch = [];
      }
    }
    const fields = this.motionSupported;
    this.slots = Array.from({ length: this.slotCount }, () => ({
      color: this.target(w, h, gl.RGBA8),
      pyramid: this.levels.map(([a, b]) => this.target(a, b, gl.R8)),
      forward: fields ? this.target(this.fieldW, this.fieldH, gl.RGBA16F) : null,
      backward: fields ? this.target(this.fieldW, this.fieldH, gl.RGBA16F) : null,
      t: 0,
      serial: 0,
      fieldsFrom: -1,
    }));
    this.next = 0;
    return true;
  }

  get fieldSize() {
    return `${this.fieldW} × ${this.fieldH}`;
  }

  /** Uploads a frame into a slot not in [busy] and builds its pyramid. */
  ingest(source: TexImageSource, t: number, busy: Set<Frame>): Frame {
    const gl = this.gl;
    let slot = this.slots[this.next];
    for (let i = 0; i < this.slots.length && busy.has(slot); i++) {
      this.next = (this.next + 1) % this.slots.length;
      slot = this.slots[this.next];
    }
    this.next = (this.next + 1) % this.slots.length;
    gl.bindTexture(gl.TEXTURE_2D, slot.color.id);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const l = this.use('luma');
    slot.pyramid.forEach((dst, k) => {
      l.tex('uSrc', 0, k === 0 ? slot.color.id : slot.pyramid[k - 1].id);
      l.f2('uDT', 1 / dst.w, 1 / dst.h);
      l.i('uIsLuma', k === 0 ? 0 : 1);
      this.drawTo(dst);
    });
    slot.t = t;
    slot.serial = ++this.serials;
    slot.fieldsFrom = -1;
    return slot;
  }

  estimate(a: Frame, b: Frame) {
    if (!this.motionSupported || !b.forward || !b.backward) return;
    for (const dir of [0, 1]) {
      const from = dir ? b : a;
      const to = dir ? a : b;
      const temporal = a.fieldsFrom >= 0 ? (dir ? a.backward : a.forward) : null;
      let k = 0;
      let hasPrev = false;
      const m = this.use('motion');
      for (const [lvl, r, step, lambda] of this.plan) {
        const out = this.scratch[k];
        const other = this.scratch[1 - k];
        const [lw, lh] = this.levels[lvl];
        m.tex('uA', 0, from.pyramid[lvl].id);
        m.tex('uB', 1, to.pyramid[lvl].id);
        m.tex('uPrev', 2, other.id);
        m.tex('uTemp', 3, (temporal ?? other).id);
        m.f2('uLT', 1 / lw, 1 / lh);
        m.f2('uFT', 1 / this.fieldW, 1 / this.fieldH);
        m.i('uR', r);
        m.f('uStep', step);
        m.f('uLambda', lambda);
        m.i('uHasPrev', hasPrev ? 1 : 0);
        m.i('uHasTemp', temporal ? 1 : 0);
        this.drawTo(out);
        hasPrev = true;
        k = 1 - k;
      }
      const md = this.use('median');
      md.tex('uF', 0, this.scratch[1 - k].id);
      md.f2('uFT', 1 / this.fieldW, 1 / this.fieldH);
      this.drawTo(dir ? b.backward : b.forward);
    }
    b.fieldsFrom = a.serial;
  }

  /** Draws the picture at time t (0 = a, 1 = b) into [rect] of the canvas (device pixels). */
  render(a: Frame, b: Frame, t: number, mode: number, useFields: boolean, split: number, vectors: boolean, rect: Rect) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h));
    const fields = useFields && b.forward && b.backward;
    const o = this.use('output');
    o.tex('uA', 0, a.color.id);
    o.tex('uB', 1, b.color.id);
    o.tex('uF', 2, fields ? b.forward!.id : a.color.id);
    o.tex('uW', 3, fields ? b.backward!.id : a.color.id);
    o.f('uT', t);
    o.i('uMode', mode);
    o.i('uHasF', fields ? 1 : 0);
    o.f('uSplit', split);
    o.i('uVec', vectors && fields ? 1 : 0);
    o.f2('uRes', this.width, this.height);
    o.f('uLineW', 1.5 / Math.max(1, rect.w));
    o.f('uFlowMax', this.width * 0.03);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private releaseTextures() {
    for (const s of this.slots) {
      this.del(s.color);
      s.pyramid.forEach((p) => this.del(p));
      this.del(s.forward);
      this.del(s.backward);
    }
    this.slots = [];
    this.scratch.forEach((t) => this.del(t));
    this.scratch = [];
    this.width = 0;
    this.height = 0;
  }

  release() {
    this.releaseTextures();
    Object.values(this.progs).forEach((p) => this.gl.deleteProgram(p.p));
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
